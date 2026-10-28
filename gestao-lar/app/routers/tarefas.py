from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import exigir_dono, usuario_atual
from ..cronograma import gerar_tarefas
from ..database import get_db
from ..estoque import movimentar
from ..fotos import ler_foto, salvar_foto
from ..models import Prestador, Recurso, Tarefa, Usuario
from ..schemas import ConcluirIn
from ..serializacao import tarefa_out
from ..visao import ImagemInvalida, analisar

router = APIRouter(prefix="/api", tags=["cronograma e execução"])

ORDEM_PERIODO = {"manha": 0, "tarde": 1, "noite": 2, "qualquer": 3}
LIMITE_DIAS = 366


def obter(db: Session, tarefa_id: int, usuario: Usuario) -> Tarefa:
    """Busca a tarefa; o prestador só enxerga as tarefas atribuídas a ele."""
    t = db.get(Tarefa, tarefa_id)
    if t is None or (usuario.papel == "prestador" and t.prestador_id != usuario.prestador_id):
        raise HTTPException(404, "Tarefa não encontrada")
    return t


def _exigir_aberta(t: Tarefa) -> None:
    if t.status in ("concluida", "cancelada"):
        raise HTTPException(409, f"Tarefa já está {t.status}")


@router.get("/cronograma")
def cronograma(inicio: date | None = None, fim: date | None = None, prestador_id: int | None = None,
               status: str | None = None, usuario: Usuario = Depends(usuario_atual),
               db: Session = Depends(get_db)):
    """Lista as tarefas do período, lançando automaticamente as que faltarem."""
    if usuario.papel == "prestador":
        prestador_id = usuario.prestador_id
    inicio = inicio or date.today()
    fim = fim or inicio + timedelta(days=6)
    if fim < inicio or (fim - inicio).days > LIMITE_DIAS:
        raise HTTPException(422, f"Período inválido (máximo de {LIMITE_DIAS} dias)")

    # Tarefas de datas passadas não são lançadas retroativamente.
    if fim >= date.today():
        gerar_tarefas(db, max(inicio, date.today()), fim)

    q = select(Tarefa).where(Tarefa.data.between(inicio, fim))
    if prestador_id:
        q = q.where(Tarefa.prestador_id == prestador_id)
    if status:
        q = q.where(Tarefa.status == status)
    tarefas = sorted(db.scalars(q).unique(), key=lambda t: (t.data, ORDEM_PERIODO.get(t.periodo, 9), t.atividade.nome))
    return [tarefa_out(t) for t in tarefas]


@router.post("/cronograma/gerar", dependencies=[Depends(exigir_dono)])
def gerar(dias: int = 30, db: Session = Depends(get_db)):
    if not 1 <= dias <= LIMITE_DIAS:
        raise HTTPException(422, f"dias deve estar entre 1 e {LIMITE_DIAS}")
    hoje = date.today()
    return {"criadas": gerar_tarefas(db, hoje, hoje + timedelta(days=dias))}


