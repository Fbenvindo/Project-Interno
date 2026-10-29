"""Criação das notificações (central do app + push) e resumo diário programado."""

import asyncio
import logging
import os
from datetime import date, time, timedelta

from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session

from . import push
from .database import SessionLocal
from .models import Notificacao, PreferenciaNotificacao, Recurso, Tarefa, Usuario
from .relogio import agora, hoje

log = logging.getLogger(__name__)

HORA_RESUMO = time.fromisoformat(os.environ.get("LAR_HORA_RESUMO", "07:00"))
RETENCAO_DIAS = 60
PERIODOS = {"manha": "Manhã", "tarde": "Tarde", "noite": "Noite", "qualquer": "Qualquer horário"}
AVALIACOES = {"revisar": "revisar", "reprovada": "reprovada", "foto_inadequada": "foto inadequada"}
ABERTAS = ("pendente", "em_andamento")

PREFERENCIAS_PADRAO = {
    "resumo_diario": True, "tarefa_atribuida": True, "tarefa_conferir": True,
    "tarefa_concluida": False, "estoque_baixo": True, "push": True,
}


def _num(v: float) -> str:
    return f"{v:,.2f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")


def preferencias(db: Session, usuario_id: int) -> PreferenciaNotificacao:
    p = db.get(PreferenciaNotificacao, usuario_id)
    if p is None:
        p = PreferenciaNotificacao(usuario_id=usuario_id, **PREFERENCIAS_PADRAO)
        db.add(p)
        db.flush()
    return p


def donos(db: Session) -> list[Usuario]:
    return list(db.scalars(select(Usuario).where(Usuario.papel == "dono", Usuario.ativo.is_(True))))


def usuario_do_prestador(db: Session, prestador_id: int | None) -> Usuario | None:
    if prestador_id is None:
        return None
    return db.scalar(select(Usuario).where(Usuario.prestador_id == prestador_id))


def notificar(db: Session, usuarios: list[Usuario], tipo: str, titulo: str, mensagem: str,
              link: str | None = None, chave: str | None = None) -> list[Notificacao]:
    """Registra a notificação para cada usuário (conforme as preferências dele).

    O push só é disparado depois do commit, para não avisar sobre algo que foi desfeito.
    """
    criadas, para_push = [], []
    for u in usuarios:
        if not u.pode_entrar:
            continue
        pref = preferencias(db, u.id)
        if tipo != "teste" and not getattr(pref, tipo):
            continue
        if chave and db.scalar(select(Notificacao.id).where(Notificacao.usuario_id == u.id, Notificacao.chave == chave)):
            continue
        n = Notificacao(usuario_id=u.id, tipo=tipo, titulo=titulo, mensagem=mensagem, link=link, chave=chave)
        db.add(n)
        criadas.append(n)
        if pref.push:
            para_push.append(u.id)
    db.flush()

    if para_push:
        conteudo = {"titulo": titulo, "mensagem": mensagem, "link": link, "tag": chave or tipo}
        event.listen(db, "after_commit", lambda _: push.agendar(para_push, conteudo), once=True)
    return criadas


# ---------- eventos ----------

def estoque_baixo(db: Session, recurso: Recurso) -> None:
    notificar(
        db, donos(db), "estoque_baixo",
        f"Estoque baixo: {recurso.nome}",
        f"Restam {_num(recurso.estoque_atual)} {recurso.unidade} (mínimo {_num(recurso.estoque_minimo)}).",
        link="aba:estoque",
    )


def tarefa_atribuida(db: Session, tarefa: Tarefa, autor: Usuario) -> None:
    destino = usuario_do_prestador(db, tarefa.prestador_id)
    if destino is None or destino.id == autor.id or tarefa.data < hoje():
        return
    notificar(
        db, [destino], "tarefa_atribuida",
        f"Nova tarefa: {tarefa.atividade.nome}",
        f"{tarefa.data:%d/%m} · {PERIODOS.get(tarefa.periodo, tarefa.periodo)}",
        link=f"tarefa:{tarefa.id}",
    )


def tarefa_concluida(db: Session, tarefa: Tarefa, autor: Usuario) -> None:
    destinos = [u for u in donos(db) if u.id != autor.id]
    if not destinos:
        return
    quem = tarefa.prestador.nome if tarefa.prestador else autor.nome
    nome = tarefa.atividade.nome
    if tarefa.avaliacao in AVALIACOES:
        nota = f" (nota {_num(tarefa.nota)})" if tarefa.nota is not None else ""
        notificar(db, destinos, "tarefa_conferir", f"Conferir: {nome}",
                  f"{quem} concluiu com avaliação da foto: {AVALIACOES[tarefa.avaliacao]}{nota}.",
                  link=f"tarefa:{tarefa.id}")
    elif tarefa.atividade.foto_referencia and not tarefa.foto:
        notificar(db, destinos, "tarefa_conferir", f"Conferir: {nome}",
                  f"{quem} concluiu sem enviar foto.", link=f"tarefa:{tarefa.id}")
    else:
        notificar(db, destinos, "tarefa_concluida", f"Concluída: {nome}",
                  f"{quem} concluiu a tarefa.", link=f"tarefa:{tarefa.id}")


