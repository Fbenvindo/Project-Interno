import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .auth import usuario_atual
from .cronograma import gerar_tarefas
from .database import SERVERLESS, SessionLocal, criar_tabelas, get_db
from .fotos import ler_foto
from .models import Atividade, Tarefa, Usuario
from .notificacoes import agendador
from .routers import atividades, auth, notificacoes, prestadores, recursos, tarefas, usuarios

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    criar_tabelas()
    with SessionLocal() as db:
        gerar_tarefas(db)
    # Resumo diário de notificações (desligável com LAR_AGENDADOR=0, ex.: nos testes).
    # Em serverless não há processo contínuo: quem dispara o resumo é o Cron da Vercel (vercel.json).
    ligado = os.environ.get("LAR_AGENDADOR", "1") != "0" and not SERVERLESS
    tarefa = asyncio.create_task(agendador()) if ligado else None
    yield
    if tarefa:
        tarefa.cancel()


app = FastAPI(
    title="Gestão do Lar",
    description="Tarefas da casa, prestadores, estoque, receitas e conferência por foto.",
    version="0.4.0",
    lifespan=lifespan,
)

for modulo in (auth, usuarios, notificacoes, prestadores, recursos, atividades, tarefas):
    app.include_router(modulo.router)
app.include_router(notificacoes.cron)


@app.get("/uploads/{nome}", include_in_schema=False)
def foto(nome: str, usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    """Fotos exigem login; o prestador só acessa as fotos das próprias tarefas."""
    if usuario.papel == "prestador":
        permitida = db.scalar(
            select(Tarefa.id)
            .join(Atividade)
            .where(Tarefa.prestador_id == usuario.prestador_id,
                   or_(Tarefa.foto == nome, Atividade.foto_referencia == nome))
            .limit(1)
        )
        if permitida is None:
            raise HTTPException(404, "Foto não encontrada")
    dados = ler_foto(db, nome)
    if dados is None:
        raise HTTPException(404, "Foto não encontrada")
    # O nome de cada foto é único e nunca muda: o navegador pode guardar em cache.
    return Response(dados, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
