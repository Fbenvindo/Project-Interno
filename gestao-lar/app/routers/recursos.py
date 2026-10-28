from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import exigir_dono
from ..database import get_db
from ..estoque import lista_compras, movimentar
from ..models import MovimentoEstoque, Recurso
from ..schemas import MovimentoIn, MovimentoOut, RecursoCreate, RecursoIn, RecursoOut

router = APIRouter(prefix="/api/recursos", tags=["recursos"], dependencies=[Depends(exigir_dono)])


def obter(db: Session, recurso_id: int) -> Recurso:
    r = db.get(Recurso, recurso_id)
    if r is None:
        raise HTTPException(404, "Recurso não encontrado")
    return r


@router.get("", response_model=list[RecursoOut])
def listar(categoria: str | None = None, alertas: bool = False, db: Session = Depends(get_db)):
    q = select(Recurso).order_by(Recurso.categoria, Recurso.nome)
    if categoria:
        q = q.where(Recurso.categoria == categoria)
    if alertas:
        q = q.where(Recurso.ativo.is_(True), Recurso.estoque_atual <= Recurso.estoque_minimo)
    return db.scalars(q).all()


@router.get("/lista-compras")
def compras(dias: int = 7, db: Session = Depends(get_db)):
    return lista_compras(db, dias)


@router.post("", response_model=RecursoOut, status_code=201)
def criar(dados: RecursoCreate, db: Session = Depends(get_db)):
    r = Recurso(**dados.model_dump(exclude={"estoque_atual"}), estoque_atual=0)
    db.add(r)
    db.flush()
    if dados.estoque_atual:
        movimentar(db, r, "entrada", dados.estoque_atual, observacao="Estoque inicial")
    db.commit()
    return r


@router.get("/{recurso_id}", response_model=RecursoOut)
def detalhar(recurso_id: int, db: Session = Depends(get_db)):
    return obter(db, recurso_id)


@router.put("/{recurso_id}", response_model=RecursoOut)
def atualizar(recurso_id: int, dados: RecursoIn, db: Session = Depends(get_db)):
    r = obter(db, recurso_id)
    for campo, valor in dados.model_dump().items():
        setattr(r, campo, valor)
    db.commit()
    return r


@router.delete("/{recurso_id}", status_code=204)
def excluir(recurso_id: int, db: Session = Depends(get_db)):
    db.delete(obter(db, recurso_id))
    db.commit()


@router.get("/{recurso_id}/movimentos", response_model=list[MovimentoOut])
def movimentos(recurso_id: int, db: Session = Depends(get_db)):
    obter(db, recurso_id)
    return db.scalars(
        select(MovimentoEstoque)
        .where(MovimentoEstoque.recurso_id == recurso_id)
        .order_by(MovimentoEstoque.criado_em.desc(), MovimentoEstoque.id.desc())
    ).all()


@router.post("/{recurso_id}/movimentos", response_model=RecursoOut, status_code=201)
def registrar_movimento(recurso_id: int, dados: MovimentoIn, db: Session = Depends(get_db)):
    r = obter(db, recurso_id)
    movimentar(db, r, dados.tipo, dados.quantidade, observacao=dados.observacao)
    db.commit()
    return r
