import base64
import json
import os
from datetime import date, timedelta

import pytest
import pywebpush
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app import push
from app.database import SessionLocal
from app.notificacoes import enviar_resumos
from conftest import bagunca, cena, jpg
from test_auth import entrar

HOJE = date.today()


def preparar(client, estoque=500, consumo=50):
    """Prestadora Ana (com acesso) e uma atividade diária que consome detergente."""
    ana = client.post("/api/prestadores", json={"nome": "Ana"}).json()
    client.post("/api/usuarios", json={
        "nome": "Ana", "login": "ana", "papel": "prestador", "prestador_id": ana["id"], "senha": "123456",
    })
    detergente = client.post("/api/recursos", json={
        "nome": "Detergente", "unidade": "ml", "estoque_atual": estoque, "estoque_minimo": 100,
    }).json()
    atividade = client.post("/api/atividades", json={
        "nome": "Limpar cozinha", "tipo": "limpeza", "frequencia": "diaria", "data_inicio": str(HOJE),
        "prestador_ids": [ana["id"]], "recursos": [{"recurso_id": detergente["id"], "quantidade": consumo}],
    }).json()
    tarefas = client.get("/api/cronograma").json()
    return ana, detergente, atividade, tarefas


def titulos(c):
    return [n["titulo"] for n in c.get("/api/notificacoes").json()]


def test_estoque_baixo_avisa_so_ao_cruzar_o_minimo(client):
    _, _, _, tarefas = preparar(client, estoque=500, consumo=200)
    client.post(f"/api/tarefas/{tarefas[0]['id']}/concluir")  # 500 -> 300
    assert titulos(client) == []
    client.post(f"/api/tarefas/{tarefas[1]['id']}/concluir")  # 300 -> 100 (cruzou)
    assert titulos(client) == ["Estoque baixo: Detergente"]
    client.post(f"/api/tarefas/{tarefas[2]['id']}/concluir")  # continua abaixo: não repete
    assert titulos(client) == ["Estoque baixo: Detergente"]
    n = client.get("/api/notificacoes").json()[0]
    assert n["link"] == "aba:estoque" and "Restam 100 ml (mínimo 100)" in n["mensagem"]


def test_execucao_para_conferir_e_sem_foto(client):
    _, _, atividade, tarefas = preparar(client)
    client.post(f"/api/atividades/{atividade['id']}/referencia",
                files={"foto": ("r.jpg", jpg(cena()), "image/jpeg")})
    ana = entrar("ana", "123456")

    ana.post(f"/api/tarefas/{tarefas[0]['id']}/foto", files={"foto": ("a.jpg", jpg(bagunca(cena(4))), "image/jpeg")})
    ana.post(f"/api/tarefas/{tarefas[0]['id']}/concluir")
    ana.post(f"/api/tarefas/{tarefas[1]['id']}/concluir")

    notifs = client.get("/api/notificacoes").json()
    assert [n["tipo"] for n in notifs] == ["tarefa_conferir", "tarefa_conferir"]
    assert "sem enviar foto" in notifs[0]["mensagem"]
    assert "avaliação da foto" in notifs[1]["mensagem"] and notifs[1]["link"] == f"tarefa:{tarefas[0]['id']}"
    assert titulos(ana) == []  # quem executou não é avisado


def test_conclusao_normal_so_avisa_se_o_dono_quiser(client):
    _, _, _, tarefas = preparar(client)
    ana = entrar("ana", "123456")
    ana.post(f"/api/tarefas/{tarefas[0]['id']}/concluir")
    assert titulos(client) == []

    prefs = client.get("/api/notificacoes/preferencias").json()
    client.put("/api/notificacoes/preferencias", json={**prefs, "tarefa_concluida": True})
    ana.post(f"/api/tarefas/{tarefas[1]['id']}/concluir")
    assert titulos(client) == ["Concluída: Limpar cozinha"]


def test_tarefa_atribuida_avisa_o_novo_prestador(client):
    _, _, _, tarefas = preparar(client)
    bia = client.post("/api/prestadores", json={"nome": "Bia"}).json()
    client.post("/api/usuarios", json={
        "nome": "Bia", "login": "bia", "papel": "prestador", "prestador_id": bia["id"], "senha": "123456",
    })
    client.post(f"/api/tarefas/{tarefas[0]['id']}/prestador/{bia['id']}")
    client.post(f"/api/tarefas/{tarefas[0]['id']}/prestador/{bia['id']}")  # sem mudança: não repete
    notifs = entrar("bia", "123456").get("/api/notificacoes").json()
    assert len(notifs) == 1 and notifs[0]["titulo"] == "Nova tarefa: Limpar cozinha"
    assert notifs[0]["link"] == f"tarefa:{tarefas[0]['id']}"


def test_resumo_diario_uma_vez_por_dia(client):
    # Estoque não cobre o consumo de hoje + amanhã (2 x 300 > 500).
    preparar(client, estoque=500, consumo=300)
    with SessionLocal() as db:
        assert enviar_resumos(db, HOJE) == 2
        assert enviar_resumos(db, HOJE) == 0

    resumo_ana = entrar("ana", "123456").get("/api/notificacoes").json()[0]
    assert resumo_ana["titulo"] == "Suas tarefas de hoje (1)"
    assert "Qualquer horário: Limpar cozinha" in resumo_ana["mensagem"]

    resumo_dono = client.get("/api/notificacoes").json()[0]
    assert resumo_dono["titulo"] == "Resumo do dia"
    assert "1 tarefa(s) para hoje" in resumo_dono["mensagem"]
    assert "Faltam materiais para hoje/amanhã: Detergente (precisa 600 ml, tem 500)" in resumo_dono["mensagem"]


