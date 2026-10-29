from fastapi.testclient import TestClient

from app.main import app
from app.relogio import hoje
from conftest import SENHA_DONO, cena, jpg


def entrar(login: str, senha: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"login": login, "senha": senha})
    assert r.status_code == 200, r.text
    return c


def preparar(client):
    """Dois prestadores com acesso e uma atividade diária com rodízio entre eles."""
    ana = client.post("/api/prestadores", json={"nome": "Ana"}).json()
    bia = client.post("/api/prestadores", json={"nome": "Bia"}).json()
    for p, login in ((ana, "ana"), (bia, "bia")):
        r = client.post("/api/usuarios", json={
            "nome": p["nome"], "login": login, "papel": "prestador", "prestador_id": p["id"], "senha": "123456",
        })
        assert r.status_code == 201, r.text
    client.post("/api/atividades", json={
        "nome": "Limpar cozinha", "tipo": "limpeza", "frequencia": "diaria",
        "data_inicio": str(hoje()), "prestador_ids": [ana["id"], bia["id"]],
    })
    tarefas = client.get("/api/cronograma").json()
    da_ana = next(t for t in tarefas if t["prestador"]["nome"] == "Ana")
    da_bia = next(t for t in tarefas if t["prestador"]["nome"] == "Bia")
    return ana, bia, da_ana, da_bia


def test_primeiro_acesso_so_uma_vez(anonimo):
    assert anonimo.get("/api/auth/estado").json() == {"configurado": False, "usuario": None}
    r = anonimo.post("/api/auth/primeiro-acesso", json={"nome": "Dono", "login": " Dono ", "senha": "123456"})
    assert r.status_code == 201 and r.json()["login"] == "dono" and r.json()["papel"] == "dono"
    assert anonimo.get("/api/auth/estado").json()["usuario"]["login"] == "dono"
    r = anonimo.post("/api/auth/primeiro-acesso", json={"nome": "Outro", "login": "outro", "senha": "123456"})
    assert r.status_code == 409


def test_rotas_exigem_login(anonimo):
    for rota in ("/api/painel", "/api/cronograma", "/api/prestadores", "/api/recursos", "/api/atividades",
                 "/api/usuarios", "/api/auth/eu", "/uploads/qualquer.jpg"):
        assert anonimo.get(rota).status_code == 401, rota
    # A interface (arquivos estáticos) continua pública para mostrar a tela de login.
    assert anonimo.get("/").status_code == 200


def test_login_logout_e_senha_errada(client):
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/eu").status_code == 401
    assert client.post("/api/auth/login", json={"login": "dona", "senha": "errada"}).status_code == 401
    assert client.post("/api/auth/login", json={"login": "ninguem", "senha": "x"}).status_code == 401
    assert client.post("/api/auth/login", json={"login": "DONA", "senha": SENHA_DONO}).status_code == 200
    assert client.get("/api/auth/eu").json()["nome"] == "Dona"


def test_prestador_ve_e_executa_apenas_as_proprias_tarefas(client):
    _, _, da_ana, da_bia = preparar(client)
    ana = entrar("ana", "123456")

    tarefas = ana.get("/api/cronograma").json()
    assert tarefas and all(t["prestador"]["nome"] == "Ana" for t in tarefas)
    # Mesmo pedindo o cronograma de outro prestador, recebe só o próprio.
    assert all(t["prestador"]["nome"] == "Ana"
               for t in ana.get("/api/cronograma", params={"prestador_id": da_bia["prestador"]["id"]}).json())

    assert ana.get(f"/api/tarefas/{da_bia['id']}").status_code == 404
    assert ana.post(f"/api/tarefas/{da_bia['id']}/concluir").status_code == 404

    r = ana.post(f"/api/tarefas/{da_ana['id']}/foto", files={"foto": ("a.jpg", jpg(cena()), "image/jpeg")})
    assert r.status_code == 200
    foto = r.json()["foto"]
    assert ana.get(foto).status_code == 200
    assert ana.post(f"/api/tarefas/{da_ana['id']}/concluir").json()["status"] == "concluida"

    # A outra prestadora não vê a foto da Ana; o dono vê.
    assert entrar("bia", "123456").get(foto).status_code == 404
    assert client.get(foto).status_code == 200

    painel = ana.get("/api/painel").json()
    assert painel["alertas_estoque"] == []


