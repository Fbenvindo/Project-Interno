from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import notificacoes
from .models import MovimentoEstoque, Recurso, Tarefa


def movimentar(db: Session, recurso: Recurso, tipo: str, quantidade: float,
               tarefa_id: int | None = None, observacao: str | None = None) -> MovimentoEstoque:
    """Registra um movimento e atualiza o saldo. Para 'ajuste', quantidade é o novo saldo.

    Avisa os donos quando o saldo cruza o estoque mínimo (só na passagem, sem repetir).
    """
    if tipo == "entrada":
        delta = quantidade
    elif tipo == "consumo":
        # O saldo não fica negativo; se faltou, o cadastro estava desatualizado.
        delta = -min(quantidade, recurso.estoque_atual)
    elif tipo == "ajuste":
        delta = quantidade - recurso.estoque_atual
    else:
        raise ValueError(f"Tipo de movimento inválido: {tipo}")

    estava_acima = recurso.estoque_atual > recurso.estoque_minimo
    recurso.estoque_atual = round(recurso.estoque_atual + delta, 4)
    mov = MovimentoEstoque(recurso_id=recurso.id, quantidade=delta, tipo=tipo,
                           tarefa_id=tarefa_id, observacao=observacao)
    db.add(mov)
    if estava_acima and recurso.abaixo_minimo and recurso.ativo:
        notificacoes.estoque_baixo(db, recurso)
    return mov


def lista_compras(db: Session, dias: int = 7) -> list[dict]:
    """Sugere compras: consumo previsto nas tarefas pendentes + estoque mínimo - saldo."""
    hoje = date.today()
    previsto: dict[int, float] = {}
    tarefas = db.scalars(select(Tarefa).where(
        Tarefa.data.between(hoje, hoje + timedelta(days=dias)),
        Tarefa.status.in_(("pendente", "em_andamento")),
    )).unique()
    for t in tarefas:
        for item in t.atividade.recursos:
            previsto[item.recurso_id] = previsto.get(item.recurso_id, 0) + item.quantidade

    itens = []
    for r in db.scalars(select(Recurso).where(Recurso.ativo.is_(True)).order_by(Recurso.nome)):
        necessario = previsto.get(r.id, 0)
        comprar = round(necessario + r.estoque_minimo - r.estoque_atual, 4)
        if comprar > 0 and (necessario > 0 or r.abaixo_minimo):
            itens.append({
                "recurso_id": r.id,
                "nome": r.nome,
                "categoria": r.categoria,
                "unidade": r.unidade,
                "estoque_atual": r.estoque_atual,
                "estoque_minimo": r.estoque_minimo,
                "consumo_previsto": round(necessario, 4),
                "comprar": comprar,
                "custo_estimado": round(comprar * r.custo_unitario, 2) if r.custo_unitario else None,
            })
    return itens
