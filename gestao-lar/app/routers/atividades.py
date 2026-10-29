from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import exigir_dono
from ..cronograma import regenerar_futuras
from ..database import get_db
from ..fotos import salvar_foto
from ..models import Atividade, AtividadeRecurso, Prestador, Recurso
from ..schemas import AtividadeIn
from ..serializacao import atividade_out
from ..visao import ImagemInvalida, carregar

router = APIRouter(prefix="/api/atividades", tags=["atividades"], dependencies=[Depends(exigir_dono)])


def obter(db: Session, atividade_id: int) -> Atividade:
    a = db.get(Atividade, atividade_id)
    if a is None:
        raise HTTPException(404, "Atividade não encontrada")
    return a


def _aplicar(db: Session, a: Atividade, dados: AtividadeIn) -> None:
    if dados.data_fim and dados.data_fim < dados.data_inicio:
        raise HTTPException(422, "data_fim deve ser posterior a data_inicio")

    campos = dados.model_dump(exclude={"prestador_ids", "recursos", "dias_semana"})
    for campo, valor in campos.items():
        setattr(a, campo, valor)
    a.dias_semana = ",".join(str(d) for d in dados.dias_semana) or None

    prestadores = db.scalars(select(Prestador).where(Prestador.id.in_(dados.prestador_ids))).all()
    if len(prestadores) != len(set(dados.prestador_ids)):
        raise HTTPException(422, "Prestador inexistente na lista")
    a.prestadores = list(prestadores)

    ids_recursos = [item.recurso_id for item in dados.recursos]
    if len(ids_recursos) != len(set(ids_recursos)):
        raise HTTPException(422, "Recurso repetido na composição")
    existentes = set(db.scalars(select(Recurso.id).where(Recurso.id.in_(ids_recursos))))
    if existentes != set(ids_recursos):
        raise HTTPException(422, "Recurso inexistente na composição")
    a.recursos.clear()
    db.flush()
    a.recursos.extend(AtividadeRecurso(recurso_id=i.recurso_id, quantidade=i.quantidade) for i in dados.recursos)


@router.get("")
def listar(tipo: str | None = None, db: Session = Depends(get_db)):
    q = select(Atividade).order_by(Atividade.tipo, Atividade.nome)
    if tipo:
        q = q.where(Atividade.tipo == tipo)
    return [atividade_out(a) for a in db.scalars(q).unique()]


@router.post("", status_code=201)
def criar(dados: AtividadeIn, db: Session = Depends(get_db)):
    a = Atividade()
    db.add(a)
    _aplicar(db, a, dados)
    db.commit()
    regenerar_futuras(db, a)
    return atividade_out(a)


@router.get("/{atividade_id}")
def detalhar(atividade_id: int, db: Session = Depends(get_db)):
    return atividade_out(obter(db, atividade_id))


@router.put("/{atividade_id}")
def atualizar(atividade_id: int, dados: AtividadeIn, db: Session = Depends(get_db)):
    a = obter(db, atividade_id)
    _aplicar(db, a, dados)
    db.commit()
    regenerar_futuras(db, a)
    return atividade_out(a)


@router.delete("/{atividade_id}", status_code=204)
def excluir(atividade_id: int, db: Session = Depends(get_db)):
    db.delete(obter(db, atividade_id))
    db.commit()


@router.post("/{atividade_id}/referencia")
async def enviar_referencia(atividade_id: int, foto: UploadFile = File(...), db: Session = Depends(get_db)):
    """Foto de como o ambiente deve ficar após a execução correta."""
    a = obter(db, atividade_id)
    dados = await foto.read()
    try:
        carregar(dados)
    except ImagemInvalida as e:
        raise HTTPException(422, str(e))
    a.foto_referencia = salvar_foto(db, dados, f"referencia_{a.id}")
    db.commit()
    return atividade_out(a)
