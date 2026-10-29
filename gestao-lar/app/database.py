import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

BASE_DIR = Path(__file__).resolve().parent.parent
# Na Vercel (serverless) só /tmp é gravável e não há processo contínuo.
SERVERLESS = bool(os.environ.get("VERCEL"))
DATA_DIR = Path(os.environ.get("LAR_DATA_DIR", "/tmp/gestao-lar" if SERVERLESS else BASE_DIR / "data"))
# Pasta das fotos da versão 0.3 e anteriores; hoje as fotos ficam no banco.
UPLOAD_DIR = DATA_DIR / "uploads"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _url_banco() -> str:
    # DATABASE_URL é a variável criada pela integração Neon da Vercel.
    url = os.environ.get("LAR_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        return f"sqlite:///{DATA_DIR / 'lar.db'}"
    for prefixo in ("postgres://", "postgresql://"):
        if url.startswith(prefixo):
            return "postgresql+psycopg://" + url[len(prefixo):]
    return url


DATABASE_URL = _url_banco()
SQLITE = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if SQLITE else {},
    # No Postgres (Neon) o pool fica a cargo do pooler do Neon: cada requisição abre e fecha.
    poolclass=None if SQLITE else NullPool,
)

if SQLITE:
    @event.listens_for(engine, "connect")
    def _ativar_chaves_estrangeiras(conexao, _):
        conexao.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


_tabelas_prontas = False


def criar_tabelas():
    global _tabelas_prontas
    from . import models  # noqa: F401  (registra os modelos)

    Base.metadata.create_all(engine)
    _tabelas_prontas = True


def get_db():
    # Em serverless o "startup" do app nem sempre roda: garante as tabelas na primeira requisição.
    if not _tabelas_prontas:
        criar_tabelas()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
