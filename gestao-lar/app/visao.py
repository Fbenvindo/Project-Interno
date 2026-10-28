"""Análise das fotos de execução com OpenCV.

A ideia é comparar a foto tirada ao final da tarefa com uma foto de referência
("como o ambiente deve ficar") cadastrada na atividade. Sem referência, o sistema
avalia apenas a qualidade da foto e deixa a conferência para uma pessoa.

Métricas usadas:
- Qualidade: nitidez (variância do Laplaciano), brilho e contraste.
- Similaridade estrutural (SSIM) entre foto e referência.
- Similaridade de cores (correlação de histogramas HSV).
- Enquadramento (pontos ORB em comum), para saber se é o mesmo local/ângulo.
- Índice de desordem: densidade de bordas (Canny) da foto comparada à referência.
  Objetos fora do lugar, sujeira e bagunça tendem a aumentar o número de bordas.

Os limiares abaixo são um ponto de partida e devem ser calibrados com fotos reais
da casa.
"""

import cv2
import numpy as np

TAMANHO = (480, 360)
NITIDEZ_MINIMA = 50.0
BRILHO_MINIMO = 40.0
BRILHO_MAXIMO = 225.0
CONTRASTE_MINIMO = 15.0
NOTA_APROVADA = 70.0
NOTA_REVISAR = 45.0
ENQUADRAMENTO_MINIMO = 0.15

PESOS = {"estrutura": 0.45, "cores": 0.20, "enquadramento": 0.35}


class ImagemInvalida(ValueError):
    pass


