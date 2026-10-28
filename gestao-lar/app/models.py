from datetime import date, datetime

from sqlalchemy import JSON, Column, Date, DateTime, Float, ForeignKey, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

TIPOS_ATIVIDADE = (
    "limpeza", "refeicao", "organizacao", "lavanderia", "manutencao",
    "jardinagem", "compras", "cuidados", "outro",
)
PERIODOS = ("manha", "tarde", "noite", "qualquer")
FREQUENCIAS = ("unica", "diaria", "semanal", "quinzenal", "mensal")
STATUS_TAREFA = ("pendente", "em_andamento", "concluida", "cancelada")
TIPOS_MOVIMENTO = ("entrada", "consumo", "ajuste")
PAPEIS = ("dono", "prestador")

atividade_prestadores = Table(
    "atividade_prestadores",
    Base.metadata,
    Column("atividade_id", ForeignKey("atividades.id", ondelete="CASCADE"), primary_key=True),
    Column("prestador_id", ForeignKey("prestadores.id", ondelete="CASCADE"), primary_key=True),
)


class Prestador(Base):
    __tablename__ = "prestadores"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    funcao: Mapped[str | None] = mapped_column(String(80))
    telefone: Mapped[str | None] = mapped_column(String(30))
    custo_hora: Mapped[float | None] = mapped_column(Float)
    ativo: Mapped[bool] = mapped_column(default=True)


class Recurso(Base):
    """Recurso material: produto de limpeza, ingrediente, utensílio etc."""

    __tablename__ = "recursos"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    categoria: Mapped[str] = mapped_column(String(60), default="geral")
    unidade: Mapped[str] = mapped_column(String(20), default="un")
    estoque_atual: Mapped[float] = mapped_column(Float, default=0)
    estoque_minimo: Mapped[float] = mapped_column(Float, default=0)
    custo_unitario: Mapped[float | None] = mapped_column(Float)
    ativo: Mapped[bool] = mapped_column(default=True)

    @property
    def abaixo_minimo(self) -> bool:
        return self.estoque_atual <= self.estoque_minimo


class AtividadeRecurso(Base):
    """Composição de materiais de uma atividade (ou ingredientes de uma receita)."""

    __tablename__ = "atividade_recursos"

    atividade_id: Mapped[int] = mapped_column(ForeignKey("atividades.id", ondelete="CASCADE"), primary_key=True)
    recurso_id: Mapped[int] = mapped_column(ForeignKey("recursos.id", ondelete="CASCADE"), primary_key=True)
    quantidade: Mapped[float] = mapped_column(Float)

    recurso: Mapped[Recurso] = relationship(lazy="joined")


class Atividade(Base):
    __tablename__ = "atividades"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    tipo: Mapped[str] = mapped_column(String(30), default="outro")
    descricao: Mapped[str | None] = mapped_column(Text)
    # Passo a passo da atividade ou modo de preparo, no caso de receitas.
    instrucoes: Mapped[str | None] = mapped_column(Text)
    periodo: Mapped[str] = mapped_column(String(20), default="qualquer")
    duracao_min: Mapped[int | None]
    frequencia: Mapped[str] = mapped_column(String(20), default="semanal")
    # Dias da semana no padrão do Python (0 = segunda ... 6 = domingo), ex.: "0,2,4".
    dias_semana: Mapped[str | None] = mapped_column(String(20))
    dia_mes: Mapped[int | None]
    data_inicio: Mapped[date] = mapped_column(Date, default=date.today)
    data_fim: Mapped[date | None] = mapped_column(Date)
    ativa: Mapped[bool] = mapped_column(default=True)
    foto_referencia: Mapped[str | None] = mapped_column(String(255))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    prestadores: Mapped[list[Prestador]] = relationship(
        secondary=atividade_prestadores, order_by=Prestador.id, lazy="selectin"
    )
    recursos: Mapped[list[AtividadeRecurso]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )
    tarefas: Mapped[list["Tarefa"]] = relationship(
        back_populates="atividade", cascade="all, delete-orphan"
    )

    @property
    def dias_semana_lista(self) -> list[int]:
        if not self.dias_semana:
            return []
        return sorted({int(d) for d in self.dias_semana.split(",") if d.strip() != ""})


class Tarefa(Base):
    """Ocorrência agendada de uma atividade em uma data."""

    __tablename__ = "tarefas"
    __table_args__ = (UniqueConstraint("atividade_id", "data"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    atividade_id: Mapped[int] = mapped_column(ForeignKey("atividades.id", ondelete="CASCADE"))
    data: Mapped[date] = mapped_column(Date, index=True)
    periodo: Mapped[str] = mapped_column(String(20), default="qualquer")
    prestador_id: Mapped[int | None] = mapped_column(ForeignKey("prestadores.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="pendente")
    iniciada_em: Mapped[datetime | None] = mapped_column(DateTime)
    concluida_em: Mapped[datetime | None] = mapped_column(DateTime)
    observacao: Mapped[str | None] = mapped_column(Text)
    foto: Mapped[str | None] = mapped_column(String(255))
    analise: Mapped[dict | None] = mapped_column(JSON)
    nota: Mapped[float | None] = mapped_column(Float)
    avaliacao: Mapped[str | None] = mapped_column(String(30))

    atividade: Mapped[Atividade] = relationship(back_populates="tarefas", lazy="joined")
    prestador: Mapped[Prestador | None] = relationship(lazy="joined")


class MovimentoEstoque(Base):
    __tablename__ = "movimentos_estoque"

    id: Mapped[int] = mapped_column(primary_key=True)
    recurso_id: Mapped[int] = mapped_column(ForeignKey("recursos.id", ondelete="CASCADE"), index=True)
    # Positivo = entrada, negativo = saída.
    quantidade: Mapped[float] = mapped_column(Float)
    tipo: Mapped[str] = mapped_column(String(20))
    tarefa_id: Mapped[int | None] = mapped_column(ForeignKey("tarefas.id", ondelete="SET NULL"))
    observacao: Mapped[str | None] = mapped_column(String(255))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Usuario(Base):
    """Acesso ao sistema. O dono gerencia tudo; o prestador vê apenas as próprias tarefas."""

    __tablename__ = "usuarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    login: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    senha_hash: Mapped[str] = mapped_column(String(200))
    papel: Mapped[str] = mapped_column(String(20))
    prestador_id: Mapped[int | None] = mapped_column(
        ForeignKey("prestadores.id", ondelete="CASCADE"), unique=True
    )
    ativo: Mapped[bool] = mapped_column(default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    prestador: Mapped[Prestador | None] = relationship(lazy="joined")

    @property
    def pode_entrar(self) -> bool:
        if not self.ativo:
            return False
        return self.papel == "dono" or (self.prestador is not None and self.prestador.ativo)


class Sessao(Base):
    __tablename__ = "sessoes"

    # Guardamos apenas o hash do token; o token em si fica só no cookie do navegador.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id", ondelete="CASCADE"), index=True)
    criada_em: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    expira_em: Mapped[datetime] = mapped_column(DateTime)

    usuario: Mapped[Usuario] = relationship(lazy="joined")
