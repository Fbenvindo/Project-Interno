from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Prestador
from ..schemas import PrestadorIn, PrestadorOut

router = APIRouter(prefix="/api/prestadores", tags=["prestadores"])


def obter(db: Session, prestador_id: int) -> Prestador:
    p = db.get(Prestador, prestador_id)
    if p is None:
        raise HTTPException(404, "Prestador não encontrado")
    return p


@router.get("", response_model=list[PrestadorOut])
def listar(apenas_ativos: bool = False, db: Session = Depends(get_db)):
    q = select(Prestador).order_by(Prestador.nome)
    if apenas_ativos:
        q = q.where(Prestador.ativo.is_(True))
    return db.scalars(q).all()


@router.post("", response_model=PrestadorOut, status_code=201)
def criar(dados: PrestadorIn, db: Session = Depends(get_db)):
    p = Prestador(**dados.model_dump())
    db.add(p)
    db.commit()
    return p


@router.get("/{prestador_id}", response_model=PrestadorOut)
def detalhar(prestador_id: int, db: Session = Depends(get_db)):
    return obter(db, prestador_id)


@router.put("/{prestador_id}", response_model=PrestadorOut)
def atualizar(prestador_id: int, dados: PrestadorIn, db: Session = Depends(get_db)):
    p = obter(db, prestador_id)
    for campo, valor in dados.model_dump().items():
        setattr(p, campo, valor)
    db.commit()
    return p


@router.delete("/{prestador_id}", status_code=204)
def excluir(prestador_id: int, db: Session = Depends(get_db)):
    db.delete(obter(db, prestador_id))
    db.commit()
