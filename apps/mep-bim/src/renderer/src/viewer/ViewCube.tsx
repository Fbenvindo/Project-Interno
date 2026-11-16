// Cubo de orientação do 3D (canto superior direito): clicar numa face gira a vista para ela
// (topo, base, frente, fundos, esquerda, direita) e enquadra o modelo. Ao lado, zoom janela
// (dois cliques) e enquadrar tudo.
import { useEffect, useRef, useState } from "react";
import type { Vec3 } from "../../../core/types";
import { Icon } from "../shell/icons";
import type { Viewer } from "./Viewer";

/** Faces: direção de onde a câmera olha (cena: Y para cima; −Z é o norte do projeto). */
const FACES: { key: string; label: string; dir: Vec3; css: string }[] = [
  { key: "topo", label: "TOPO", dir: [0, 1, 0], css: "rotateX(90deg)" },
  { key: "base", label: "BASE", dir: [0, -1, 0], css: "rotateX(-90deg)" },
  { key: "frente", label: "FRENTE", dir: [0, 0, 1], css: "rotateY(0deg)" },
  { key: "fundos", label: "FUNDOS", dir: [0, 0, -1], css: "rotateY(180deg)" },
  { key: "direita", label: "DIREITA", dir: [1, 0, 0], css: "rotateY(90deg)" },
  { key: "esquerda", label: "ESQUERDA", dir: [-1, 0, 0], css: "rotateY(-90deg)" },
];
const SIZE = 64;

export function ViewCube({ viewer }: { viewer: Viewer }) {
  const cube = useRef<HTMLDivElement>(null);
  const [zooming, setZooming] = useState(false);
  useEffect(
    () =>
      viewer.onCameraChange(() => {
        const e = viewer.getCameraInverse();
        // Só a rotação da câmera, convertida para o CSS (Y para baixo): S·R·S com S = diag(1, −1, 1),
        // ou seja, troca o sinal dos termos que ligam o eixo Y aos outros.
        const m = [e[0], -e[1], e[2], 0, -e[4], e[5], -e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
        if (cube.current) cube.current.style.transform = `translateZ(-${SIZE}px) matrix3d(${m.join(",")})`;
      }),
    [viewer],
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
      <div className="view-cube-scene" style={{ width: SIZE, height: SIZE }}>
        <div className="view-cube" ref={cube} style={{ width: SIZE, height: SIZE }}>
          {FACES.map((f) => (
            <button
              key={f.key}
              className={`view-cube-face ${f.key}`}
              style={{ width: SIZE, height: SIZE, transform: `${f.css} translateZ(${SIZE / 2}px)` }}
              title={`Vista ${f.label.toLowerCase()}`}
              onClick={() => viewer.viewFrom(f.dir)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
