"""Armazenamento das fotos no banco, já reduzidas para economizar espaço."""

import uuid

import cv2
import numpy as np
from sqlalchemy.orm import Session

from .database import UPLOAD_DIR
from .models import Arquivo

LADO_MAXIMO = 1600
QUALIDADE_JPEG = 85


def comprimir(dados: bytes) -> bytes:
    """Reduz para no máximo LADO_MAXIMO px e regrava em JPEG (~150-400 KB por foto)."""
    img = cv2.imdecode(np.frombuffer(dados, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return dados
    altura, largura = img.shape[:2]
    escala = LADO_MAXIMO / max(altura, largura)
    if escala < 1:
        img = cv2.resize(img, (round(largura * escala), round(altura * escala)), interpolation=cv2.INTER_AREA)
    ok, jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, QUALIDADE_JPEG])
    return jpg.tobytes() if ok else dados


def salvar_foto(db: Session, dados: bytes, prefixo: str) -> str:
    """Grava a foto e devolve o nome usado na URL /uploads/<nome>."""
    nome = f"{prefixo}_{uuid.uuid4().hex[:10]}.jpg"
    db.add(Arquivo(nome=nome, tipo="image/jpeg", conteudo=comprimir(dados)))
    return nome


def ler_foto(db: Session, nome: str | None) -> bytes | None:
    if not nome:
        return None
    arquivo = db.get(Arquivo, nome)
    if arquivo is not None:
        return arquivo.conteudo
    # Fotos gravadas em disco pela versão 0.3 e anteriores.
    caminho = (UPLOAD_DIR / nome).resolve()
    if caminho.parent == UPLOAD_DIR.resolve() and caminho.is_file():
        return caminho.read_bytes()
    return None
