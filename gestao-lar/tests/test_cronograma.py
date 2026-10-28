from datetime import date

from app.cronograma import ocorrencias
from app.models import Atividade


def atv(**kw) -> Atividade:
    kw.setdefault("data_inicio", date(2026, 1, 5))  # segunda-feira
    return Atividade(nome="x", **kw)


def test_diaria():
    datas = ocorrencias(atv(frequencia="diaria"), date(2026, 1, 1), date(2026, 1, 11))
    assert datas[0] == date(2026, 1, 5) and datas[-1] == date(2026, 1, 11) and len(datas) == 7


def test_diaria_somente_dias_uteis():
    datas = ocorrencias(atv(frequencia="diaria", dias_semana="0,1,2,3,4"), date(2026, 1, 5), date(2026, 1, 18))
    assert len(datas) == 10 and all(d.weekday() < 5 for d in datas)


def test_semanal_usa_dias_informados():
    datas = ocorrencias(atv(frequencia="semanal", dias_semana="1,4"), date(2026, 1, 5), date(2026, 1, 18))
    assert datas == [date(2026, 1, 6), date(2026, 1, 9), date(2026, 1, 13), date(2026, 1, 16)]


def test_semanal_sem_dias_usa_dia_do_inicio():
    datas = ocorrencias(atv(frequencia="semanal"), date(2026, 1, 1), date(2026, 1, 31))
    assert datas == [date(2026, 1, 5), date(2026, 1, 12), date(2026, 1, 19), date(2026, 1, 26)]


def test_quinzenal():
    datas = ocorrencias(atv(frequencia="quinzenal", dias_semana="2"), date(2026, 1, 1), date(2026, 2, 28))
    assert datas == [date(2026, 1, 7), date(2026, 1, 21), date(2026, 2, 4), date(2026, 2, 18)]


def test_mensal_ajusta_fim_do_mes():
    datas = ocorrencias(atv(frequencia="mensal", dia_mes=31), date(2026, 1, 1), date(2026, 4, 30))
    assert datas == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_unica_e_data_fim():
    assert ocorrencias(atv(frequencia="unica"), date(2026, 1, 1), date(2026, 1, 31)) == [date(2026, 1, 5)]
    assert ocorrencias(atv(frequencia="unica"), date(2026, 1, 6), date(2026, 1, 31)) == []
    datas = ocorrencias(atv(frequencia="diaria", data_fim=date(2026, 1, 7)), date(2026, 1, 1), date(2026, 1, 31))
    assert datas == [date(2026, 1, 5), date(2026, 1, 6), date(2026, 1, 7)]
