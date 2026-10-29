from datetime import timedelta

from app.relogio import hoje
from conftest import bagunca, cena, jpg


def criar_base(client):
    ana = client.post("/api/prestadores", json={"nome": "Ana", "funcao": "Diarista"}).json()
    bia = client.post("/api/prestadores", json={"nome": "Bia", "funcao": "Diarista"}).json()
    detergente = client.post("/api/recursos", json={
        "nome": "Detergente", "categoria": "limpeza", "unidade": "ml",
        "estoque_atual": 500, "estoque_minimo": 100, "custo_unitario": 0.01,
    }).json()
    atividade = client.post("/api/atividades", json={
        "nome": "Limpar cozinha", "tipo": "limpeza", "periodo": "manha",
        "frequencia": "diaria", "data_inicio": str(hoje()),
        "prestador_ids": [ana["id"], bia["id"]],
        "recursos": [{"recurso_id": detergente["id"], "quantidade": 50}],
    }).json()
    return ana, bia, detergente, atividade


def test_cronograma_gerado_com_rodizio(client):
    ana, bia, _, atividade = criar_base(client)
    tarefas = client.get("/api/cronograma", params={"fim": str(hoje() + timedelta(days=3))}).json()
    assert [t["data"] for t in tarefas] == [str(hoje() + timedelta(days=i)) for i in range(4)]
    assert [t["prestador"]["nome"] for t in tarefas] == ["Ana", "Bia", "Ana", "Bia"]
    assert atividade["recursos"][0]["nome"] == "Detergente"

    # Consultar de novo não duplica tarefas.
    assert len(client.get("/api/cronograma", params={"fim": str(hoje() + timedelta(days=3))}).json()) == 4


def test_editar_atividade_refaz_tarefas_pendentes(client):
    _, _, _, atividade = criar_base(client)
    dados = {**atividade, "frequencia": "semanal", "dias_semana": [hoje().weekday()],
             "prestador_ids": [], "recursos": []}
    dados.pop("id")
    assert client.put(f"/api/atividades/{atividade['id']}", json=dados).status_code == 200
    tarefas = client.get("/api/cronograma", params={"fim": str(hoje() + timedelta(days=13))}).json()
    assert len(tarefas) == 2 and tarefas[0]["prestador"] is None


def test_execucao_completa_com_foto_e_baixa_de_estoque(client):
    _, _, detergente, atividade = criar_base(client)
    tarefa = client.get("/api/cronograma").json()[0]

    detalhe = client.get(f"/api/tarefas/{tarefa['id']}").json()
    assert detalhe["materiais"][0] == {
        "recurso_id": detergente["id"], "nome": "Detergente", "unidade": "ml",
        "quantidade": 50, "estoque_atual": 500, "suficiente": True,
    }

    # Sem referência: análise só confere a qualidade.
    r = client.post(f"/api/tarefas/{tarefa['id']}/foto", files={"foto": ("a.jpg", jpg(cena()), "image/jpeg")}).json()
    assert r["avaliacao"] == "sem_referencia" and r["status"] == "em_andamento" and r["foto"]

    # Foto aprovada vira referência para as próximas execuções.
    client.post(f"/api/tarefas/{tarefa['id']}/usar-como-referencia")
    assert client.get(f"/api/atividades/{atividade['id']}").json()["foto_referencia"]

    r = client.post(f"/api/tarefas/{tarefa['id']}/concluir", json={"observacao": "ok"}).json()
    assert r["status"] == "concluida" and r["avisos"] == []
    assert client.get(f"/api/recursos/{detergente['id']}").json()["estoque_atual"] == 450
    movimentos = client.get(f"/api/recursos/{detergente['id']}/movimentos").json()
    assert movimentos[0]["quantidade"] == -50 and movimentos[0]["tarefa_id"] == tarefa["id"]

    assert client.post(f"/api/tarefas/{tarefa['id']}/concluir").status_code == 409

    # Na próxima execução, a foto é comparada com a referência.
    proxima = client.get("/api/cronograma").json()[1]
    r = client.post(f"/api/tarefas/{proxima['id']}/foto",
                    files={"foto": ("b.jpg", jpg(bagunca(cena(4))), "image/jpeg")}).json()
    assert r["avaliacao"] in ("revisar", "reprovada") and r["analise"]["metricas"]


def test_foto_invalida(client):
    criar_base(client)
    tarefa = client.get("/api/cronograma").json()[0]
    r = client.post(f"/api/tarefas/{tarefa['id']}/foto", files={"foto": ("a.jpg", b"xx", "image/jpeg")})
    assert r.status_code == 422


def test_lista_de_compras_e_alertas(client):
    _, _, detergente, _ = criar_base(client)
    # 8 dias de tarefas x 50 ml = 400 ml previstos; 400 + 100 (mínimo) - 500 = 0 → nada a comprar.
    assert client.get("/api/recursos/lista-compras", params={"dias": 7}).json() == []

    client.post(f"/api/recursos/{detergente['id']}/movimentos", json={"tipo": "ajuste", "quantidade": 80})
    itens = client.get("/api/recursos/lista-compras", params={"dias": 7}).json()
    assert itens[0]["comprar"] == 420 and itens[0]["custo_estimado"] == 4.2

    painel = client.get("/api/painel").json()
    assert painel["tarefas_hoje"]["pendente"] == 1
    assert painel["alertas_estoque"][0]["nome"] == "Detergente"


def test_validacoes(client):
    assert client.post("/api/atividades", json={"nome": "x", "dias_semana": [9]}).status_code == 422
    assert client.post("/api/atividades", json={"nome": "x", "prestador_ids": [999]}).status_code == 422
    assert client.get("/api/tarefas/999").status_code == 404
