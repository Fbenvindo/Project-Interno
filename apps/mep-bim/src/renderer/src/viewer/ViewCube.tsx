// Cubo de orientação do 3D (canto superior direito), no estilo do Revit:
// - cada face é dividida em 3 × 3: o centro leva à vista da face, as bordas à vista da aresta
//   (entre duas faces) e os cantos à vista do vértice (isométrica daquele canto);
// - com a vista alinhada a uma face, quatro setas em volta do cubo levam à face vizinha de cima,
//   de baixo, da esquerda e da direita da tela.
// Ao lado: zoom janela (dois cliques) e enquadrar tudo.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec3 } from "../../../core/types";
import { Icon } from "../shell/icons";
import type { Viewer } from "./Viewer";

/** Faces: direção de onde a câmera olha (cena: Y para cima; −Z é o norte do projeto). */
const FACES: { key: string; label: string; dir: Vec3; rot: ["X" | "Y", number] }[] = [
  { key: "topo", label: "TOPO", dir: [0, 1, 0], rot: ["X", 90] },
  { key: "base", label: "BASE", dir: [0, -1, 0], rot: ["X", -90] },
  { key: "frente", label: "FRENTE", dir: [0, 0, 1], rot: ["Y", 0] },
  { key: "fundos", label: "FUNDOS", dir: [0, 0, -1], rot: ["Y", 180] },
  { key: "direita", label: "DIREITA", dir: [1, 0, 0], rot: ["Y", 90] },
  { key: "esquerda", label: "ESQUERDA", dir: [-1, 0, 0], rot: ["Y", -90] },
];
const SIZE = 64;
/** Fração do lado ocupada por cada faixa de borda/canto. */
const EDGE = 0.2;

