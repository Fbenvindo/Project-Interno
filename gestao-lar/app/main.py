from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .cronograma import gerar_tarefas
from .database import UPLOAD_DIR, SessionLocal, criar_tabelas
from .routers import atividades, prestadores, recursos, tarefas

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    criar_tabelas()
    with SessionLocal() as db:
        gerar_tarefas(db)
    yield


app = FastAPI(
    title="Gestão do Lar",
    description="Tarefas da casa, prestadores, estoque, receitas e conferência por foto.",
    version="0.1.0",
    lifespan=lifespan,
)

for modulo in (prestadores, recursos, atividades, tarefas):
    app.include_router(modulo.router)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
