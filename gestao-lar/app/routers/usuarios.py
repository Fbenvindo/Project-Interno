from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import encerrar_sessoes_do_usuario, exigir_dono, gerar_hash
from ..database import get_db
from ..models import Prestador, Usuario
from ..schemas import UsuarioIn, UsuarioOut

router = APIRouter(prefix="/api/usuarios", tags=["usuários"], dependencies=[Depends(exigir_dono)])


def obter(db: Session, usuario_id: int) -> Usuario:
    u = db.get(Usuario, usuario_id)
    if u is None:
        raise HTTPException(404, "Usuário não encontrado")
    return u


def _validar(db: Session, dados: UsuarioIn, atual: Usuario | None = None) -> None:
    mesmo_login = db.scalar(select(Usuario).where(Usuario.login == dados.login))
    if mesmo_login is not None and mesmo_login is not atual:
        raise HTTPException(409, "Este login já está em uso")

    if dados.papel == "dono":
        if dados.prestador_id is not None:
            raise HTTPException(422, "Usuário dono não deve ser vinculado a um prestador")
    else:
        if dados.prestador_id is None or db.get(Prestador, dados.prestador_id) is None:
            raise HTTPException(422, "Selecione o prestador vinculado a este acesso")
        vinculado = db.scalar(select(Usuario).where(Usuario.prestador_id == dados.prestador_id))
        if vinculado is not None and vinculado is not atual:
            raise HTTPException(409, f"Este prestador já possui o acesso '{vinculado.login}'")

    if atual is not None and atual.papel == "dono" and atual.ativo and (dados.papel != "dono" or not dados.ativo):
        _garantir_outro_dono(db, atual)


def _garantir_outro_dono(db: Session, usuario: Usuario) -> None:
    outros = db.scalar(select(func.count(Usuario.id)).where(
        Usuario.papel == "dono", Usuario.ativo.is_(True), Usuario.id != usuario.id
    ))
    if not outros:
        raise HTTPException(409, "É preciso manter pelo menos um dono ativo")


@router.get("", response_model=list[UsuarioOut])
def listar(db: Session = Depends(get_db)):
    return db.scalars(select(Usuario).order_by(Usuario.papel, Usuario.nome)).all()


@router.post("", response_model=UsuarioOut, status_code=201)
def criar(dados: UsuarioIn, db: Session = Depends(get_db)):
    if not dados.senha:
        raise HTTPException(422, "Informe uma senha para o novo acesso")
    _validar(db, dados)
    u = Usuario(**dados.model_dump(exclude={"senha"}), senha_hash=gerar_hash(dados.senha))
    db.add(u)
    db.commit()
    return u


@router.put("/{usuario_id}", response_model=UsuarioOut)
def atualizar(usuario_id: int, dados: UsuarioIn, db: Session = Depends(get_db)):
    u = obter(db, usuario_id)
    _validar(db, dados, atual=u)
    for campo, valor in dados.model_dump(exclude={"senha"}).items():
        setattr(u, campo, valor)
    if dados.senha:
        u.senha_hash = gerar_hash(dados.senha)
        encerrar_sessoes_do_usuario(db, u.id)
    db.commit()
    return u


@router.delete("/{usuario_id}", status_code=204)
def excluir(usuario_id: int, db: Session = Depends(get_db)):
    u = obter(db, usuario_id)
    if u.papel == "dono":
        _garantir_outro_dono(db, u)
    db.delete(u)
    db.commit()
