// Biblioteca de elementos importados: de arquivos IFC (o app analisa como cada elemento foi
// usado no modelo) e de famílias do Revit (.sebfam). Elementos que já existem: manter o
// existente, substituir ou manter os dois. Elementos equivalentes (mesma função, marcas
// diferentes): o projeto define a marca de referência e qual usar.
import { useMemo, useRef, useState } from "react";
import { alternativeGroups, alternativeLabel, brandsByGroup, chooseAlternative, findExisting, type ProjectChoices } from "../../../core/alternatives";
import { categoryProfile, defaultMounting, defaultOutAxis, OUT_AXES, revitComponentId, type OutAxis } from "../../../core/families";
import { analyzeIfcElements, ifcComponentId, type IfcElementDef, type IfcUsage } from "../../../core/ifcElements";
import { COMPONENT_BY_ID, COMPONENT_GROUPS, COMPONENTS, MOUNTING_LABEL, type ComponentDef, type Mounting } from "../../../core/library";
import { DISCIPLINE_BY_ID } from "../../../core/disciplines";
import type { PlacedPoint } from "../../../core/points";
import { loadIfc } from "../../../ifc/loadIfc";
import { designComponentId, type ElementDesign } from "../../../core/elementDesign";
import { getIfcApi, openIfc, openTextFile, saveFile } from "../platform";
import {
  deleteDesign,
  exportDesigns,
  importDesigns,
  newDesignUid,
  importFamilyPackage,
  importIfcElements,
  removeFamilyPackage,
  setFamilyOverride,
  setIfcOverride,
  useFamilyLibrary,
  type ImportDecision,
  type LibraryEntry,
} from "./familyLibrary";

interface Props {
  points: PlacedPoint[];
  /** Locar um elemento (abre a ferramenta de locação com o componente). */
  onPlace: (componentId: string) => void;
  /** Escolhas do projeto: marca de referência por grupo e elemento entre equivalentes. */
  choices: ProjectChoices;
  onChoices: (fn: (c: ProjectChoices) => ProjectChoices) => void;
  /** Abre o editor de elementos (novo: sem argumento). */
  onEditDesign: (d?: ElementDesign) => void;
}

const AXIS_HINT: Record<OutAxis, string> = {
  "+X": "+X da família",
  "-X": "−X da família",
  "+Y": "+Y da família",
  "-Y": "−Y da família (frente)",
  "+Z": "+Z da família (face)",
  "-Z": "−Z da família (para baixo)",
};

const m2 = (mm: number) => (mm / 1000).toFixed(2).replace(".", ",");

export function usageText(u: IfcUsage): string {
  const where =
    u.mounting === "parede" ? `centro a ${m2(u.height.median)} m do piso` : u.mounting === "teto" ? `${m2(u.height.median)} m abaixo do teto/forro` : `base a ${m2(u.height.median)} m do piso`;
  const share = u.agreement < 1 ? ` (${Math.round(u.agreement * 100)}% das vezes)` : "";
  return `${u.count}× no modelo (${u.storeys.join(", ")}) · ${MOUNTING_LABEL[u.mounting]}${share} · ${where}`;
}

interface Review {
  fileName: string;
  elements: IfcElementDef[];
  decisions: Record<string, ImportDecision>;
}

