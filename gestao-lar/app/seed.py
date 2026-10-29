"""Popula o banco com dados de exemplo: python -m app.seed"""

from sqlalchemy import select

from .cronograma import gerar_tarefas
from .database import SessionLocal, criar_tabelas
from .estoque import movimentar
from .auth import gerar_hash
from .models import Atividade, AtividadeRecurso, Prestador, Recurso, Usuario
from .relogio import hoje

# Apenas para demonstração: troque as senhas antes de usar de verdade.
SENHA_DONO_DEMO = "dono123"
SENHA_PRESTADOR_DEMO = "123456"
LOGINS_PRESTADORES = {"Maria Souza": "maria", "João Lima": "joao", "Carlos Reis": "carlos"}

PRESTADORES = [
    {"nome": "Maria Souza", "funcao": "Diarista", "telefone": "(11) 99999-0001", "custo_hora": 30},
    {"nome": "João Lima", "funcao": "Cozinheiro", "telefone": "(11) 99999-0002", "custo_hora": 35},
    {"nome": "Carlos Reis", "funcao": "Jardineiro", "telefone": "(11) 99999-0003", "custo_hora": 40},
]

# nome, categoria, unidade, estoque, mínimo, custo unitário
RECURSOS = [
    ("Detergente", "limpeza", "ml", 1000, 200, 0.006),
    ("Desinfetante", "limpeza", "ml", 2000, 500, 0.008),
    ("Sabão em pó", "lavanderia", "g", 2000, 500, 0.012),
    ("Amaciante", "lavanderia", "ml", 1000, 300, 0.01),
    ("Saco de lixo", "limpeza", "un", 30, 10, 0.5),
    ("Arroz", "alimento", "g", 5000, 1000, 0.006),
    ("Feijão", "alimento", "g", 2000, 500, 0.009),
    ("Óleo", "alimento", "ml", 900, 300, 0.009),
    ("Alho", "alimento", "un", 20, 5, 0.3),
    ("Cebola", "alimento", "un", 10, 3, 0.6),
    ("Sal", "alimento", "g", 1000, 200, 0.003),
    ("Ovos", "alimento", "un", 24, 12, 0.8),
    ("Adubo", "jardim", "g", 3000, 500, 0.01),
]

ATIVIDADES = [
    {
        "nome": "Limpeza da cozinha", "tipo": "limpeza", "periodo": "manha", "duracao_min": 40,
        "frequencia": "diaria", "dias_semana": "0,1,2,3,4,5", "prestadores": ["Maria Souza"],
        "instrucoes": "1. Lavar a louça\n2. Limpar bancadas e fogão\n3. Varrer e passar pano no chão\n4. Retirar o lixo",
        "recursos": [("Detergente", 40), ("Desinfetante", 50), ("Saco de lixo", 1)],
    },
    {
        "nome": "Organizar a sala", "tipo": "organizacao", "periodo": "tarde", "duracao_min": 30,
        "frequencia": "semanal", "dias_semana": "1,4", "prestadores": ["Maria Souza"],
        "instrucoes": "Almofadas no sofá, controles na bandeja, revistas na estante, nada no chão.",
        "recursos": [],
    },
    {
        "nome": "Lavar roupas", "tipo": "lavanderia", "periodo": "manha", "duracao_min": 90,
        "frequencia": "semanal", "dias_semana": "0,3", "prestadores": ["Maria Souza"],
        "instrucoes": "Separar brancas e coloridas. Ciclo normal. Estender na sombra.",
        "recursos": [("Sabão em pó", 150), ("Amaciante", 80)],
    },
    {
        "nome": "Almoço: arroz, feijão e omelete", "tipo": "refeicao", "periodo": "manha", "duracao_min": 60,
        "frequencia": "diaria", "dias_semana": "0,1,2,3,4", "prestadores": ["João Lima"],
        "descricao": "Receita para 4 pessoas.",
        "instrucoes": (
            "Arroz: refogue 1 dente de alho no óleo, junte o arroz, 2x a medida de água e sal. Cozinhe 20 min.\n"
            "Feijão: cozinhe na pressão por 30 min; refogue alho e cebola e tempere.\n"
            "Omelete: bata os ovos com sal e frite em fogo baixo."
        ),
        "recursos": [("Arroz", 300), ("Feijão", 200), ("Óleo", 30), ("Alho", 2), ("Cebola", 1),
                     ("Sal", 10), ("Ovos", 4)],
    },
    {
        "nome": "Cuidar do jardim", "tipo": "jardinagem", "periodo": "manha", "duracao_min": 120,
        "frequencia": "quinzenal", "dias_semana": "5", "prestadores": ["Carlos Reis"],
        "instrucoes": "Cortar a grama, podar arbustos e adubar os canteiros.",
        "recursos": [("Adubo", 300)],
    },
    {
        "nome": "Limpeza pesada dos banheiros", "tipo": "limpeza", "periodo": "tarde", "duracao_min": 90,
        "frequencia": "mensal", "dia_mes": 15, "prestadores": ["Maria Souza"],
        "instrucoes": "Esfregar rejuntes, limpar box e azulejos, desinfetar vaso e pia.",
        "recursos": [("Desinfetante", 300), ("Detergente", 50)],
    },
]


def popular() -> None:
    criar_tabelas()
    with SessionLocal() as db:
        if db.scalar(select(Atividade.id).limit(1)):
            print("O banco já possui atividades; nada foi alterado.")
            return

        prestadores = {p["nome"]: Prestador(**p) for p in PRESTADORES}
        db.add_all(prestadores.values())

        criar_dono = db.scalar(select(Usuario.id).limit(1)) is None
        if criar_dono:
            db.add(Usuario(nome="Dono da casa", login="dono", senha_hash=gerar_hash(SENHA_DONO_DEMO), papel="dono"))
        for nome, login in LOGINS_PRESTADORES.items():
            if db.scalar(select(Usuario.id).where(Usuario.login == login)) is None:
                db.add(Usuario(nome=nome, login=login, senha_hash=gerar_hash(SENHA_PRESTADOR_DEMO),
                               papel="prestador", prestador=prestadores[nome]))

        recursos = {}
        for nome, categoria, unidade, estoque, minimo, custo in RECURSOS:
            r = Recurso(nome=nome, categoria=categoria, unidade=unidade, estoque_atual=0,
                        estoque_minimo=minimo, custo_unitario=custo)
            db.add(r)
            db.flush()
            movimentar(db, r, "entrada", estoque, observacao="Estoque inicial")
            recursos[nome] = r

        for dados in ATIVIDADES:
            dados = dict(dados)
            nomes_prestadores = dados.pop("prestadores")
            itens = dados.pop("recursos")
            a = Atividade(**dados, data_inicio=hoje())
            a.prestadores = [prestadores[n] for n in nomes_prestadores]
            a.recursos = [AtividadeRecurso(recurso=recursos[n], quantidade=q) for n, q in itens]
            db.add(a)
        db.commit()

        criadas = gerar_tarefas(db)
        print(f"Dados de exemplo criados. {criadas} tarefas lançadas para os próximos 30 dias.")
        print("Acessos de demonstração (troque as senhas antes de usar de verdade):")
        if criar_dono:
            print(f"  dono   / {SENHA_DONO_DEMO}")
        for login in LOGINS_PRESTADORES.values():
            print(f"  {login:<6} / {SENHA_PRESTADOR_DEMO}  (prestador)")


if __name__ == "__main__":
    popular()
