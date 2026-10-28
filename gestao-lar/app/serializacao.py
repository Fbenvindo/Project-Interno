from .models import Atividade, Tarefa


def url_foto(nome: str | None) -> str | None:
    return f"/uploads/{nome}" if nome else None


def atividade_out(a: Atividade) -> dict:
    return {
        "id": a.id,
        "nome": a.nome,
        "tipo": a.tipo,
        "descricao": a.descricao,
        "instrucoes": a.instrucoes,
        "periodo": a.periodo,
        "duracao_min": a.duracao_min,
        "frequencia": a.frequencia,
        "dias_semana": a.dias_semana_lista,
        "dia_mes": a.dia_mes,
        "data_inicio": a.data_inicio,
        "data_fim": a.data_fim,
        "ativa": a.ativa,
        "foto_referencia": url_foto(a.foto_referencia),
        "prestadores": [{"id": p.id, "nome": p.nome, "funcao": p.funcao} for p in a.prestadores],
        "recursos": [
            {
                "recurso_id": item.recurso_id,
                "nome": item.recurso.nome,
                "unidade": item.recurso.unidade,
                "quantidade": item.quantidade,
            }
            for item in a.recursos
        ],
    }


def tarefa_out(t: Tarefa, detalhada: bool = False) -> dict:
    a = t.atividade
    dados = {
        "id": t.id,
        "data": t.data,
        "periodo": t.periodo,
        "status": t.status,
        "atividade": {"id": a.id, "nome": a.nome, "tipo": a.tipo, "duracao_min": a.duracao_min},
        "prestador": {"id": t.prestador.id, "nome": t.prestador.nome} if t.prestador else None,
        "avaliacao": t.avaliacao,
        "nota": t.nota,
    }
    if detalhada:
        dados["atividade"].update({
            "descricao": a.descricao,
            "instrucoes": a.instrucoes,
            "foto_referencia": url_foto(a.foto_referencia),
        })
        dados.update({
            "materiais": [
                {
                    "recurso_id": item.recurso_id,
                    "nome": item.recurso.nome,
                    "unidade": item.recurso.unidade,
                    "quantidade": item.quantidade,
                    "estoque_atual": item.recurso.estoque_atual,
                    "suficiente": item.recurso.estoque_atual >= item.quantidade,
                }
                for item in a.recursos
            ],
            "foto": url_foto(t.foto),
            "analise": t.analise,
            "observacao": t.observacao,
            "iniciada_em": t.iniciada_em,
            "concluida_em": t.concluida_em,
        })
    return dados