def carregar(dados: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(dados, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ImagemInvalida("Não foi possível ler a imagem enviada.")
    return img


def _redimensionar(img: np.ndarray) -> np.ndarray:
    return cv2.resize(img, TAMANHO, interpolation=cv2.INTER_AREA)


def _cinza_normalizado(img: np.ndarray) -> np.ndarray:
    cinza = cv2.cvtColor(_redimensionar(img), cv2.COLOR_BGR2GRAY)
    # CLAHE reduz a influência de diferenças de iluminação entre as fotos.
    return cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(cinza)


def qualidade(img: np.ndarray) -> dict:
    cinza = cv2.cvtColor(_redimensionar(img), cv2.COLOR_BGR2GRAY)
    nitidez = float(cv2.Laplacian(cinza, cv2.CV_64F).var())
    brilho = float(cinza.mean())
    contraste = float(cinza.std())

    problemas = []
    if nitidez < NITIDEZ_MINIMA:
        problemas.append("Foto desfocada ou tremida.")
    if brilho < BRILHO_MINIMO:
        problemas.append("Foto muito escura.")
    elif brilho > BRILHO_MAXIMO:
        problemas.append("Foto muito clara/estourada.")
    if contraste < CONTRASTE_MINIMO:
        problemas.append("Pouco contraste: a cena não está visível.")

    return {
        "nitidez": round(nitidez, 1),
        "brilho": round(brilho, 1),
        "contraste": round(contraste, 1),
        "adequada": not problemas,
        "problemas": problemas,
    }


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """SSIM médio entre duas imagens em tons de cinza do mesmo tamanho."""
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    a, b = a.astype(np.float64), b.astype(np.float64)
    blur = lambda x: cv2.GaussianBlur(x, (11, 11), 1.5)  # noqa: E731
    mu_a, mu_b = blur(a), blur(b)
    var_a = blur(a * a) - mu_a ** 2
    var_b = blur(b * b) - mu_b ** 2
    cov = blur(a * b) - mu_a * mu_b
    mapa = ((2 * mu_a * mu_b + c1) * (2 * cov + c2)) / ((mu_a ** 2 + mu_b ** 2 + c1) * (var_a + var_b + c2))
    return float(np.clip(mapa.mean(), 0.0, 1.0))


def similaridade_cores(a: np.ndarray, b: np.ndarray) -> float:
    hists = []
    for img in (a, b):
        hsv = cv2.cvtColor(_redimensionar(img), cv2.COLOR_BGR2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [50, 60], [0, 180, 0, 256])
        cv2.normalize(h, h, 0, 1, cv2.NORM_MINMAX)
        hists.append(h)
    return float(np.clip(cv2.compareHist(hists[0], hists[1], cv2.HISTCMP_CORREL), 0.0, 1.0))


def enquadramento(a: np.ndarray, b: np.ndarray) -> float:
    """Proporção de pontos ORB que coincidem geometricamente entre as imagens."""
    orb = cv2.ORB_create(nfeatures=1000)
    kp_a, des_a = orb.detectAndCompute(a, None)
    kp_b, des_b = orb.detectAndCompute(b, None)
    if des_a is None or des_b is None or len(kp_a) < 10 or len(kp_b) < 10:
        return 0.0

    pares = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(des_a, des_b, k=2)
    bons = [p[0] for p in pares if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
    if len(bons) < 8:
        return 0.0

    origem = np.float32([kp_a[m.queryIdx].pt for m in bons]).reshape(-1, 1, 2)
    destino = np.float32([kp_b[m.trainIdx].pt for m in bons]).reshape(-1, 1, 2)
    _, mascara = cv2.findHomography(origem, destino, cv2.RANSAC, 5.0)
    inliers = int(mascara.sum()) if mascara is not None else 0
    return float(min(1.0, inliers / (0.25 * min(len(kp_a), len(kp_b)))))


def densidade_bordas(cinza: np.ndarray) -> float:
    suave = cv2.GaussianBlur(cinza, (5, 5), 0)
    return float((cv2.Canny(suave, 60, 160) > 0).mean())


def analisar(foto: bytes, referencia: bytes | None = None) -> dict:
    img = carregar(foto)
    q = qualidade(img)
    cinza = _cinza_normalizado(img)
    resultado = {
        "qualidade": q,
        "densidade_bordas": round(densidade_bordas(cinza), 4),
        "metricas": None,
        "nota": None,
    }

    if not q["adequada"]:
        resultado["avaliacao"] = "foto_inadequada"
        resultado["mensagem"] = "Tire a foto novamente: " + " ".join(q["problemas"])
        return resultado

    if referencia is None:
        resultado["avaliacao"] = "sem_referencia"
        resultado["mensagem"] = (
            "Atividade sem foto de referência. Confira manualmente e, se estiver correta, "
            "use esta foto como referência para as próximas execuções."
        )
        return resultado

    ref = carregar(referencia)
    cinza_ref = _cinza_normalizado(ref)

    estrutura = ssim(cv2.GaussianBlur(cinza, (5, 5), 0), cv2.GaussianBlur(cinza_ref, (5, 5), 0))
    cores = similaridade_cores(img, ref)
    angulo = enquadramento(cinza, cinza_ref)
    bordas_ref = max(densidade_bordas(cinza_ref), 1e-4)
    razao_bordas = resultado["densidade_bordas"] / bordas_ref
    # Até 15% a mais de bordas é tolerado; com o dobro, a penalidade é máxima.
    desordem = float(np.clip((razao_bordas - 1.15) / 0.85, 0.0, 1.0))

    base = PESOS["estrutura"] * estrutura + PESOS["cores"] * cores + PESOS["enquadramento"] * angulo
    nota = round(100 * base * (1 - 0.5 * desordem), 1)

    resultado["metricas"] = {
        "estrutura": round(estrutura, 3),
        "cores": round(cores, 3),
        "enquadramento": round(angulo, 3),
        "razao_bordas": round(razao_bordas, 3),
        "desordem": round(desordem, 3),
    }
    resultado["nota"] = nota

    if angulo < ENQUADRAMENTO_MINIMO:
        resultado["avaliacao"] = "revisar"
        resultado["mensagem"] = (
            "A foto parece ser de outro ângulo ou local. Fotografe na mesma posição da referência."
        )
    elif nota >= NOTA_APROVADA:
        resultado["avaliacao"] = "aprovada"
        resultado["mensagem"] = "Execução compatível com a referência."
    elif nota >= NOTA_REVISAR:
        resultado["avaliacao"] = "revisar"
        resultado["mensagem"] = "Há diferenças em relação à referência. Recomenda-se conferir."
    else:
        resultado["avaliacao"] = "reprovada"
        resultado["mensagem"] = "A execução difere bastante da referência."

    if desordem > 0.3:
        resultado["mensagem"] += " Foram detectados mais objetos/detalhes do que na referência (possível desordem)."
    return resultado
