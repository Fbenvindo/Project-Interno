// Coordenadas do projeto: origem do IFC, ponto base do projeto (IfcSite), survey point
// (coordenadas compartilhadas / UTM pela IfcMapConversion), sistema de referência e norte.
import { useState, type ReactNode } from "react";
import {
  fmtCoord,
  formatDms,
  fromMap,
  mapRotationDeg,
  settingsFromGeoref,
  toMap,
  type Georef,
  type GeorefSettings,
} from "../../../core/georef";
import type { Vec3 } from "../../../core/types";

interface Props {
  fromIfc: Georef;
  settings: GeorefSettings | null;
  effective: Georef;
  onChange: (s: GeorefSettings | null) => void;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <tr>
    <th>{label}</th>
    <td>{children}</td>
  </tr>
);
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const numSimple = (s: string) => Number(s.replace(",", "."));

export function CoordenadasPanel({ fromIfc, settings, effective, onChange }: Props) {
  const s = settings ?? settingsFromGeoref(fromIfc);
  const manual = s.source === "manual";
  const set = (patch: Partial<GeorefSettings>) => onChange({ ...s, ...patch });
  const g = fromIfc;
  const m = effective.map;
  const [conv, setConv] = useState<{ x: string; y: string; z: string; e: string; n: string; h: string }>({ x: "0", y: "0", z: "0", e: "", n: "", h: "" });

  const toUtm = () => {
    if (!m) return;
    const r = toMap(m, [numSimple(conv.x), numSimple(conv.y), numSimple(conv.z)]);
    setConv({ ...conv, e: fmtCoord(r[0]), n: fmtCoord(r[1]), h: fmtCoord(r[2]) });
  };
  const toProject = () => {
    if (!m) return;
    const r: Vec3 = fromMap(m, [num(conv.e), num(conv.n), num(conv.h)]);
    setConv({ ...conv, x: r[0].toFixed(3), y: r[1].toFixed(3), z: r[2].toFixed(3) });
  };

  return (
    <div className="panel-body coords">
      <h2>Coordenadas do projeto</h2>
      <p className="muted small">
        Para ficar coordenado com os parceiros, todos os modelos devem usar o mesmo ponto base e o mesmo survey point (no Revit: coordenadas
        compartilhadas; na exportação IFC, “coordenadas compartilhadas” e georreferenciamento IFC4). O app lê esses dados do IFC principal, alinha
        os vínculos por eles e os grava nos arquivos que exporta.
      </p>

      <section className="card">
        <h3>Lido do IFC principal</h3>
        <table className="props">
          <tbody>
            <Row label="Origem interna">X 0 · Y 0 · Z 0 (coordenadas do IFC)</Row>
            <Row label="Ponto base do projeto (IfcSite)">
              {g.site ? (
                <>
                  X {fmtCoord(g.site.location[0])} · Y {fmtCoord(g.site.location[1])} · Z {fmtCoord(g.site.location[2])}
                  {g.site.rotationDeg ? ` · rotação ${fmtCoord(g.site.rotationDeg, 2)}°` : ""}
                </>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Survey point (E · N · cota)">
              {g.map ? (
                <>
                  E {fmtCoord(g.map.eastings)} · N {fmtCoord(g.map.northings)} · {fmtCoord(g.map.orthogonalHeight)} m
                </>
              ) : (
                <span className="warn-text">Sem IfcMapConversion no arquivo</span>
              )}
            </Row>
            <Row label="Rotação para o norte de quadrícula">{g.map ? `${fmtCoord(mapRotationDeg(g.map), 4)}° (eixo X do projeto em relação ao leste)` : "—"}</Row>
            {g.map && g.map.scale !== 1 && <Row label="Escala">{g.map.scale}</Row>}
            <Row label="Sistema de referência">
              {g.crs ? (
                <>
                  {g.crs.name}
                  {g.crs.description ? ` — ${g.crs.description}` : ""}
                  {g.crs.mapZone ? ` (fuso ${g.crs.mapZone})` : ""}
                </>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Norte verdadeiro">{g.trueNorthDeg != null ? `${fmtCoord(g.trueNorthDeg, 2)}° a partir do +Y do projeto` : "—"}</Row>
            <Row label="Latitude · longitude">
              {formatDms(g.site?.latitude ?? null, "lat")} · {formatDms(g.site?.longitude ?? null, "lon")}
            </Row>
            <Row label="Cota de referência do terreno">{g.site?.elevation != null ? `${fmtCoord(g.site.elevation)} m` : "—"}</Row>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>Usado no projeto</h3>
        <div className="segmented">
          <button className={!manual ? "on" : ""} onClick={() => onChange(null)}>
            Do IFC
          </button>
          <button className={manual ? "on" : ""} onClick={() => onChange({ ...s, source: "manual" })}>
            Informado
          </button>
        </div>
        <p className="muted small">
          {manual
            ? "Informe o survey point (coordenadas do mapa da origem do projeto), a rotação e o sistema de referência. Valem para os vínculos, a leitura das coordenadas e os arquivos exportados."
            : g.map
              ? "Usando o georreferenciamento do IFC principal."
              : "O IFC principal não traz georreferenciamento: as coordenadas compartilhadas ficam indisponíveis até você informá-las."}
        </p>
        {manual && (
          <div className="form-grid">
            <label>
              E (m)
              <input type="number" step={0.001} value={s.eastings} onChange={(e) => set({ eastings: Number(e.target.value) })} />
            </label>
            <label>
              N (m)
              <input type="number" step={0.001} value={s.northings} onChange={(e) => set({ northings: Number(e.target.value) })} />
            </label>
            <label>
              Cota (m)
              <input type="number" step={0.001} value={s.height} onChange={(e) => set({ height: Number(e.target.value) })} />
            </label>
            <label title="Ângulo do eixo X do projeto em relação ao leste do mapa (anti-horário)">
              Rotação (°)
              <input type="number" step={0.0001} value={s.rotationDeg} onChange={(e) => set({ rotationDeg: Number(e.target.value) })} />
            </label>
            <label title="Ex.: EPSG:31983 (SIRGAS 2000 / UTM 23S)">
              Sistema (EPSG)
              <input value={s.crsName} onChange={(e) => set({ crsName: e.target.value })} placeholder="EPSG:31983" />
            </label>
            <label title="Ângulo do norte verdadeiro a partir do +Y do projeto (anti-horário)">
              Norte verdadeiro (°)
              <input type="number" step={0.01} value={s.trueNorthDeg} onChange={(e) => set({ trueNorthDeg: Number(e.target.value) })} />
            </label>
            <label>
              Latitude (°)
              <input type="number" step={0.000001} value={s.latitude ?? ""} onChange={(e) => set({ latitude: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
            <label>
              Longitude (°)
              <input type="number" step={0.000001} value={s.longitude ?? ""} onChange={(e) => set({ longitude: e.target.value === "" ? null : Number(e.target.value) })} />
            </label>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Converter coordenadas</h3>
        {!m ? (
          <p className="muted small">Disponível quando houver survey point (do IFC ou informado).</p>
        ) : (
          <>
            <div className="form-grid conv">
              <label>
                X projeto (m)
                <input value={conv.x} onChange={(e) => setConv({ ...conv, x: e.target.value })} />
              </label>
              <label>
                Y projeto (m)
                <input value={conv.y} onChange={(e) => setConv({ ...conv, y: e.target.value })} />
              </label>
              <label>
                Z projeto (m)
                <input value={conv.z} onChange={(e) => setConv({ ...conv, z: e.target.value })} />
              </label>
              <label>
                E (m)
                <input value={conv.e} onChange={(e) => setConv({ ...conv, e: e.target.value })} />
              </label>
              <label>
                N (m)
                <input value={conv.n} onChange={(e) => setConv({ ...conv, n: e.target.value })} />
              </label>
              <label>
                Cota (m)
                <input value={conv.h} onChange={(e) => setConv({ ...conv, h: e.target.value })} />
              </label>
            </div>
            <div className="btn-row">
              <button className="btn" onClick={toUtm}>
                Projeto → mapa
              </button>
              <button className="btn" onClick={toProject}>
                Mapa → projeto
              </button>
            </div>
          </>
        )}
        <p className="muted small">Na planta, a barra de status mostra as coordenadas do cursor nos dois sistemas.</p>
      </section>
    </div>
  );
}
