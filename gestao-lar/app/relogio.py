"""Data e hora no fuso da casa.

Servidores na nuvem (como a Vercel) rodam em UTC e não permitem mudar a variável TZ,
então o app calcula "hoje" e "agora" pelo fuso configurado em LAR_FUSO.
Os horários são gravados no banco sem fuso, já convertidos para o horário local.
"""

import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

FUSO = ZoneInfo(os.environ.get("LAR_FUSO", "America/Sao_Paulo"))


def agora() -> datetime:
    return datetime.now(FUSO).replace(tzinfo=None)


def hoje() -> date:
    return agora().date()
