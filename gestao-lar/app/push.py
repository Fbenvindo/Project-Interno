"""Envio de Web Push (notificações no celular/navegador, mesmo com o app fechado).

As chaves VAPID são geradas no primeiro uso e guardadas em DATA_DIR. Também podem
ser fornecidas pela variável LAR_VAPID_PRIVADA (caminho de um arquivo PEM).
"""

import base64
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select

from .database import DATA_DIR, SessionLocal
from .models import InscricaoPush

log = logging.getLogger(__name__)

ARQUIVO_CHAVE = os.environ.get("LAR_VAPID_PRIVADA", str(DATA_DIR / "vapid_privada.pem"))
# Os serviços de push exigem um contato (mailto: ou https:) do responsável pelo app.
CONTATO = os.environ.get("LAR_VAPID_CONTATO", "mailto:gestao-lar@example.com")
TTL_SEGUNDOS = 12 * 3600

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")


@lru_cache
def vapid() -> Vapid:
    if not os.path.exists(ARQUIVO_CHAVE):
        nova = Vapid()
        nova.generate_keys()
        nova.save_key(ARQUIVO_CHAVE)
    return Vapid.from_file(ARQUIVO_CHAVE)


def chave_publica() -> str:
    """Chave no formato esperado por pushManager.subscribe (applicationServerKey)."""
    bruta = vapid().public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(bruta).rstrip(b"=").decode()


def _enviar_webpush(inscricao: dict, dados: str) -> None:
    webpush(inscricao, dados, vapid_private_key=vapid(), vapid_claims={"sub": CONTATO}, ttl=TTL_SEGUNDOS, timeout=10)


def enviar_agora(usuario_ids: list[int], conteudo: dict) -> int:
    """Envia para todos os aparelhos dos usuários. Retorna quantos envios deram certo."""
    dados = json.dumps(conteudo, ensure_ascii=False)
    enviados, expirados = 0, []
    with SessionLocal() as db:
        inscricoes = db.scalars(select(InscricaoPush).where(InscricaoPush.usuario_id.in_(usuario_ids))).all()
        for i in inscricoes:
            try:
                _enviar_webpush({"endpoint": i.endpoint, "keys": {"p256dh": i.p256dh, "auth": i.auth}}, dados)
                enviados += 1
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):  # aparelho cancelou a inscrição
                    expirados.append(i.id)
                else:
                    log.warning("Falha no push para o usuário %s: %s", i.usuario_id, e)
            except Exception:  # noqa: BLE001 - rede indisponível etc. não pode derrubar o app
                log.exception("Erro inesperado ao enviar push")
        if expirados:
            db.execute(delete(InscricaoPush).where(InscricaoPush.id.in_(expirados)))
            db.commit()
    return enviados


def agendar(usuario_ids: list[int], conteudo: dict) -> None:
    """Envia em segundo plano para não atrasar a resposta da API."""
    if usuario_ids:
        _executor.submit(enviar_agora, usuario_ids, conteudo)
