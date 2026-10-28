import uuid
from pathlib import Path

from .database import UPLOAD_DIR

EXTENSOES = {".jpg", ".jpeg", ".png", ".webp"}


def salvar_foto(dados: bytes, prefixo: str, nome_original: str | None) -> str:
    """Grava a foto em UPLOAD_DIR e devolve o nome do arquivo."""
    extensao = Path(nome_original or "").suffix.lower()
    if extensao not in EXTENSOES:
        extensao = ".jpg"
    nome = f"{prefixo}_{uuid.uuid4().hex[:10]}{extensao}"
    (UPLOAD_DIR / nome).write_bytes(dados)
    return nome


def ler_foto(nome: str | None) -> bytes | None:
    if not nome:
        return None
    caminho = UPLOAD_DIR / nome
    return caminho.read_bytes() if caminho.exists() else None