# ---------- resumo diário ----------

def _resumo_prestador(tarefas: list[Tarefa], atrasadas: int) -> tuple[str, str] | None:
    if not tarefas and not atrasadas:
        return None
    linhas = [f"• {PERIODOS.get(t.periodo, t.periodo)}: {t.atividade.nome}" for t in tarefas]
    if atrasadas:
        linhas.append(f"⚠ {atrasadas} tarefa(s) atrasada(s)")
    return f"Suas tarefas de hoje ({len(tarefas)})", "\n".join(linhas)


def _resumo_dono(db: Session, tarefas: list[Tarefa], atrasadas: int) -> tuple[str, str] | None:
    from .estoque import lista_compras  # import tardio: estoque também importa este módulo

    faltas = [i for i in lista_compras(db, dias=1) if i["estoque_atual"] < i["consumo_previsto"]]
    baixos = db.scalars(select(Recurso).where(
        Recurso.ativo.is_(True), Recurso.estoque_atual <= Recurso.estoque_minimo
    )).all()
    sem_prestador = sum(1 for t in tarefas if t.prestador_id is None)
    if not (tarefas or atrasadas or faltas or baixos):
        return None

    linhas = [f"• {len(tarefas)} tarefa(s) para hoje"]
    if sem_prestador:
        linhas.append(f"• {sem_prestador} sem prestador definido")
    if atrasadas:
        linhas.append(f"⚠ {atrasadas} tarefa(s) atrasada(s)")
    if faltas:
        itens = ", ".join(f"{i['nome']} (precisa {_num(i['consumo_previsto'])} {i['unidade']}, "
                          f"tem {_num(i['estoque_atual'])})" for i in faltas)
        linhas.append(f"⚠ Faltam materiais para hoje/amanhã: {itens}")
    if baixos:
        linhas.append(f"• Estoque baixo: {', '.join(r.nome for r in baixos)}")
    return "Resumo do dia", "\n".join(linhas)


def enviar_resumos(db: Session, dia: date | None = None) -> int:
    """Um resumo por usuário por dia (repetir a chamada no mesmo dia não duplica)."""
    from .cronograma import gerar_tarefas

    dia = dia or hoje()
    gerar_tarefas(db, dia)
    ordem = {"manha": 0, "tarde": 1, "noite": 2, "qualquer": 3}
    tarefas_hoje = sorted(
        db.scalars(select(Tarefa).where(Tarefa.data == dia, Tarefa.status.in_(ABERTAS))).unique(),
        key=lambda t: (ordem.get(t.periodo, 9), t.atividade.nome),
    )
    atrasadas = db.scalars(select(Tarefa).where(Tarefa.data < dia, Tarefa.status.in_(ABERTAS))).unique().all()

    chave = f"resumo:{dia.isoformat()}"
    enviadas = 0
    for u in db.scalars(select(Usuario).where(Usuario.ativo.is_(True))).all():
        if u.papel == "prestador":
            resumo = _resumo_prestador(
                [t for t in tarefas_hoje if t.prestador_id == u.prestador_id],
                sum(1 for t in atrasadas if t.prestador_id == u.prestador_id),
            )
        else:
            resumo = _resumo_dono(db, tarefas_hoje, len(atrasadas))
        if resumo:
            enviadas += len(notificar(db, [u], "resumo_diario", *resumo, link="aba:hoje", chave=chave))

    db.execute(delete(Notificacao).where(
        Notificacao.lida.is_(True), Notificacao.criada_em < agora() - timedelta(days=RETENCAO_DIAS)
    ))
    db.commit()
    return enviadas


_ultimo_resumo: date | None = None


def _rodar_resumo(dia: date) -> None:
    global _ultimo_resumo
    with SessionLocal() as db:
        enviadas = enviar_resumos(db, dia)
    _ultimo_resumo = dia
    log.info("Resumo diário de %s: %d notificação(ões)", dia, enviadas)


async def agendador(intervalo: int = 60) -> None:
    """Verifica a cada minuto se já passou do horário do resumo diário."""
    while True:
        try:
            momento = agora()
            if momento.time() >= HORA_RESUMO and _ultimo_resumo != momento.date():
                await asyncio.to_thread(_rodar_resumo, momento.date())
        except Exception:  # noqa: BLE001 - o agendador não pode parar
            log.exception("Falha no agendador de notificações")
        await asyncio.sleep(intervalo)