def test_resumo_inclui_atrasadas_e_respeita_preferencia(client):
    preparar(client)
    ana = entrar("ana", "123456")
    with SessionLocal() as db:
        enviar_resumos(db, HOJE + timedelta(days=2))  # as tarefas de hoje e amanhã ficaram para trás
    assert "⚠ 2 tarefa(s) atrasada(s)" in ana.get("/api/notificacoes").json()[0]["mensagem"]

    prefs = ana.get("/api/notificacoes/preferencias").json()
    ana.put("/api/notificacoes/preferencias", json={**prefs, "resumo_diario": False})
    with SessionLocal() as db:
        enviar_resumos(db, HOJE + timedelta(days=3))
    assert len(ana.get("/api/notificacoes").json()) == 1


def test_lidas_contagem_e_isolamento(client):
    _, _, _, tarefas = preparar(client, estoque=150, consumo=100)
    client.post(f"/api/tarefas/{tarefas[0]['id']}/concluir")
    client.post("/api/notificacoes/teste")
    assert client.get("/api/notificacoes/contagem").json() == {"nao_lidas": 2}

    primeira = client.get("/api/notificacoes").json()[0]
    ana = entrar("ana", "123456")
    assert ana.post(f"/api/notificacoes/{primeira['id']}/lida").status_code == 404
    assert client.post(f"/api/notificacoes/{primeira['id']}/lida").status_code == 204
    assert client.get("/api/notificacoes/contagem").json() == {"nao_lidas": 1}
    assert len(client.get("/api/notificacoes", params={"nao_lidas": True}).json()) == 1
    client.post("/api/notificacoes/marcar-todas-lidas")
    assert client.get("/api/notificacoes/contagem").json() == {"nao_lidas": 0}


def test_somente_dono_dispara_resumo_e_rotas_exigem_login(client, anonimo):
    preparar(client)
    assert entrar("ana", "123456").post("/api/notificacoes/resumo").status_code == 403
    assert client.post("/api/notificacoes/resumo").json() == {"enviadas": 2}
    client.post("/api/auth/logout")
    assert anonimo.get("/api/notificacoes").status_code == 401


INSCRICAO = {"endpoint": "https://push.exemplo.com/abc", "keys": {"p256dh": "chave", "auth": "segredo"}}


def test_push_para_aparelhos_inscritos(client, pushes):
    assert client.get("/api/notificacoes/push/chave").json()["chave_publica"]
    assert client.post("/api/notificacoes/push/inscricao", json=INSCRICAO).status_code == 201
    assert client.post("/api/notificacoes/push/inscricao",
                       json={**INSCRICAO, "endpoint": "http://inseguro"}).status_code == 422

    assert client.post("/api/notificacoes/teste").json() == {"aparelhos": 1}
    inscricao, dados = pushes[-1]
    assert inscricao["endpoint"] == INSCRICAO["endpoint"] and inscricao["keys"]["auth"] == "segredo"
    assert json.loads(dados)["titulo"] == "Notificação de teste"

    # Com o push desligado nas preferências, a notificação fica só na central do app.
    prefs = client.get("/api/notificacoes/preferencias").json()
    client.put("/api/notificacoes/preferencias", json={**prefs, "push": False})
    client.post("/api/notificacoes/teste")
    assert len(pushes) == 1

    client.post("/api/notificacoes/push/cancelar", json={"endpoint": INSCRICAO["endpoint"]})
    assert client.post("/api/notificacoes/teste").json() == {"aparelhos": 0}


def test_inscricao_expirada_e_removida(client, monkeypatch):
    client.post("/api/notificacoes/push/inscricao", json=INSCRICAO)

    class Resposta:
        status_code = 410
        text = "Gone"

    def falha(*_):
        raise pywebpush.WebPushException("expirada", response=Resposta())

    monkeypatch.setattr(push, "_enviar_webpush", falha)
    client.post("/api/notificacoes/teste")
    assert client.post("/api/notificacoes/teste").json() == {"aparelhos": 0}


def test_envio_real_criptografado(monkeypatch, tmp_path):
    """Exercita a criptografia e a assinatura VAPID de verdade, interceptando só o HTTP."""
    monkeypatch.undo()  # volta ao _enviar_webpush original
    monkeypatch.setattr(push, "ARQUIVO_CHAVE", str(tmp_path / "vapid.pem"))
    push.vapid.cache_clear()

    privada = ec.generate_private_key(ec.SECP256R1())
    p256dh = privada.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    inscricao = {"endpoint": "https://push.exemplo.com/xyz", "keys": {"p256dh": b64(p256dh), "auth": b64(os.urandom(16))}}

    chamadas = []

    class Resposta:
        status_code = 201
        text = ""
        headers = {}

    monkeypatch.setattr(pywebpush.requests, "post", lambda url, **kw: chamadas.append((url, kw)) or Resposta())
    try:
        push._enviar_webpush(inscricao, json.dumps({"titulo": "Oi"}))
    finally:
        push.vapid.cache_clear()

    url, kw = chamadas[0]
    assert url == inscricao["endpoint"]
    assert kw["headers"]["content-encoding"] == "aes128gcm"
    assert kw["headers"]["authorization"].startswith("vapid t=")
    assert b"Oi" not in kw["data"]  # conteúdo vai criptografado


@pytest.mark.parametrize("rota", ["/api/notificacoes/contagem", "/api/notificacoes/preferencias"])
def test_rotas_basicas_respondem(client, rota):
    assert client.get(rota).status_code == 200
