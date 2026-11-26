// Barra "SmartEasyWEB" dos painéis que trocam dados: trazer de lá / enviar para lá.
import { useState } from "react";
import { webLink, type WebLink } from "./webData";

interface Props {
  servidor: Parameters<typeof webLink>[0];
  /** O que vem e o que vai (ex.: "torres e pavimentos"). */
  what: string;
  pull?: (l: WebLink) => Promise<string>;
  push?: (l: WebLink) => Promise<string>;
  pullLabel?: string;
  pushLabel?: string;
}

export function WebSyncBar({ servidor, what, pull, push, pullLabel = "Trazer do SmartEasyWEB", pushLabel = "Enviar ao SmartEasyWEB" }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const link = webLink(servidor);
  const run = async (fn: (l: WebLink) => Promise<string>) => {
    if (typeof link === "string") return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn(link) });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card web-sync">
      <div className="panel-head">
        <h3>SmartEasyWEB</h3>
        {typeof link !== "string" && <span className="muted small">{link.empreendimento}</span>}
      </div>
      {typeof link === "string" ? (
        <p className="muted small">{link}</p>
      ) : (
        <>
          <p className="muted small">Troca {what} com o empreendimento no SmartEasyWEB.</p>
          <div className="inline-row">
            {pull && (
              <button className="btn" disabled={busy} onClick={() => run(pull)}>
                {pullLabel}
              </button>
            )}
            {push && (
              <button className="btn" disabled={busy} onClick={() => run(push)}>
                {pushLabel}
              </button>
            )}
          </div>
        </>
      )}
      {busy && <p className="muted small">Falando com o SmartEasyWEB…</p>}
      {msg && <p className={`small ${msg.ok ? "ok-text" : "fail-text"}`}>{msg.text}</p>}
    </section>
  );
}
