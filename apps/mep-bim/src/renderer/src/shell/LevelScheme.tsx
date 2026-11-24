// Esquema dos níveis do pavimento (corte simplificado): piso, forro, face inferior da laje e
// piso de cima, com a altura das redes marcada. Alturas em metros acima do piso.
import type { StoreyScheme } from "../../../core/plan/levels";

export interface SchemeMark {
  /** Y da cena. */
  y: number;
  label: string;
  color?: string;
}

/** Afasta rótulos que ficariam um sobre o outro (posições em px, de cima para baixo). */
function spread(ys: number[], gap = 11): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const out = [...ys];
  for (const o of order) out[o.i] = o.y;
  return out;
}

const fmt = (v: number) =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2).replace(".", ",")}`;

export function LevelScheme({
  scheme,
  marks,
  storey,
}: {
  scheme: StoreyScheme;
  marks: SchemeMark[];
  storey: string;
}) {
  const W = 260;
  const H = 170;
  const top = scheme.next + 0.15;
  const bottom = scheme.floor - 0.25;
  const Y = (y: number) => 10 + ((top - y) / (top - bottom)) * (H - 20);
  const rel = (y: number) => fmt(y - scheme.floor);
  const x0 = 104;
  const x1 = W - 8;
  return (
    <div className="level-scheme">
      <div className="field-label">Níveis do pavimento · {storey}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Esquema dos níveis do pavimento"
      >
        <defs>
          <pattern
            id="ls-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="#9aa4b2"
              strokeWidth="1.2"
            />
          </pattern>
        </defs>
        {/* Laje do piso e laje de cima (hachuradas). */}
        <rect
          x={x0}
          y={Y(scheme.floor)}
          width={x1 - x0}
          height={Math.max(4, Y(scheme.floor - 0.2) - Y(scheme.floor))}
          fill="url(#ls-hatch)"
          stroke="#6b7280"
          strokeWidth="0.8"
        />
        <rect
          x={x0}
          y={Y(scheme.next)}
          width={x1 - x0}
          height={Math.max(4, Y(scheme.slab) - Y(scheme.next))}
          fill="url(#ls-hatch)"
          stroke="#6b7280"
          strokeWidth="0.8"
        />
        {scheme.ceiling != null && (
          <line
            x1={x0}
            x2={x1}
            y1={Y(scheme.ceiling)}
            y2={Y(scheme.ceiling)}
            stroke="#6b7280"
            strokeDasharray="5 3"
            strokeWidth="1"
          />
        )}
        {/* Cotas à esquerda (afastadas quando os níveis são muito próximos). */}
        {(() => {
          const ls = [
            { y: scheme.next, t: `${rel(scheme.next)} piso de cima` },
            { y: scheme.slab, t: `${rel(scheme.slab)} laje` },
            ...(scheme.ceiling != null ? [{ y: scheme.ceiling, t: `${rel(scheme.ceiling)} forro` }] : []),
            { y: scheme.floor, t: `${rel(scheme.floor)} piso` },
          ];
          const ys = spread(ls.map((l) => Y(l.y) + 3));
          return ls.map((l, i) => (
            <text key={i} x={x0 - 4} y={ys[i]} fontSize="8.5" textAnchor="end" fill="#4b5563">
              {l.t}
            </text>
          ));
        })()}
        {/* Redes: linha na altura e rótulo logo abaixo (afastados entre si). */}
        {(() => {
          const ys = spread(marks.map((m, i) => Y(m.y) + (i % 2 ? 10 : -3)));
          return marks.map((m, i) => (
            <g key={i}>
              <line x1={x0 + 6} x2={x1 - 6} y1={Y(m.y)} y2={Y(m.y)} stroke={m.color ?? "#ea580c"} strokeWidth="2.2" />
              <text x={x1 - 8} y={ys[i]} fontSize="8.5" textAnchor="end" fill={m.color ?? "#ea580c"} fontWeight="600">
                {m.label} {rel(m.y)}
              </text>
            </g>
          ));
        })()}
      </svg>
    </div>
  );
}