export function BibliotecaPanel({ points, onPlace, choices, onChoices, onEditDesign }: Props) {
  const entries = useFamilyLibrary();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- Importação ---------------------------------------------------------------------------
  const importSebfam = async (file: File) => {
    try {
      const e = await importFamilyPackage(file.name, await file.text());
      const types = e.pkg!.familias.reduce((s, f) => s + f.tipos.length, 0);
      setMessage(`${e.pkg!.familias.length} família(s) e ${types} tipo(s) importados de ${file.name}.`);
    } catch (err) {
      setMessage(`Não foi possível importar: ${err instanceof Error ? err.message : err}`);
    }
  };
  const useSample = async () => {
    const res = await fetch(new URL("samples/familias-exemplo.sebfam", document.baseURI));
    await importSebfam(new File([await res.text()], "familias-exemplo.sebfam"));
  };
  const analyzeIfc = async (file: { name: string; data: Uint8Array }) => {
    setBusy(true);
    setMessage(`Analisando ${file.name}…`);
    try {
      const api = await getIfcApi();
      const model = loadIfc(api, file.data);
      let elements: IfcElementDef[];
      try {
        elements = analyzeIfcElements(model);
      } finally {
        model.close();
      }
      if (!elements.length) {
        setMessage(`Nenhum elemento (pontos, equipamentos, mobiliário) encontrado em ${file.name}.`);
        return;
      }
      const imported = COMPONENTS.filter((c) => c.source && c.source.packageId !== entries.find((e) => e.name === file.name && e.kind === "ifc")?.id);
      const decisions: Record<string, ImportDecision> = {};
      for (const el of elements) {
        const ex = findExisting(imported, { name: el.name, brand: el.brand, model: el.model });
        // Sem existente: entra como novo. Com existente: o usuário decide (sem padrão).
        decisions[el.uid] = ex ? { include: true, existingId: ex.id } : { include: true, action: "novo" };
      }
      setReview({ fileName: file.name, elements, decisions });
      setMessage(null);
    } catch (err) {
      setMessage(`Não foi possível ler o IFC: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };
  const pickIfc = async () => {
    const f = await openIfc();
    if (f) await analyzeIfc(f);
  };

  const inUse = (e: LibraryEntry) => {
    const ids = new Set(entriesComponentIds(e));
    return points.filter((p) => ids.has(p.componentId)).length;
  };

  // ---- Marcas de referência e equivalentes ------------------------------------------------------
  const imported = COMPONENTS.filter((c) => c.source);
  const brands = useMemo(() => brandsByGroup(imported), [imported]);
  const alternatives = useMemo(() => [...alternativeGroups(imported).entries()], [imported]);
  const toConfigure = entries.flatMap((e) => (e.kind === "ifc" ? (e.elements ?? []).filter((el) => !el.usage.clear && !e.ifcOverrides?.[el.uid]?.reviewed).map((el) => ({ e, el })) : []));

  return (
    <div className="panel-body locacao biblioteca">
      <h2>Importar elementos em IFC</h2>
      <p className="muted small">
        Traga elementos de arquivos IFC (de qualquer software) ou famílias do Revit pelo plugin SmartEasyBIM. Do IFC, o app agrupa as ocorrências por tipo
        e analisa como cada elemento foi usado no modelo — parede, teto ou piso, altura e lado para o ambiente — para já deixá-lo configurado.
      </p>
      <div className="btn-row wrap tight">
        <button className="btn primary" onClick={() => void pickIfc()} disabled={busy}>
          Importar elementos de IFC…
        </button>
        <button className="btn" onClick={() => input.current?.click()} disabled={busy}>
          Famílias do Revit (.sebfam)…
        </button>
        {!entries.length && (
          <button className="btn" onClick={useSample}>
            Usar exemplo
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".sebfam,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importSebfam(f);
          e.target.value = "";
        }}
      />
      {message && <div className="status small">{message}</div>}

      {review && (
        <ImportReview
          review={review}
          onChange={setReview}
          onCancel={() => setReview(null)}
          onConfirm={async () => {
            const e = await importIfcElements(review.fileName, review.elements, review.decisions);
            const n = e.elements?.length ?? 0;
            const pending = (e.elements ?? []).filter((x) => !x.usage.clear).length;
            setReview(null);
            setMessage(`${n} elemento(s) importado(s) de ${review.fileName}.${pending ? ` ${pending} precisam de configuração (veja abaixo).` : ""}`);
          }}
        />
      )}

      {toConfigure.length > 0 && !review && (
        <section className="card warn-card">
          <h3>A configurar ({toConfigure.length})</h3>
          <p className="muted small">Não ficou claro como estes elementos são usados. Confira a fixação, a altura e o lado para o ambiente.</p>
          {toConfigure.map(({ e, el }) => (
            <IfcElementRow key={`${e.id}|${el.uid}`} entry={e} el={el} open={open === `${e.id}|${el.uid}`} onToggle={(k) => setOpen(open === k ? null : k)} onPlace={onPlace} />
          ))}
        </section>
      )}

      {(alternatives.length > 0 || [...brands.values()].some((b) => b.length > 1)) && (
        <section className="card">
          <h3>Marcas e equivalentes deste projeto</h3>
          {[...brands.entries()]
            .filter(([, list]) => list.length > 1)
            .map(([group, list]) => (
              <label key={group} className="inline-row">
                <span className="grow">Marca de referência — {group}</span>
                <select
                  value={choices.brands[group] ?? ""}
                  onChange={(ev) => onChoices((c) => ({ ...c, brands: { ...c.brands, [group]: ev.target.value } }))}
                >
                  <option value="">(sem preferência)</option>
                  {list.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          {alternatives.map(([key, alts]) => {
            const r = chooseAlternative(alts, choices);
            return (
              <label key={key} className="inline-row">
                <span className="grow">
                  {alts[0].funcao}
                  <span className="muted small"> · {r.by === "marca" ? "pela marca de referência" : r.by === "escolha" ? "escolhido" : "padrão"}</span>
                </span>
                <select value={r.def.id} onChange={(ev) => onChoices((c) => ({ ...c, variants: { ...c.variants, [key]: ev.target.value } }))}>
                  {alts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {alternativeLabel(a, alts)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <p className="muted small">
            Elementos com a mesma função (ex.: a mesma evaporadora da Daikin e da LG) ficam todos na biblioteca, cada um com a sua configuração. A marca de
            referência vale para o projeto inteiro; onde ainda houver mais de uma opção, escolha qual usar. A locação mostra só o escolhido.
          </p>
        </section>
      )}

      <OwnDesigns
        designs={entries.find((e) => e.kind === "proprio")?.designs ?? []}
        points={points}
        onEdit={onEditDesign}
        onPlace={onPlace}
        onMessage={setMessage}
      />

      {entries.filter((e) => e.kind !== "proprio").map((e) => (
        <section key={e.id} className="card lib-package">
          <div className="panel-head">
            <h3>
              {e.name} <span className="tag-revit">{e.kind === "ifc" ? "IFC" : "Revit"}</span>
            </h3>
            <button
              className="btn danger small-btn"
              onClick={() => {
                const n = inUse(e);
                if (n) {
                  setMessage(`${n} ponto(s) locado(s) usam elementos deste arquivo: exclua-os antes de remover.`);
                  return;
                }
                if (window.confirm(`Remover "${e.name}" da biblioteca?`)) void removeFamilyPackage(e.id);
              }}
            >
              Remover
            </button>
          </div>
          <div className="muted small">
            {e.kind === "ifc" ? `${e.elements?.length ?? 0} elemento(s)` : `${e.pkg?.origem ?? ""}${e.pkg?.arquivo ? ` · ${e.pkg.arquivo}` : ""}`} · importado em{" "}
            {new Date(e.importedAt).toLocaleDateString("pt-BR")}
            {e.hidden?.length ? ` · ${e.hidden.length} substituído(s) por elementos mais novos` : ""}
          </div>
          {e.kind === "ifc"
            ? (e.elements ?? []).map((el) => (
                <IfcElementRow key={el.uid} entry={e} el={el} open={open === `${e.id}|${el.uid}`} onToggle={(k) => setOpen(open === k ? null : k)} onPlace={onPlace} />
              ))
            : (e.pkg?.familias ?? []).map((f) => <RevitFamilyRow key={f.uid} entry={e} f={f} open={open === `${e.id}|${f.uid}`} onToggle={(k) => setOpen(open === k ? null : k)} onPlace={onPlace} />)}
        </section>
      ))}

      <details className="small">
        <summary>Como exportar famílias pelo plugin do Revit</summary>
        <ol className="muted">
          <li>Baixe o pacote do plugin (SmartEasyBIM-Revit) e clique duas vezes em <b>Instalar.bat</b>. Funciona no Revit 2022 a 2027.</li>
          <li>Abra o Revit: aparece a aba <b>SmartEasyBIM</b> com o botão <b>Exportar famílias</b>.</li>
          <li>Num projeto, marque as famílias carregadas a exportar; no editor de famílias, a família aberta é exportada.</li>
          <li>Aqui, use <b>Famílias do Revit (.sebfam)</b> e escolha o arquivo gerado.</li>
        </ol>
      </details>
    </div>
  );
}

function entriesComponentIds(e: LibraryEntry): string[] {
  if (e.kind === "ifc") return (e.elements ?? []).map((el) => e.replaces?.[el.uid] ?? ifcComponentId(e.id, el.uid));
  return (e.pkg?.familias ?? []).flatMap((f) => f.tipos.map((t) => revitComponentId(f.uid, t.nome)));
}

// ---- Revisão da importação --------------------------------------------------------------------

function ImportReview({ review, onChange, onCancel, onConfirm }: { review: Review; onChange: (r: Review) => void; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const set = (uid: string, patch: Partial<ImportDecision>) => onChange({ ...review, decisions: { ...review.decisions, [uid]: { ...review.decisions[uid], ...patch } } });
  const undecided = review.elements.filter((el) => review.decisions[el.uid].include && review.decisions[el.uid].existingId && !review.decisions[el.uid].action);
  const all = (include: boolean) => onChange({ ...review, decisions: Object.fromEntries(Object.entries(review.decisions).map(([k, d]) => [k, { ...d, include }])) });
  return (
    <section className="card import-review">
      <div className="panel-head">
        <h3>{review.fileName}</h3>
        <span className="muted small">{review.elements.length} elemento(s) encontrados</span>
      </div>
      <div className="btn-row tight">
        <button className="link" onClick={() => all(true)}>
          marcar todos
        </button>
        <button className="link" onClick={() => all(false)}>
          nenhum
        </button>
      </div>
      <ul className="review-list">
        {review.elements.map((el) => {
          const d = review.decisions[el.uid];
          const ex = d.existingId ? COMPONENT_BY_ID[d.existingId] : undefined;
          return (
            <li key={el.uid} className={d.include ? "" : "off"}>
              <label className="review-head">
                <input type="checkbox" checked={d.include} onChange={(e) => set(el.uid, { include: e.target.checked })} />
                <span className="swatch" style={{ background: DISCIPLINE_BY_ID[el.discipline].color }} />
                <b className="grow">{el.name}</b>
                {!el.usage.clear && <span className="badge warn">a configurar</span>}
              </label>
              <div className="muted small">
                {el.ifcType.replace(/^IFC/, "Ifc")}
                {el.brand ? ` · ${el.brand}` : ""}
                {el.model ? ` ${el.model}` : ""} · {usageText(el.usage)}
              </div>
              {el.usage.notes.map((n) => (
                <div key={n} className="warn-text small">
                  {n}
                </div>
              ))}
              {ex && d.include && (
                <div className="dup-choice">
                  <div className="small">
                    Já existe na biblioteca: <b>{ex.label}</b>
                    {ex.brand ? ` (${ex.brand})` : ""}. O que fazer?
                  </div>
                  <div className="segmented small">
                    {(
                      [
                        ["manter", "Manter o existente"],
                        ["substituir", "Substituir pelo novo"],
                        ["ambos", "Manter os dois"],
                      ] as [ImportDecision["action"], string][]
                    ).map(([a, label]) => (
                      <button key={a} className={d.action === a ? "on" : ""} onClick={() => set(el.uid, { action: a })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {undecided.length > 0 && <div className="warn-text small">Decida o que fazer com {undecided.length} elemento(s) que já existem na biblioteca.</div>}
      <div className="btn-row">
        <button className="btn primary" disabled={undecided.length > 0 || !review.elements.some((el) => review.decisions[el.uid].include)} onClick={() => void onConfirm()}>
          Importar selecionados
        </button>
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      <p className="muted small">
        <b>Substituir</b>: o novo assume o lugar do existente (os pontos já locados passam a usá-lo). <b>Manter os dois</b>: ficam como alternativas da mesma
        função; em cada projeto você escolhe qual usar (ou a marca de referência decide).
      </p>
    </section>
  );
}

// ---- Configuração de um elemento -------------------------------------------------------------------

function FuncaoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const funcoes = [...new Set(COMPONENTS.map((c) => c.funcao).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return (
    <>
      <input list="lib-funcoes" value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id="lib-funcoes">
        {funcoes.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </>
  );
}

function IfcElementRow({ entry, el, open, onToggle, onPlace }: { entry: LibraryEntry; el: IfcElementDef; open: boolean; onToggle: (k: string) => void; onPlace: (id: string) => void }) {
  const ov = entry.ifcOverrides?.[el.uid] ?? {};
  const id = entry.replaces?.[el.uid] ?? ifcComponentId(entry.id, el.uid);
  const def: ComponentDef | undefined = COMPONENT_BY_ID[id];
  const hidden = entry.hidden?.includes(id);
  const set = (patch: Parameters<typeof setIfcOverride>[2]) => void setIfcOverride(entry.id, el.uid, patch);
  const key = `${entry.id}|${el.uid}`;
  const pending = !el.usage.clear && !ov.reviewed;
  return (
    <div className="lib-family">
      <button className="lib-family-head" onClick={() => onToggle(key)}>
        <span className="swatch" style={{ background: DISCIPLINE_BY_ID[el.discipline].color }} />
        <span className="grow">
          <b>{ov.label ?? el.name}</b>
          <span className="muted small">
            {" "}
            · {el.usage.count}× · {MOUNTING_LABEL[ov.mounting ?? el.usage.mounting]}
            {(ov.brand ?? el.brand) ? ` · ${ov.brand ?? el.brand}` : ""}
          </span>
        </span>
        {pending && <span className="badge warn">configurar</span>}
        {hidden && <span className="badge">substituído</span>}
        <span className={`caret ${open ? "open" : ""}`}>▸</span>
      </button>
      {open && (
        <div className="lib-family-body">
          <div className="muted small">Uso no modelo: {usageText(el.usage)}</div>
          {el.usage.notes.map((n) => (
            <div key={n} className="warn-text small">
              {n}
            </div>
          ))}
          <div className="form-grid">
            <label className="span2">
              Nome
              <input value={ov.label ?? el.name} onChange={(e) => set({ label: e.target.value })} />
            </label>
            <label>
              Grupo na biblioteca
              <select value={def?.group ?? ov.group ?? ""} onChange={(e) => set({ group: e.target.value })}>
                {[...new Set([def?.group ?? "", ...COMPONENT_GROUPS])].filter(Boolean).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fixação
              <select value={ov.mounting ?? el.usage.mounting} onChange={(e) => set({ mounting: e.target.value as Mounting })}>
                {(["parede", "teto", "piso"] as Mounting[]).map((m) => (
                  <option key={m} value={m}>
                    {MOUNTING_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label title="Parede: altura do centro acima do piso. Teto: afastamento abaixo do teto/forro. Piso: altura da base.">
              Altura padrão (mm)
              <input type="number" step={10} value={ov.height ?? (el.usage.height.median || 0)} onChange={(e) => set({ height: Number(e.target.value) || 0 })} />
            </label>
            <label className="inline-check" title="Se a peça aparecer virada para a parede, gire 180°">
              <input type="checkbox" checked={!!ov.flip} onChange={(e) => set({ flip: e.target.checked })} /> Girar 180° (lado para o ambiente)
            </label>
            <label className="span2" title="Elementos com a mesma função são alternativas entre si (ex.: a mesma evaporadora de marcas diferentes)">
              Função / equivalência
              <FuncaoInput value={ov.funcao ?? el.name} onChange={(v) => set({ funcao: v })} />
            </label>
            <label>
              Fabricante
              <input value={ov.brand ?? el.brand ?? ""} onChange={(e) => set({ brand: e.target.value })} placeholder="ex.: Daikin" />
            </label>
            <label>
              Modelo
              <input value={ov.model ?? el.model ?? ""} onChange={(e) => set({ model: e.target.value })} />
            </label>
            <label className="span2">
              Classe IFC na exportação
              <input value={ov.ifcType ?? el.ifcType} onChange={(e) => set({ ifcType: e.target.value.toUpperCase().replace(/\s+/g, "") })} />
            </label>
          </div>
          <div className="muted small">
            {def ? `${def.size.join("×")} mm · ${def.params.length} parâmetro(s)` : ""}
            {def?.params.length ? `: ${def.params.map((p) => `${p.name}${p.default !== "" ? ` ${p.default}${p.unit ? " " + p.unit : ""}` : ""}`).join(", ")}` : ""}
          </div>
          <div className="btn-row tight">
            {pending && (
              <button className="btn small-btn" onClick={() => set({ reviewed: true })}>
                Configuração conferida
              </button>
            )}
            {def && !hidden && (
              <button className="btn small-btn primary" onClick={() => onPlace(def.id)}>
                Locar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RevitFamilyRow({ entry: e, f, open: expanded, onToggle, onPlace }: { entry: LibraryEntry; f: NonNullable<LibraryEntry["pkg"]>["familias"][number]; open: boolean; onToggle: (k: string) => void; onPlace: (id: string) => void }) {
  const ov = e.overrides[f.uid] ?? {};
  const profile = categoryProfile(f.categoriaRevit);
  const mounting = ov.mounting ?? defaultMounting(f);
  const out = ov.out ?? defaultOutAxis(f, mounting);
  const key = `${e.id}|${f.uid}`;
  const first = COMPONENT_BY_ID[revitComponentId(f.uid, f.tipos[0]?.nome ?? "")];
  return (
    <div className="lib-family">
      <button className="lib-family-head" onClick={() => onToggle(key)}>
        <span className="swatch" style={{ background: DISCIPLINE_BY_ID[profile.discipline].color }} />
        <span className="grow">
          <b>{f.nome}</b>
          <span className="muted small">
            {" "}
            · {f.categoria ?? "sem categoria"} · {f.tipos.length} tipo(s)
            {first?.brand ? ` · ${first.brand}` : ""}
          </span>
        </span>
        <span className={`caret ${expanded ? "open" : ""}`}>▸</span>
      </button>
      {expanded && (
        <div className="lib-family-body">
          <div className="form-grid">
            <label>
              Grupo na biblioteca
              <select value={ov.group ?? profile.group} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { group: ev.target.value })}>
                {[...new Set([profile.group, ...COMPONENT_GROUPS])].map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fixação
              <select value={mounting} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { mounting: ev.target.value as Mounting, out: undefined })}>
                {(["parede", "teto", "piso"] as Mounting[]).map((m) => (
                  <option key={m} value={m}>
                    {MOUNTING_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label title="Eixo da família que aponta para fora da parede/teto/piso, para o ambiente. Ajuste se a peça aparecer virada.">
              Lado para o ambiente
              <select value={out} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { out: ev.target.value as OutAxis })}>
                {OUT_AXES.map((a) => (
                  <option key={a} value={a}>
                    {AXIS_HINT[a]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fabricante
              <input value={ov.brand ?? first?.brand ?? ""} onChange={(ev) => void setFamilyOverride(e.id, f.uid, { brand: ev.target.value })} />
            </label>
            <label className="span2" title="Elementos com a mesma função são alternativas entre si (ex.: marcas diferentes)">
              Função / equivalência (todos os tipos)
              <FuncaoInput value={ov.funcao ?? ""} onChange={(v) => void setFamilyOverride(e.id, f.uid, { funcao: v || undefined })} />
            </label>
          </div>
          <div className="muted small">
            Revit: hospedagem {f.hospedagem}, {f.conectores.length} conector(es). IFC: {profile.ifcType}.
            {f.avisos.length > 0 && <span className="warn-text"> {f.avisos.length} aviso(s) na exportação.</span>}
          </div>
          <table className="grid-table">
            <tbody>
              {f.tipos.map((t) => (
                <tr key={t.nome}>
                  <td>
                    {t.nome}
                    <div className="muted small">
                      {t.min && t.max ? `${Math.round(t.max[0] - t.min[0])}×${Math.round(t.max[1] - t.min[1])}×${Math.round(t.max[2] - t.min[2])} mm` : "sem geometria"} ·{" "}
                      {t.parametros.length} parâmetros
                    </div>
                  </td>
                  <td className="num">
                    <button className="btn small-btn" onClick={() => onPlace(revitComponentId(f.uid, t.nome))}>
                      Locar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Elementos criados no app: locar, editar, duplicar, excluir, levar para outro computador. */
function OwnDesigns({
  designs,
  points,
  onEdit,
  onPlace,
  onMessage,
}: {
  designs: ElementDesign[];
  points: PlacedPoint[];
  onEdit: (d?: ElementDesign) => void;
  onPlace: (componentId: string) => void;
  onMessage: (m: string) => void;
}) {
  const used = (d: ElementDesign) => points.filter((p) => p.componentId === designComponentId(d.uid)).length;
  return (
    <section className="card lib-package">
      <div className="panel-head">
        <h3>
          Elementos criados no app <span className="tag-revit">próprio</span>
        </h3>
        <button className="btn primary small-btn" onClick={() => onEdit()}>
          Novo elemento
        </button>
      </div>
      {designs.length === 0 ? (
        <p className="muted small">
          Desenhe a geometria (vistas de planta, frente e lateral) e defina a classificação IFC e os parâmetros. O elemento fica nesta biblioteca e é locado
          como os demais.
        </p>
      ) : (
        <ul className="sel-list">
          {designs.map((d) => (
            <li key={d.uid}>
              <span className="grow">
                {d.label}{" "}
                <span className="muted small">
                  · {d.group} · {MOUNTING_LABEL[d.mounting]}
                  {used(d) ? ` · ${used(d)} locado(s)` : ""}
                </span>
              </span>
              <button className="link" onClick={() => onPlace(designComponentId(d.uid))}>
                locar
              </button>
              <button className="link" onClick={() => onEdit(d)}>
                editar
              </button>
              <button className="link" onClick={() => onEdit({ ...structuredClone(d), uid: newDesignUid(), label: `${d.label} (cópia)` })}>
                duplicar
              </button>
              <button
                className="link danger-link"
                title="Apagar o elemento"
                onClick={() => {
                  if (used(d)) return onMessage(`${used(d)} ponto(s) locado(s) usam "${d.label}": exclua-os antes de apagar o elemento.`);
                  if (window.confirm(`Apagar o elemento "${d.label}"?`)) void deleteDesign(d.uid);
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row wrap tight">
        <button
          className="btn small-btn"
          disabled={!designs.length}
          onClick={() => void saveFile({ defaultName: "elementos.sebel", content: exportDesigns(designs), filters: [{ name: "Elementos SmartEasyBIM", extensions: ["sebel"] }] })}
        >
          Exportar (.sebel)
        </button>
        <button
          className="btn small-btn"
          onClick={async () => {
            const f = await openTextFile([{ name: "Elementos SmartEasyBIM", extensions: ["sebel", "json"] }]);
            if (!f) return;
            try {
              onMessage(`${await importDesigns(f.content)} elemento(s) importado(s) de ${f.name}.`);
            } catch (err) {
              onMessage(`Não foi possível importar: ${err instanceof Error ? err.message : err}`);
            }
          }}
        >
          Importar (.sebel)
        </button>
      </div>
    </section>
  );
}