@router.get("/painel")
def painel(usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    hoje = date.today()
    gerar_tarefas(db, hoje)
    dono = usuario.papel == "dono"
    filtro = [] if dono else [Tarefa.prestador_id == usuario.prestador_id]
    tarefas = db.scalars(select(Tarefa).where(Tarefa.data == hoje, *filtro)).unique().all()
    contagem = {s: 0 for s in ("pendente", "em_andamento", "concluida", "cancelada")}
    for t in tarefas:
        contagem[t.status] = contagem.get(t.status, 0) + 1
    atrasadas = db.scalars(select(Tarefa).where(
        Tarefa.data < hoje, Tarefa.status.in_(("pendente", "em_andamento")), *filtro
    )).unique().all()
    alertas = db.scalars(select(Recurso).where(
        Recurso.ativo.is_(True), Recurso.estoque_atual <= Recurso.estoque_minimo
    )).all() if dono else []
    return {
        "data": hoje,
        "tarefas_hoje": contagem,
        "atrasadas": [tarefa_out(t) for t in sorted(atrasadas, key=lambda t: t.data)],
        "alertas_estoque": [
            {"id": r.id, "nome": r.nome, "estoque_atual": r.estoque_atual,
             "estoque_minimo": r.estoque_minimo, "unidade": r.unidade}
            for r in alertas
        ],
    }


@router.get("/tarefas/{tarefa_id}")
def detalhar(tarefa_id: int, usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    return tarefa_out(obter(db, tarefa_id, usuario), detalhada=True)


@router.post("/tarefas/{tarefa_id}/iniciar")
def iniciar(tarefa_id: int, usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    t = obter(db, tarefa_id, usuario)
    _exigir_aberta(t)
    t.status = "em_andamento"
    t.iniciada_em = t.iniciada_em or datetime.now()
    db.commit()
    return tarefa_out(t, detalhada=True)


@router.post("/tarefas/{tarefa_id}/prestador/{prestador_id}")
def trocar_prestador(tarefa_id: int, prestador_id: int,
                     usuario: Usuario = Depends(exigir_dono), db: Session = Depends(get_db)):
    t = obter(db, tarefa_id, usuario)
    _exigir_aberta(t)
    if db.get(Prestador, prestador_id) is None:
        raise HTTPException(404, "Prestador não encontrado")
    t.prestador_id = prestador_id
    db.commit()
    db.refresh(t)
    return tarefa_out(t, detalhada=True)


@router.post("/tarefas/{tarefa_id}/foto")
async def enviar_foto(tarefa_id: int, foto: UploadFile = File(...),
                      usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    """Recebe a foto da execução e roda a análise de visão computacional."""
    t = obter(db, tarefa_id, usuario)
    _exigir_aberta(t)
    dados = await foto.read()
    try:
        resultado = analisar(dados, ler_foto(t.atividade.foto_referencia))
    except ImagemInvalida as e:
        raise HTTPException(422, str(e))

    t.foto = salvar_foto(dados, f"tarefa_{t.id}", foto.filename)
    t.analise = resultado
    t.nota = resultado["nota"]
    t.avaliacao = resultado["avaliacao"]
    if t.status == "pendente":
        t.status = "em_andamento"
        t.iniciada_em = datetime.now()
    db.commit()
    return tarefa_out(t, detalhada=True)


@router.post("/tarefas/{tarefa_id}/concluir")
def concluir(tarefa_id: int, dados: ConcluirIn | None = None,
             usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    """Conclui a tarefa e baixa do estoque os materiais utilizados."""
    t = obter(db, tarefa_id, usuario)
    _exigir_aberta(t)
    dados = dados or ConcluirIn()

    if dados.consumo is None:
        consumo = [(item.recurso, item.quantidade) for item in t.atividade.recursos]
    else:
        consumo = []
        for item in dados.consumo:
            recurso = db.get(Recurso, item.recurso_id)
            if recurso is None:
                raise HTTPException(422, f"Recurso {item.recurso_id} não encontrado")
            consumo.append((recurso, item.quantidade))

    faltas = []
    for recurso, quantidade in consumo:
        if recurso.estoque_atual < quantidade:
            faltas.append(recurso.nome)
        movimentar(db, recurso, "consumo", quantidade, tarefa_id=t.id,
                   observacao=f"Tarefa: {t.atividade.nome} ({t.data:%d/%m})")

    agora = datetime.now()
    t.status = "concluida"
    t.iniciada_em = t.iniciada_em or agora
    t.concluida_em = agora
    t.observacao = dados.observacao
    db.commit()
    resposta = tarefa_out(t, detalhada=True)
    resposta["avisos"] = (
        [f"Estoque insuficiente registrado para: {', '.join(faltas)}. Confira o saldo."] if faltas else []
    )
    return resposta


@router.post("/tarefas/{tarefa_id}/cancelar")
def cancelar(tarefa_id: int, usuario: Usuario = Depends(exigir_dono), db: Session = Depends(get_db)):
    t = obter(db, tarefa_id, usuario)
    _exigir_aberta(t)
    t.status = "cancelada"
    db.commit()
    return tarefa_out(t, detalhada=True)


@router.post("/tarefas/{tarefa_id}/usar-como-referencia")
def usar_como_referencia(tarefa_id: int,
                         usuario: Usuario = Depends(exigir_dono), db: Session = Depends(get_db)):
    """Define a foto desta execução como o padrão esperado da atividade."""
    t = obter(db, tarefa_id, usuario)
    if not t.foto:
        raise HTTPException(409, "A tarefa não possui foto")
    t.atividade.foto_referencia = t.foto
    db.commit()
    return tarefa_out(t, detalhada=True)
