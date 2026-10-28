from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    autenticar, conferir_senha, encerrar_sessao, encerrar_sessoes_do_usuario, gerar_hash,
    iniciar_sessao, usuario_atual, usuario_da_requisicao,
)
from ..database import get_db
from ..models import Usuario
from ..schemas import LoginIn, PrimeiroAcessoIn, TrocarSenhaIn, UsuarioOut

router = APIRouter(prefix="/api/auth", tags=["autenticação"])


def _existe_usuario(db: Session) -> bool:
    return db.scalar(select(Usuario.id).limit(1)) is not None


@router.get("/estado")
def estado(request: Request, db: Session = Depends(get_db)):
    """Usado pela tela inicial: o sistema já foi configurado? Há alguém logado?"""
    usuario = usuario_da_requisicao(request, db)
    return {
        "configurado": _existe_usuario(db),
        "usuario": UsuarioOut.model_validate(usuario) if usuario else None,
    }


@router.post("/primeiro-acesso", response_model=UsuarioOut, status_code=201)
def primeiro_acesso(dados: PrimeiroAcessoIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Cria o primeiro dono. Só funciona enquanto não houver nenhum usuário."""
    if _existe_usuario(db):
        raise HTTPException(409, "O sistema já foi configurado")
    usuario = Usuario(nome=dados.nome, login=dados.login, senha_hash=gerar_hash(dados.senha), papel="dono")
    db.add(usuario)
    db.commit()
    iniciar_sessao(db, usuario, request, response)
    return usuario


@router.post("/login", response_model=UsuarioOut)
def login(dados: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    usuario = db.scalar(select(Usuario).where(Usuario.login == dados.login))
    if not autenticar(usuario, dados.senha):
        raise HTTPException(401, "Login ou senha inválidos")
    iniciar_sessao(db, usuario, request, response)
    return usuario


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    encerrar_sessao(db, request, response)


@router.get("/eu", response_model=UsuarioOut)
def eu(usuario: Usuario = Depends(usuario_atual)):
    return usuario


@router.post("/senha", status_code=204)
def trocar_senha(dados: TrocarSenhaIn, request: Request, usuario: Usuario = Depends(usuario_atual),
                 db: Session = Depends(get_db)):
    if not conferir_senha(dados.senha_atual, usuario.senha_hash):
        raise HTTPException(422, "Senha atual incorreta")
    usuario.senha_hash = gerar_hash(dados.nova_senha)
    # Desconecta os outros aparelhos, mantendo a sessão atual.
    encerrar_sessoes_do_usuario(db, usuario.id, exceto=request)
    db.commit()