def test_prestador_nao_acessa_gestao(client):
    _, _, da_ana, _ = preparar(client)
    ana = entrar("ana", "123456")
    for rota in ("/api/prestadores", "/api/recursos", "/api/atividades", "/api/usuarios"):
        assert ana.get(rota).status_code == 403, rota
    for rota in ("cancelar", "usar-como-referencia", f"prestador/{da_ana['prestador']['id']}"):
        assert ana.post(f"/api/tarefas/{da_ana['id']}/{rota}").status_code == 403, rota
    assert ana.post("/api/cronograma/gerar").status_code == 403


def test_prestador_inativo_ou_usuario_inativo_nao_entra(client):
    ana, _, _, _ = preparar(client)
    sessao_ana = entrar("ana", "123456")

    client.put(f"/api/prestadores/{ana['id']}", json={"nome": "Ana", "ativo": False})
    assert sessao_ana.get("/api/auth/eu").status_code == 401
    assert TestClient(app).post("/api/auth/login", json={"login": "ana", "senha": "123456"}).status_code == 401

    client.put(f"/api/prestadores/{ana['id']}", json={"nome": "Ana", "ativo": True})
    usuario = next(u for u in client.get("/api/usuarios").json() if u["login"] == "ana")
    client.put(f"/api/usuarios/{usuario['id']}", json={**usuario, "ativo": False})
    assert sessao_ana.get("/api/auth/eu").status_code == 401


def test_regras_de_usuarios(client):
    ana, _, _, _ = preparar(client)
    base = {"nome": "X", "login": "xxx", "senha": "123456"}
    assert client.post("/api/usuarios", json={**base, "papel": "prestador"}).status_code == 422
    assert client.post("/api/usuarios", json={**base, "papel": "prestador", "prestador_id": ana["id"]}).status_code == 409
    assert client.post("/api/usuarios", json={**base, "login": "ana", "papel": "dono"}).status_code == 409
    assert client.post("/api/usuarios", json={**base, "papel": "dono", "prestador_id": ana["id"]}).status_code == 422
    assert client.post("/api/usuarios", json={**base, "papel": "dono", "senha": None}).status_code == 422
    assert client.post("/api/usuarios", json={**base, "login": "a b", "papel": "dono"}).status_code == 422

    # Não é possível remover ou rebaixar o único dono.
    dona = next(u for u in client.get("/api/usuarios").json() if u["login"] == "dona")
    assert client.delete(f"/api/usuarios/{dona['id']}").status_code == 409
    assert client.put(f"/api/usuarios/{dona['id']}", json={**dona, "ativo": False}).status_code == 409

    # Excluir o prestador remove também o acesso dele.
    client.delete(f"/api/prestadores/{ana['id']}")
    assert "ana" not in [u["login"] for u in client.get("/api/usuarios").json()]


def test_trocar_senha_desconecta_outros_aparelhos(client):
    outro_aparelho = entrar("dona", SENHA_DONO)
    r = client.post("/api/auth/senha", json={"senha_atual": "errada", "nova_senha": "nova-senha"})
    assert r.status_code == 422
    r = client.post("/api/auth/senha", json={"senha_atual": SENHA_DONO, "nova_senha": "nova-senha"})
    assert r.status_code == 204
    assert client.get("/api/auth/eu").status_code == 200
    assert outro_aparelho.get("/api/auth/eu").status_code == 401
    entrar("dona", "nova-senha")
