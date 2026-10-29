"""Adaptações para rodar em servidor serverless (Vercel) com PostgreSQL (Neon)."""

from datetime import datetime, timedelta

import cv2
import numpy as np
import pytest

from app import database, push, relogio
from app.database import SessionLocal
from app.models import Arquivo, Configuracao
from conftest import AGENDAR_PUSH_ORIGINAL, cena, jpg


@pytest.mark.parametrize("url, esperado", [
    ("postgresql://u:s@ep-x-pooler.neon.tech/lar?sslmode=require",
     "postgresql+psycopg://u:s@ep-x-pooler.neon.tech/lar?sslmode=require"),
    ("postgres://u:s@host/lar", "postgresql+psycopg://u:s@host/lar"),
    ("sqlite:///x.db", "sqlite:///x.db"),
])
def test_url_do_banco_aceita_formato_do_neon(monkeypatch, url, esperado):
    monkeypatch.delenv("LAR_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", url)
    assert database._url_banco() == esperado


def test_relogio_usa_o_fuso_da_casa():
    esperado = datetime.now(relogio.FUSO).replace(tzinfo=None)
    assert abs(relogio.agora() - esperado) < timedelta(seconds=5)
    assert relogio.hoje() == esperado.date()


def test_fotos_ficam_no_banco_reduzidas(client):
    atividade = client.post("/api/atividades", json={"nome": "Sala", "frequencia": "diaria"}).json()
    grande = cv2.resize(cena(), (3200, 2400))
    r = client.post(f"/api/atividades/{atividade['id']}/referencia",
                    files={"foto": ("grande.jpg", jpg(grande), "image/jpeg")})
    url = r.json()["foto_referencia"]
    nome = url.rsplit("/", 1)[-1]

    with SessionLocal() as db:
        arquivo = db.get(Arquivo, nome)
        img = cv2.imdecode(np.frombuffer(arquivo.conteudo, np.uint8), cv2.IMREAD_COLOR)
    assert max(img.shape[:2]) == 1600

    resposta = client.get(url)
    assert resposta.status_code == 200 and resposta.headers["content-type"] == "image/jpeg"
    assert resposta.content == arquivo.conteudo
    assert client.get("/uploads/nao-existe.jpg").status_code == 404


def test_cron_do_resumo_exige_segredo(client, monkeypatch):
    client.post("/api/prestadores", json={"nome": "Ana"})
    monkeypatch.delenv("CRON_SECRET", raising=False)
    assert client.get("/api/cron/resumo").status_code == 503

    monkeypatch.setenv("CRON_SECRET", "segredo-do-cron")
    assert client.get("/api/cron/resumo").status_code == 401
    assert client.get("/api/cron/resumo", headers={"Authorization": "Bearer errado"}).status_code == 401
    assert client.get("/api/cron/resumo", headers={"Authorization": "Bearer çã".encode("latin-1")}).status_code == 401
    r = client.get("/api/cron/resumo", headers={"Authorization": "Bearer segredo-do-cron"})
    assert r.status_code == 200 and "enviadas" in r.json()


def test_chave_vapid_por_variavel_de_ambiente(client, monkeypatch):
    push.vapid.cache_clear()
    monkeypatch.setattr(push, "CHAVE_TEXTO", push.gerar_chave())
    try:
        chave = client.get("/api/notificacoes/push/chave").json()["chave_publica"]
        assert len(chave) == 87  # ponto público P-256 não comprimido em base64url
    finally:
        push.vapid.cache_clear()


def test_sem_variavel_a_chave_vapid_fica_no_banco(client, monkeypatch, tmp_path):
    """Em serverless não há disco: a chave é gerada uma vez e todas as instâncias usam a mesma."""
    monkeypatch.setattr(push, "CHAVE_TEXTO", None)
    monkeypatch.setattr(push, "ARQUIVO_CHAVE", str(tmp_path / "nao-existe.pem"))
    push.vapid.cache_clear()
    try:
        primeira = client.get("/api/notificacoes/push/chave").json()["chave_publica"]
        push.vapid.cache_clear()  # simula outra instância / novo cold start
        assert client.get("/api/notificacoes/push/chave").json()["chave_publica"] == primeira
        with SessionLocal() as db:
            assert db.get(Configuracao, "vapid_chave") is not None
        assert not (tmp_path / "nao-existe.pem").exists()
    finally:
        push.vapid.cache_clear()


def test_push_em_serverless_e_enviado_antes_da_resposta(client, monkeypatch, pushes):
    # Usa o agendamento real: em serverless ele não pode deixar o envio para uma thread.
    monkeypatch.setattr(push, "agendar", AGENDAR_PUSH_ORIGINAL)
    monkeypatch.setattr(push, "SERVERLESS", True)
    monkeypatch.setattr(push._executor, "submit", lambda *a, **k: pytest.fail("não deveria usar thread em serverless"))
    client.post("/api/notificacoes/push/inscricao",
                json={"endpoint": "https://push.exemplo.com/a", "keys": {"p256dh": "k", "auth": "a"}})
    client.post("/api/notificacoes/teste")
    assert len(pushes) == 1