type M3 = [Vec3, Vec3, Vec3];
/** Rotação do CSS (Y para baixo) como matriz 3×3 (colunas: imagens de x, y e z). */
function cssRotation(axis: "X" | "Y", deg: number): M3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return axis === "X"
    ? [[1, 0, 0], [0, c, s], [0, -s, c]]
    : [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
/** Vetor do CSS → cena (inverte o Y). */
const toScene = (v: Vec3): Vec3 => [v[0], -v[1], v[2]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Eixo principal mais próximo (±X, ±Y, ±Z). */
function snapAxis(v: Vec3): Vec3 {
  const i = [0, 1, 2].reduce((b, k) => (Math.abs(v[k]) > Math.abs(v[b]) ? k : b), 0);
  const out: Vec3 = [0, 0, 0];
  out[i] = Math.sign(v[i]) || 1;
  return out;
}
const sameDir = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.999;

const NAMES: Record<string, string> = { "0,1,0": "topo", "0,-1,0": "base", "0,0,1": "frente", "0,0,-1": "fundos", "1,0,0": "direita", "-1,0,0": "esquerda" };
const nameOf = (v: Vec3) => NAMES[v.map((x) => Math.round(x)).join(",")] ?? "";

interface Cell {
  key: string;
  dir: Vec3;
  kind: "face" | "aresta" | "vertice";
  style: React.CSSProperties;
  title: string;
}

/** As 9 regiões de cada face com a direção da vista correspondente. */
function faceCells(f: (typeof FACES)[number]): Cell[] {
  const R = cssRotation(...f.rot);
  const right = toScene(R[0]);
  const down = toScene(R[1]);
  const cells: Cell[] = [];
  const span = (k: number) => (k === 0 ? [EDGE, 1 - EDGE] : k < 0 ? [0, EDGE] : [1 - EDGE, 1]);
  for (const j of [-1, 0, 1])
    for (const i of [-1, 0, 1]) {
      const dir = norm(add(add(f.dir, right, i), down, j));
      const kind = i === 0 && j === 0 ? "face" : i !== 0 && j !== 0 ? "vertice" : "aresta";
      const [x0, x1] = span(i);
      const [y0, y1] = span(j);
      cells.push({
        key: `${f.key}:${i},${j}`,
        dir,
        kind,
        style: { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` },
        title: kind === "face" ? `Vista ${f.label.toLowerCase()}` : kind === "aresta" ? "Vista pela aresta" : "Vista pelo vértice (isométrica)",
      });
    }
  return cells;
}

export function ViewCube({ viewer }: { viewer: Viewer }) {
  const cube = useRef<HTMLDivElement>(null);
  const [zooming, setZooming] = useState(false);
  /** Vista alinhada a uma face: as direções vizinhas na tela (cima, baixo, esquerda, direita). */
  const [aligned, setAligned] = useState<{ face: string; up: Vec3; down: Vec3; left: Vec3; right: Vec3 } | null>(null);
  const cells = useMemo(() => FACES.map((f) => ({ face: f, cells: faceCells(f) })), []);
  useEffect(
    () =>
      viewer.onCameraChange(() => {
        const e = viewer.getCameraInverse();
        // Só a rotação da câmera, convertida para o CSS (Y para baixo): S·R·S com S = diag(1, −1, 1),
        // ou seja, troca o sinal dos termos que ligam o eixo Y aos outros.
        const m = [e[0], -e[1], e[2], 0, -e[4], e[5], -e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
        if (cube.current) cube.current.style.transform = `translateZ(-${SIZE}px) matrix3d(${m.join(",")})`;
        // Eixos da câmera na cena: direita, cima e para trás (de onde ela olha).
        const right: Vec3 = [e[0], e[4], e[8]];
        const up: Vec3 = [e[1], e[5], e[9]];
        const back: Vec3 = [e[2], e[6], e[10]];
        const face = snapAxis(back);
        const next = sameDir(norm(back), face)
          ? { face: nameOf(face), up: snapAxis(up), down: snapAxis([-up[0], -up[1], -up[2]]), left: snapAxis([-right[0], -right[1], -right[2]]), right: snapAxis(right) }
          : null;
        setAligned((cur) => (cur?.face === next?.face && cur?.up.join() === next?.up.join() && cur?.right.join() === next?.right.join() ? cur : next));
      }),
    [viewer],
  );
  const arrow = (k: "up" | "down" | "left" | "right") =>
    aligned && (
      <button className={`view-cube-arrow ${k}`} title={`Girar para a vista ${nameOf(aligned[k])}`} onClick={() => viewer.viewFrom(aligned[k])}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
          <path d="M6 2 L11 9 H1 Z" />
        </svg>
      </button>
    );
  return (
    <div className="view-cube-wrap" onPointerDown={(e) => e.stopPropagation()}>
      <div className="view-cube-tools">
        <button
          className={`icon-btn ${zooming ? "on" : ""}`}
          title="Zoom janela: clique em dois cantos da área a ampliar (Esc cancela)"
          onClick={() => {
            if (zooming) return viewer.cancelZoomWindow();
            setZooming(true);
            viewer.startZoomWindow(() => setZooming(false));
          }}
        >
          <Icon name="zoomJanela" size={18} />
        </button>
        <button className="icon-btn" title="Enquadrar tudo (zoom extensão)" onClick={() => viewer.zoomExtents()}>
          <Icon name="enquadrar" size={18} />
        </button>
      </div>
      <div className={`view-cube-holder ${aligned ? "aligned" : ""}`}>
        {arrow("up")}
        {arrow("left")}
        <div className="view-cube-scene" style={{ width: SIZE, height: SIZE }}>
          <div className="view-cube" ref={cube} style={{ width: SIZE, height: SIZE }}>
            {cells.map(({ face: f, cells: list }) => (
              <div key={f.key} className={`view-cube-face ${f.key}`} style={{ width: SIZE, height: SIZE, transform: `rotate${f.rot[0]}(${f.rot[1]}deg) translateZ(${SIZE / 2}px)` }}>
                <span className="view-cube-label">{f.label}</span>
                {list.map((c) => (
                  <button
                    key={c.key}
                    className={`view-cube-cell ${c.kind}`}
                    style={c.style}
                    title={c.title}
                    data-dir={c.dir.map((v) => v.toFixed(3)).join(",")}
                    onClick={() => viewer.viewFrom(c.dir)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        {arrow("right")}
        {arrow("down")}
      </div>
    </div>
  );
}
