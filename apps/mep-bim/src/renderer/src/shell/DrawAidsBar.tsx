// Botão ORTO (movimentos livres ou só em X, Y e Z) e menu de encaixe a objetos, na barra de
// status e no editor de elementos. F8 liga/desliga o ortogonal; F3, o encaixe.
import { useEffect, useRef, useState } from "react";
import { SNAP_LABEL, SNAP_MODES, type SnapMode } from "../../../core/osnap";
import { setDrawAids, useDrawAids } from "../desenho/drawAids";

const SNAP_ICON: Record<SnapMode, string> = {
  fim: "□",
  meio: "△",
  centro: "○",
  quadrante: "◇",
  intersecao: "✕",
  perpendicular: "⊥",
  tangente: "⌒",
  proximo: "⧗",
  insercao: "⊞",
};

/** Atalhos F8/F3 (uma vez no app). */
export function useDrawAidsKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F8") {
        e.preventDefault();
        setDrawAids((s) => ({ ...s, ortho: !s.ortho }));
      } else if (e.key === "F3") {
        e.preventDefault();
        setDrawAids((s) => ({ ...s, snapOn: !s.snapOn }));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

export function DrawAidsBar({ up = true }: { up?: boolean }) {
  const a = useDrawAids();
  const [open, setOpen] = useState(false);
  // Posição fixa (a barra de status corta o que transborda), calculada a partir do botão.
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);
  const on = SNAP_MODES.filter((m) => a.snaps[m]);
  return (
    <div className="draw-aids" ref={ref}>
      <button
        className={`aid-btn ${a.ortho ? "on" : ""}`}
        title="Ortogonal (F8): criar e modificar só na horizontal ou vertical (X/Y na planta; no 3D, X, Y ou Z). Desligado: movimentos livres. Shift inverte enquanto pressionado."
        onClick={() => setDrawAids((s) => ({ ...s, ortho: !s.ortho }))}
      >
        {a.ortho ? "ORTO X·Y·Z" : "LIVRE"}
      </button>
      <button className={`aid-btn ${a.snapOn ? "on" : ""}`} title="Encaixe a objetos (F3)" onClick={() => setDrawAids((s) => ({ ...s, snapOn: !s.snapOn }))}>
        ENCAIXE
      </button>
      <button
        className="aid-btn caret"
        title="Escolher os encaixes"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const left = Math.max(8, Math.min(r.left, window.innerWidth - 272));
          setAt(up ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
          setOpen(!open);
        }}
      >
        {on.length ? on.map((m) => SNAP_ICON[m]).join("") : "—"} ▾
      </button>
      {open && (
        <div className="aid-menu" role="menu" style={at}>
          <div className="aid-menu-head">Encaixe a objetos</div>
          {SNAP_MODES.map((m) => (
            <label key={m} className="aid-item">
              <input type="checkbox" checked={a.snaps[m]} onChange={(e) => setDrawAids((s) => ({ ...s, snapOn: true, snaps: { ...s.snaps, [m]: e.target.checked } }))} />
              <span className="aid-ico">{SNAP_ICON[m]}</span>
              {SNAP_LABEL[m]}
            </label>
          ))}
          <div className="aid-menu-foot">
            <button className="link" onClick={() => setDrawAids((s) => ({ ...s, snapOn: true, snaps: Object.fromEntries(SNAP_MODES.map((m) => [m, true])) as Record<SnapMode, boolean> }))}>
              todos
            </button>
            <button className="link" onClick={() => setDrawAids((s) => ({ ...s, snaps: Object.fromEntries(SNAP_MODES.map((m) => [m, false])) as Record<SnapMode, boolean> }))}>
              nenhum
            </button>
          </div>
          <p className="muted small">Perpendicular e tangente partem do ponto anterior do comando. "Ao longo" só vale quando nenhum outro encaixe está perto.</p>
        </div>
      )}
    </div>
  );
}
