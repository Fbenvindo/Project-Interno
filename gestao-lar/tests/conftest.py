import os
import sys
import tempfile
from pathlib import Path

# Banco e uploads isolados para os testes; precisa ocorrer antes de importar o app.
os.environ["LAR_DATA_DIR"] = tempfile.mkdtemp(prefix="lar_teste_")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as c:
        yield c


def cena(semente: int = 1) -> np.ndarray:
    """Imagem sintética de um cômodo arrumado."""
    rng = np.random.default_rng(semente)
    img = np.zeros((600, 800, 3), np.uint8)
    for y in range(600):
        img[y, :] = (180 - y // 6, 170 - y // 8, 150)
    cv2.rectangle(img, (0, 420), (800, 600), (90, 110, 140), -1)
    cv2.rectangle(img, (80, 250), (330, 440), (60, 40, 120), -1)
    cv2.rectangle(img, (500, 150), (700, 440), (40, 80, 60), -1)
    for i in range(5):
        cv2.line(img, (500, 200 + i * 50), (700, 200 + i * 50), (20, 30, 20), 3)
    cv2.circle(img, (400, 100), 40, (200, 220, 240), -1)
    cv2.rectangle(img, (360, 330), (470, 420), (30, 60, 90), -1)
    return np.clip(img + rng.normal(0, 6, img.shape), 0, 255).astype(np.uint8)


def bagunca(img: np.ndarray, semente: int = 2, objetos: int = 60) -> np.ndarray:
    rng = np.random.default_rng(semente)
    img = img.copy()
    for _ in range(objetos):
        x, y = int(rng.integers(0, 780)), int(rng.integers(300, 590))
        cor = tuple(int(v) for v in rng.integers(0, 255, 3))
        cv2.rectangle(img, (x, y), (x + int(rng.integers(8, 40)), y + int(rng.integers(5, 25))), cor, -1)
    return img


def jpg(img: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()
