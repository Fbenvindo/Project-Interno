from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .. import push
from ..auth import exigir_dono, usuario_atual
from ..database import get_db
from ..models import InscricaoPush, Notificacao, Usuario
from ..notificacoes import enviar_resumos, notificar, preferencias
from ..schemas import CancelarPushIn, InscricaoPushIn, NotificacaoOut, PreferenciasNotificacao

router = APIRouter(prefix="/api/notificacoes", tags=["notificações"])


@router.get("", response_model=list[NotificacaoOut])
def listar(nao_lidas: bool = False, limite: int = 50, usuario: Usuario = Depends(usuario_atual),
           db: Session = Depends(get_db)):
    q = select(Notificacao).where(Notificacao.usuario_id == usuario.id)
    if nao_lidas:
        q = q.where(Notificacao.lida.is_(False))
    q = q.order_by(Notificacao.criada_em.desc(), Notificacao.id.desc()).limit(min(max(limite, 1), 200))
    return db.scalars(q).all()


@router.get("/contagem")
def contagem(usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(Notificacao.id)).where(
        Notificacao.usuario_id == usuario.id, Notificacao.lida.is_(False)
    ))
    return {"nao_lidas": total}


@router.post("/{notificacao_id}/lida", status_code=204)
def marcar_lida(notificacao_id: int, usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    n = db.get(Notificacao, notificacao_id)
    if n is None or n.usuario_id != usuario.id:
        raise HTTPException(404, "Notificação não encontrada")
    n.lida = True
    db.commit()


@router.post("/marcar-todas-lidas", status_code=204)
def marcar_todas(usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    db.execute(update(Notificacao).where(Notificacao.usuario_id == usuario.id).values(lida=True))
    db.commit()


@router.get("/preferencias", response_model=PreferenciasNotificacao)
def ver_preferencias(usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    p = preferencias(db, usuario.id)
    db.commit()
    return p


@router.put("/preferencias", response_model=PreferenciasNotificacao)
def salvar_preferencias(dados: PreferenciasNotificacao, usuario: Usuario = Depends(usuario_atual),
                        db: Session = Depends(get_db)):
    p = preferencias(db, usuario.id)
    for campo, valor in dados.model_dump().items():
        setattr(p, campo, valor)
    db.commit()
    return p


@router.get("/push/chave")
def chave_push(_: Usuario = Depends(usuario_atual)):
    return {"chave_publica": push.chave_publica()}


@router.post("/push/inscricao", status_code=201)
def inscrever(dados: InscricaoPushIn, request: Request, usuario: Usuario = Depends(usuario_atual),
              db: Session = Depends(get_db)):
    """Registra este aparelho. Se o endpoint já existia (ex.: outro login no mesmo aparelho), troca o dono."""
    i = db.scalar(select(InscricaoPush).where(InscricaoPush.endpoint == dados.endpoint))
    if i is None:
        i = InscricaoPush(endpoint=dados.endpoint)
        db.add(i)
    i.usuario_id = usuario.id
    i.p256dh = dados.keys.p256dh
    i.auth = dados.keys.auth
    i.aparelho = (request.headers.get("user-agent") or "")[:200]
    db.commit()
    return {"id": i.id}


@router.post("/push/cancelar", status_code=204)
def cancelar_inscricao(dados: CancelarPushIn, usuario: Usuario = Depends(usuario_atual),
                       db: Session = Depends(get_db)):
    db.execute(delete(InscricaoPush).where(
        InscricaoPush.endpoint == dados.endpoint, InscricaoPush.usuario_id == usuario.id
    ))
    db.commit()


@router.post("/teste")
def teste(usuario: Usuario = Depends(usuario_atual), db: Session = Depends(get_db)):
    """Cria uma notificação de teste e envia para os aparelhos do usuário."""
    aparelhos = db.scalar(select(func.count(InscricaoPush.id)).where(InscricaoPush.usuario_id == usuario.id))
    notificar(db, [usuario], "teste", "Notificação de teste",
              "Se você está vendo isto, as notificações estão funcionando.", link="aba:hoje")
    db.commit()
    return {"aparelhos": aparelhos}


@router.post("/resumo", dependencies=[Depends(exigir_dono)])
def enviar_resumo_agora(db: Session = Depends(get_db)):
    """Envia agora o resumo diário (quem já recebeu hoje não recebe de novo)."""
    return {"enviadas": enviar_resumos(db)}
