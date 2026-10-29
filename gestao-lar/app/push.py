"""Envio de Web Push (notificações no celular/navegador, mesmo com o app fechado).

Chave VAPID (identifica este servidor junto aos serviços de push), em ordem de prioridade:
- LAR_VAPID_CHAVE: a chave em texto (gere com `python -m app.push`);
- arquivo PEM em LAR_VAPID_PRIVADA ou data/vapid_privada.pem, se existir (versões anteriores);
- senão, é gerada no primeiro uso e guardada no banco, o que também funciona em serverless,
  onde não há disco persistente e todas as instâncias precisam usar a mesma chave.
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
from sqlalchemy.exc import IntegrityError

from .database import DATA_DIR, SERVERLESS, SessionLocal
from .models import Configuracao, InscricaoPush

log = logging.getLogger(__name__)

CHAVE_TEXTO = os.environ.get("LAR_VAPID_CHAVE")
ARQUIVO_CHAVE = os.environ.get("LAR_VAPID_PRIVADA", str(DATA_DIR / "vapid_privada.pem"))
# Os serviços de push exigem um contato (mailto: ou https:) do responsável pelo app.
CONTATO = os.environ.get("LAR_VAPID_CONTATO", "mailto:gestao-lar@example.com")
TTL_SEGUNDOS = 12 * 3600

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")


@lru_cache
def vapid() -> Vapid:
    if CHAVE_TEXTO:
        return Vapid.from_string(CHAVE_TEXTO)
    if os.path.exists(ARQUIVO_CHAVE):
        return Vapid.from_file(ARQUIVO_CHAVE)
    return Vapid.from_string(_chave_do_banco())


def _chave_do_banco() -> str:
    with SessionLocal() as db:
        existente = db.get(Configuracao, "vapid_chave")
        if existente is not None:
            return existente.valor
        db.add(Configuracao(chave="vapid_chave", valor=gerar_chave()))
        try:
            db.commit()
        except IntegrityError:
            # Outra instância gerou ao mesmo tempo: vale a que foi gravada primeiro.
            db.rollback()
        return db.get(Configuracao, "vapid_chave").valor


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
    """Envia em segundo plano para não atrasar a resposta da API.

    Em serverless a instância pode ser congelada assim que a resposta sai, então o envio
    acontece antes de responder.
    """
    if not usuario_ids:
        return
    if SERVERLESS:
        enviar_agora(usuario_ids, conteudo)
    else:
        _executor.submit(enviar_agora, usuario_ids, conteudo)


def gerar_chave() -> str:
    """Nova chave VAPID no formato aceito por LAR_VAPID_CHAVE."""
    nova = Vapid()
    nova.generate_keys()
    der = nova.private_key.private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    return base64.urlsafe_b64encode(der).rstrip(b"=").decode()


if __name__ == "__main__":
    print(gerar_chave())
