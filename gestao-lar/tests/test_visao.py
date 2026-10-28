import cv2
import numpy as np
import pytest

from app.visao import ImagemInvalida, analisar
from conftest import bagunca, cena, jpg

REFERENCIA = jpg(cena())


def test_mesma_cena_com_outra_iluminacao_e_aprovada():
    foto = cv2.convertScaleAbs(cena(5), alpha=1.05, beta=10)
    r = analisar(jpg(foto), REFERENCIA)
    assert r["avaliacao"] == "aprovada", r


def test_pequeno_deslocamento_da_camera_e_aprovado():
    foto = cv2.warpAffine(cena(6), np.float32([[1, 0, 12], [0, 1, 8]]), (800, 600), borderMode=cv2.BORDER_REFLECT)
    assert analisar(jpg(foto), REFERENCIA)["avaliacao"] == "aprovada"


def test_ambiente_bagunçado_nao_e_aprovado():
    arrumado = analisar(jpg(cena(5)), REFERENCIA)
    r = analisar(jpg(bagunca(cena(7))), REFERENCIA)
    assert r["avaliacao"] in ("revisar", "reprovada")
    assert r["metricas"]["desordem"] > 0.2
    assert r["nota"] < arrumado["nota"] - 15


@pytest.mark.parametrize("foto", [
    (cena() * 0.1).astype(np.uint8),
    cv2.GaussianBlur(cena(), (31, 31), 0),
])
def test_foto_escura_ou_borrada_pede_nova_foto(foto):
    r = analisar(jpg(foto), REFERENCIA)
    assert r["avaliacao"] == "foto_inadequada" and r["qualidade"]["problemas"]


def test_sem_referencia():
    r = analisar(REFERENCIA)
    assert r["avaliacao"] == "sem_referencia" and r["nota"] is None


def test_arquivo_invalido():
    with pytest.raises(ImagemInvalida):
        analisar(b"nao sou uma imagem")
