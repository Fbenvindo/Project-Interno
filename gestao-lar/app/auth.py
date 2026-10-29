"""Senhas, sessões e dependências de permissão."""

import hashlib
import hmac
import os
import secrets
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .database import get_db
from .models import Sessao, Usuario
from .relogio import agora

COOKIE_SESSAO = "lar_sessao"
DURACAO_SESSAO = timedelta(days=30)
ITERACOES = int(os.environ.get("LAR_PBKDF2_ITERACOES", "390000"))


def gerar_hash(senha: str) -> str:
    sal = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal, ITERACOES)
    return f"pbkdf2_sha256${ITERACOES}${sal.hex()}${h.hex()}"


def conferir_senha(senha: str, armazenado: str) -> bool:
    try:
        _, iteracoes, sal, esperado = armazenado.split("$")
        h = hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), int(iteracoes))
    except ValueError:
        return False
    return hmac.compare_digest(h.hex(), esperado)


# Usado quando o login não existe, para a resposta levar o mesmo tempo.
_HASH_FICTICIO = gerar_hash(secrets.token_hex(8))


def autenticar(usuario: Usuario | None, senha: str) -> bool:
    if usuario is None:
        conferir_senha(senha, _HASH_FICTICIO)
        return False
    return conferir_senha(senha, usuario.senha_hash) and usuario.pode_entrar


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def iniciar_sessao(db: Session, usuario: Usuario, request: Request, response: Response) -> None:
    momento = agora()
    db.execute(delete(Sessao).where(Sessao.expira_em < momento))
    token = secrets.token_urlsafe(32)
    db.add(Sessao(token_hash=_hash_token(token), usuario_id=usuario.id, expira_em=momento + DURACAO_SESSAO))
    db.commit()
    response.set_cookie(
        COOKIE_SESSAO, token,
        max_age=int(DURACAO_SESSAO.total_seconds()),
        httponly=True,
        samesite="lax",
        # Atrás de proxy (Vercel), o HTTPS termina no proxy e chega como X-Forwarded-Proto.
        secure=request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https",
    )


def encerrar_sessao(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE_SESSAO)
    if token:
        db.execute(delete(Sessao).where(Sessao.token_hash == _hash_token(token)))
        db.commit()
    response.delete_cookie(COOKIE_SESSAO)


def encerrar_sessoes_do_usuario(db: Session, usuario_id: int, exceto: Request | None = None) -> None:
    q = delete(Sessao).where(Sessao.usuario_id == usuario_id)
    token = exceto.cookies.get(COOKIE_SESSAO) if exceto else None
    if token:
        q = q.where(Sessao.token_hash != _hash_token(token))
    db.execute(q)


def usuario_da_requisicao(request: Request, db: Session) -> Usuario | None:
    token = request.cookies.get(COOKIE_SESSAO)
    if not token:
        return None
    sessao = db.get(Sessao, _hash_token(token))
    if sessao is None or sessao.expira_em < agora() or not sessao.usuario.pode_entrar:
        return None
    return sessao.usuario


def usuario_atual(request: Request, db: Session = Depends(get_db)) -> Usuario:
    usuario = usuario_da_requisicao(request, db)
    if usuario is None:
        raise HTTPException(401, "Faça login para continuar")
    return usuario


def exigir_dono(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
    if usuario.papel != "dono":
        raise HTTPException(403, "Acesso restrito ao dono da casa")
    return usuario
