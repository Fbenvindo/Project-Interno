"""Geração automática do cronograma a partir da frequência das atividades."""

import calendar
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Atividade, Tarefa
from .relogio import hoje

HORIZONTE_PADRAO_DIAS = 30


def _intervalo(inicio: date, fim: date):
    d = inicio
    while d <= fim:
        yield d
        d += timedelta(days=1)


def ocorrencias(atividade: Atividade, inicio: date, fim: date) -> list[date]:
    """Datas em que a atividade deve acontecer dentro de [inicio, fim]."""
    ini = max(inicio, atividade.data_inicio)
    end = min(fim, atividade.data_fim) if atividade.data_fim else fim
    if ini > end:
        return []

    freq = atividade.frequencia
    dias_semana = atividade.dias_semana_lista

    if freq == "unica":
        return [atividade.data_inicio] if ini <= atividade.data_inicio <= end else []

    if freq == "diaria":
        # Na frequência diária, dias_semana é opcional (ex.: só dias úteis).
        return [d for d in _intervalo(ini, end) if not dias_semana or d.weekday() in dias_semana]

    if freq in ("semanal", "quinzenal"):
        dias = dias_semana or [atividade.data_inicio.weekday()]
        semana_base = atividade.data_inicio - timedelta(days=atividade.data_inicio.weekday())
        datas = []
        for d in _intervalo(ini, end):
            if d.weekday() not in dias:
                continue
            if freq == "quinzenal" and ((d - semana_base).days // 7) % 2 != 0:
                continue
            datas.append(d)
        return datas

    if freq == "mensal":
        dia = atividade.dia_mes or atividade.data_inicio.day
        datas = []
        for d in _intervalo(ini, end):
            ultimo = calendar.monthrange(d.year, d.month)[1]
            if d.day == min(dia, ultimo):
                datas.append(d)
        return datas

    raise ValueError(f"Frequência desconhecida: {freq}")


def gerar_tarefas(db: Session, inicio: date | None = None, fim: date | None = None,
                  atividade: Atividade | None = None) -> int:
    """Cria as tarefas que ainda não existem no período. Retorna quantas foram criadas.

    O prestador de cada tarefa é escolhido em rodízio entre os prestadores ativos
    vinculados à atividade, contando as ocorrências desde a data de início.
    """
    inicio = inicio or hoje()
    fim = fim or inicio + timedelta(days=HORIZONTE_PADRAO_DIAS)

    if atividade is not None:
        atividades = [atividade]
    else:
        atividades = db.scalars(select(Atividade).where(Atividade.ativa.is_(True))).all()

    criadas = 0
    for atv in atividades:
        if not atv.ativa:
            continue
        existentes = set(db.scalars(
            select(Tarefa.data).where(Tarefa.atividade_id == atv.id, Tarefa.data.between(inicio, fim))
        ))
        prestadores = [p for p in atv.prestadores if p.ativo]
        for indice, d in enumerate(ocorrencias(atv, atv.data_inicio, fim)):
            if d < inicio or d in existentes:
                continue
            db.add(Tarefa(
                atividade_id=atv.id,
                data=d,
                periodo=atv.periodo,
                prestador_id=prestadores[indice % len(prestadores)].id if prestadores else None,
            ))
            criadas += 1
    db.commit()
    return criadas


def regenerar_futuras(db: Session, atividade: Atividade) -> int:
    """Após editar uma atividade, refaz as tarefas pendentes a partir de hoje."""
    dia = hoje()
    for t in db.scalars(select(Tarefa).where(
        Tarefa.atividade_id == atividade.id, Tarefa.data >= dia, Tarefa.status == "pendente"
    )):
        db.delete(t)
    db.flush()
    return gerar_tarefas(db, dia, atividade=atividade)
