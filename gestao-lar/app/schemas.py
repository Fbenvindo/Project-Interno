from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TipoAtividade = Literal[
    "limpeza", "refeicao", "organizacao", "lavanderia", "manutencao",
    "jardinagem", "compras", "cuidados", "outro",
]
Periodo = Literal["manha", "tarde", "noite", "qualquer"]
Frequencia = Literal["unica", "diaria", "semanal", "quinzenal", "mensal"]


class PrestadorIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    funcao: str | None = None
    telefone: str | None = None
    custo_hora: float | None = Field(default=None, ge=0)
    ativo: bool = True


class PrestadorOut(PrestadorIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class RecursoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    categoria: str = "geral"
    unidade: str = "un"
    estoque_minimo: float = Field(default=0, ge=0)
    custo_unitario: float | None = Field(default=None, ge=0)
    ativo: bool = True


class RecursoCreate(RecursoIn):
    estoque_atual: float = Field(default=0, ge=0)


class RecursoOut(RecursoCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    abaixo_minimo: bool


class MovimentoIn(BaseModel):
    tipo: Literal["entrada", "consumo", "ajuste"]
    # Entrada/consumo: quantidade positiva. Ajuste: novo saldo do estoque.
    quantidade: float = Field(ge=0)
    observacao: str | None = None


class MovimentoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    recurso_id: int
    quantidade: float
    tipo: str
    tarefa_id: int | None
    observacao: str | None
    criado_em: datetime


class ItemRecurso(BaseModel):
    recurso_id: int
    quantidade: float = Field(gt=0)


class AtividadeIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    tipo: TipoAtividade = "outro"
    descricao: str | None = None
    instrucoes: str | None = None
    periodo: Periodo = "qualquer"
    duracao_min: int | None = Field(default=None, ge=0)
    frequencia: Frequencia = "semanal"
    dias_semana: list[int] = []
    dia_mes: int | None = Field(default=None, ge=1, le=31)
    data_inicio: date = Field(default_factory=date.today)
    data_fim: date | None = None
    ativa: bool = True
    prestador_ids: list[int] = []
    recursos: list[ItemRecurso] = []

    @field_validator("dias_semana")
    @classmethod
    def _dias_validos(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("dias_semana deve conter valores de 0 (segunda) a 6 (domingo)")
        return sorted(set(v))


class ConcluirIn(BaseModel):
    observacao: str | None = None
    # Quando informado, substitui o consumo padrão da atividade.
    consumo: list[ItemRecurso] | None = None
