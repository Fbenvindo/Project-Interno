import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ComponentMesh, Shape } from "../../../core/library";
import type { SurfaceHit } from "../../../core/placement";
import { segmentBasis, type Profile } from "../../../core/runs";
import type { Vec3 } from "../../../core/types";
import type { ElementMesh } from "../../../ifc/loadIfc";

export type ColorMode = "ifc" | "disciplina";

/** Geometria de um objeto criado no app (ou de sua pré-visualização). Medidas em metros. */
export type Visual =
  /** Componente locado: caixa ou cilindro girado em torno do eixo vertical. */
  | { kind?: "solido"; shape: Shape; size: Vec3; position: Vec3; rotation: number; mesh?: ComponentMesh }
  /** Segmento de trecho entre dois pontos do eixo. */
  | { kind: "segmento"; profile: Profile; width: number; height: number; start: Vec3; end: Vec3 }
  /** Nó do trecho (curva, tê ou vértice em desenho). */
  | { kind: "no"; profile: Profile; width: number; height: number; position: Vec3 };

export type PointVisual = Visual & { id: number; color: string };
export type PreviewItem = Visual & { ok: boolean };

export type ExtraLayer = "points" | "runs";

/** Contexto do cursor entregue ao modo de edição. */
export interface PointerContext {
  /** Raio da câmera pelo cursor (cena). */
  ray: { origin: Vec3; direction: Vec3 };
  shift: boolean;
  /** Objeto criado no app (ponto ou trecho) sob o cursor, se estiver na frente do modelo. */
  objectId: number | null;
  objectPoint: Vec3 | null;
}

/** Modo de edição: o visualizador informa a superfície sob o cursor e os cliques. */
/** Cortes da vista 3D, em coordenadas da cena (null = desligado). */
export interface SectionPlanes {
  /** Mantém o que está abaixo desta cota (Y). */
  horizontal: number | null;
  /** Corte vertical perpendicular a X: mantém x ≤ pos (ou ≥ pos se invertido). */
  x: { pos: number; invert: boolean } | null;
  /** Corte vertical perpendicular a Z: mantém z ≤ pos (ou ≥ pos se invertido). */
  z: { pos: number; invert: boolean } | null;
}

export interface PlacementHandler {
  /** Superfície desejada quando o modo é usado na planta 2D (padrão: teto). */
  surface?(): "parede" | "teto" | "piso";
  hover(hit: SurfaceHit | null, ctx: PointerContext): PreviewItem[];
  click(hit: SurfaceHit | null, ctx: PointerContext): void;
  /** Duplo clique (ex.: finalizar um trecho). */
  doubleClick?(): void;
}

interface Entry {
  mesh: THREE.Mesh;
  ifcMaterial: THREE.Material;
  disciplineMaterial: THREE.Material;
  layer: "model" | ExtraLayer;
}

/** Visualizador 3D: um THREE.Mesh por elemento IFC ou ponto locado, com seleção, filtros e locação. */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private modelGroup = new THREE.Group();
  private pointsGroup = new THREE.Group();
  private runsGroup = new THREE.Group();
  private staticPreviewGroup = new THREE.Group();
  private spacesGroup = new THREE.Group();
  private shiftDown = false;
  private clipPlanes: THREE.Plane[] = [];
  private placementListeners = new Set<() => void>();
  private staticPreviewItems: PreviewItem[] = [];
  private spaceOutlineItems: { points: Vec3[]; selected: boolean }[] = [];
  private removeKeyListeners = () => {};
  private previewGroup = new THREE.Group();
  private entries = new Map<number, Entry>();
  private materialCache = new Map<string, THREE.Material>();
  private geometryCache = new Map<string, THREE.BufferGeometry>();
  /** Geometria das famílias importadas (mm → m), por malha. */
  private meshGeometry = new WeakMap<ComponentMesh, { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
  /** Famílias com cores dos materiais (modo de cor "IFC"/original). */
  private vertexColorMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2b2f36, transparent: true, opacity: 0.55 });
  private selectionMaterial = new THREE.MeshLambertMaterial({ color: 0x00e5ff, emissive: 0x004455, side: THREE.DoubleSide });
  private highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xff2d55, emissive: 0x440011, side: THREE.DoubleSide });
  private ghostMaterial = new THREE.MeshLambertMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.08, depthWrite: false });
  private previewOk = new THREE.MeshLambertMaterial({ color: 0x2fbf71, emissive: 0x0c3a20, transparent: true, opacity: 0.75 });
  private previewBad = new THREE.MeshLambertMaterial({ color: 0xef5350, emissive: 0x3a0c0c, transparent: true, opacity: 0.6 });
  private colorMode: ColorMode = "disciplina";
  private selected = new Set<number>();
  private sectionPlanes: THREE.Plane[] = [];
  private extraPlanes: THREE.Plane[] = [];
  private highlighted = new Set<number>();
  private ghosted = false;
  private visible: Set<number> | null = null;
  private raycaster = new THREE.Raycaster();
  private resizeObserver: ResizeObserver;
  private frame = 0;
  private needsRender = true;
  private pointerDown: { x: number; y: number } | null = null;
  private placement: PlacementHandler | null = null;
  private hoverPos: { x: number; y: number } | null = null;
  private hoverDirty = false;

  onPick: (expressID: number | null, additive: boolean) => void = () => {};
  /** Janela de seleção (arrastar com o botão esquerdo fora dos comandos de locação/traçado). */
  onPickMany: (ids: number[], additive: boolean) => void = () => {};
  private boxStart: { x: number; y: number } | null = null;
  private boxEl: HTMLDivElement;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1b1f26);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
    this.camera.position.set(15, 12, 15);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = true;
    this.applyMouseButtons();
    this.controls.addEventListener("change", () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);
    this.scene.add(this.modelGroup, this.pointsGroup, this.runsGroup, this.previewGroup, this.staticPreviewGroup, this.spacesGroup);

    const grid = new THREE.GridHelper(100, 100, 0x3a4250, 0x262c35);
    grid.name = "grid";
    this.scene.add(grid);

    const canvas = this.renderer.domElement;
    // Janela de seleção: esquerda→direita só o que está inteiro dentro; direita→esquerda o que ela toca.
    this.boxEl = document.createElement("div");
    this.boxEl.className = "viewer-box";
    this.boxEl.hidden = true;
    container.appendChild(this.boxEl);
    canvas.addEventListener("pointerdown", (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY };
      this.boxStart = e.button === 0 && !this.placement ? { x: e.clientX, y: e.clientY } : null;
    });
    canvas.addEventListener("pointermove", (e) => {
      const b = this.boxStart;
      if (!b || !(e.buttons & 1) || Math.hypot(e.clientX - b.x, e.clientY - b.y) < 4) return;
      const r = this.container.getBoundingClientRect();
      const crossing = e.clientX < b.x;
      Object.assign(this.boxEl.style, {
        left: `${Math.min(b.x, e.clientX) - r.left}px`,
        top: `${Math.min(b.y, e.clientY) - r.top}px`,
        width: `${Math.abs(e.clientX - b.x)}px`,
        height: `${Math.abs(e.clientY - b.y)}px`,
      });
      this.boxEl.classList.toggle("crossing", crossing);
      this.boxEl.hidden = false;
    });
    canvas.addEventListener("pointerup", (e) => {
      const b = this.boxStart;
      this.boxStart = null;
      if (b && !this.boxEl.hidden) {
        this.boxEl.hidden = true;
        this.pointerDown = null;
        this.onPickMany(this.idsInScreenBox(b.x, b.y, e.clientX, e.clientY, e.clientX < b.x), e.ctrlKey || e.metaKey || e.shiftKey);
        return;
      }
      if (!this.pointerDown) return;
      const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      this.pointerDown = null;
      if (moved >= 4 || e.button !== 0) return;
      if (this.placement) {
        this.shiftDown = e.shiftKey;
        const { hit, ctx } = this.probe(e.clientX, e.clientY);
        this.placement.click(hit, ctx);
        this.refreshPlacement();
      } else {
        this.onPick(this.pick(e.clientX, e.clientY), e.ctrlKey || e.metaKey || e.shiftKey);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.placement) return;
      this.hoverPos = { x: e.clientX, y: e.clientY };
      this.shiftDown = e.shiftKey;
      this.hoverDirty = true;
    });
    canvas.addEventListener("pointerleave", () => {
      if (!this.placement) return;
      this.hoverPos = null;
      this.hoverDirty = true;
    });
    canvas.addEventListener("dblclick", () => {
      if (this.placement) this.placement.doubleClick?.();
      else this.fitTo(this.selected.size ? [...this.selected] : undefined);
    });
    const onShift = (e: KeyboardEvent) => {
      if (e.key === "Shift" && this.placement && this.shiftDown !== e.type.endsWith("down")) {
        this.shiftDown = e.type.endsWith("down");
        this.hoverDirty = true;
      }
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    this.removeKeyListeners = () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  load(meshes: ElementMesh[], disciplineColorOf: (expressID: number) => string) {
    this.clear();
    this.addModelMeshes(meshes, disciplineColorOf);
    this.placeGrid();
    this.fitTo();
  }

  /** Acrescenta malhas de modelo (vínculos IFC) sem limpar a cena; opacity < 1 deixa transparente. */
  addModelMeshes(meshes: ElementMesh[], disciplineColorOf: (expressID: number) => string, opacity = 1) {
    for (const m of meshes) {
      if (!m.positions.length || this.entries.has(m.expressID)) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(m.indices, 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const alpha = Math.min(m.color[3], opacity);
      const ifcMaterial = this.material(m.color[0], m.color[1], m.color[2], alpha);
      const disciplineColor = new THREE.Color(disciplineColorOf(m.expressID));
      const disciplineMaterial = this.material(disciplineColor.r, disciplineColor.g, disciplineColor.b, m.color[3] < 1 ? Math.min(0.4, opacity) : opacity);
      const mesh = new THREE.Mesh(geometry, this.colorMode === "ifc" ? ifcMaterial : disciplineMaterial);
      mesh.userData.expressID = m.expressID;
      this.modelGroup.add(mesh);
      this.entries.set(m.expressID, { mesh, ifcMaterial, disciplineMaterial, layer: "model" });
    }
    this.setVisible(this.visible);
  }

  /** Remove malhas de modelo (vínculo desligado ou removido). */
  removeModelMeshes(ids: Iterable<number>) {
    for (const id of ids) {
      const e = this.entries.get(id);
      if (!e || e.layer !== "model") continue;
      this.modelGroup.remove(e.mesh);
      e.mesh.geometry.dispose();
      this.entries.delete(id);
      this.selected.delete(id);
      this.highlighted.delete(id);
    }
    this.requestRender();
  }

  clear() {
    for (const { mesh, layer } of this.entries.values()) if (layer === "model") mesh.geometry.dispose();
    this.modelGroup.clear();
    this.pointsGroup.clear();
    this.runsGroup.clear();
    this.entries.clear();
    this.selected.clear();
    this.highlighted.clear();
    this.visible = null;
    this.requestRender();
  }

  /** Substitui os objetos criados no app de uma camada (pontos locados ou trechos). */
  setExtras(layer: ExtraLayer, items: PointVisual[]) {
    for (const [id, e] of this.entries) if (e.layer === layer) this.entries.delete(id);
    const group = layer === "points" ? this.pointsGroup : this.runsGroup;
    group.clear();
    for (const p of items) {
      const c = new THREE.Color(p.color);
      const mat = this.material(c.r, c.g, c.b, 1);
      const mesh = this.buildMesh(p, mat);
      mesh.userData.expressID = p.id;
      group.add(mesh);
      // Famílias com materiais: no modo de cor original, as cores do Revit/IFC.
      const original = "mesh" in p && p.mesh?.triColors ? this.vertexColorMaterial : mat;
      if (original !== mat && this.colorMode === "ifc") mesh.material = original;
      this.entries.set(p.id, { mesh, ifcMaterial: original, disciplineMaterial: mat, layer });
    }
    this.setVisible(this.visible);
  }

  setPoints(points: PointVisual[]) {
    this.setExtras("points", points);
  }

  /** Ativa (ou desativa, com null) o modo de locação. */
  setPlacementHandler(handler: PlacementHandler | null) {
    this.placement = handler;
    this.applyMouseButtons();
    this.renderer.domElement.style.cursor = handler ? "crosshair" : "";
    if (!handler) this.showPreview([]);
    this.hoverDirty = true;
    this.notifyPlacement();
  }

  /** Recalcula a pré-visualização (ex.: após girar ou mudar a altura). */
  refreshPlacement() {
    this.hoverDirty = true;
    this.notifyPlacement();
  }

  /** Modo de edição ativo (usado também pelo editor em planta 2D). */
  getPlacementHandler(): PlacementHandler | null {
    return this.placement;
  }

  getStaticPreview(): PreviewItem[] {
    return this.staticPreviewItems;
  }

  getSpaceOutlines() {
    return this.spaceOutlineItems;
  }

  /** Avisa quando o modo de edição, as pré-visualizações ou os ambientes destacados mudam. */
  onPlacementChange(cb: () => void): () => void {
    this.placementListeners.add(cb);
    return () => this.placementListeners.delete(cb);
  }

  private notifyPlacement() {
    this.placementListeners.forEach((cb) => cb());
  }

  // ---- Cortes -----------------------------------------------------------------------
  setSection(section: SectionPlanes) {
    const planes: THREE.Plane[] = [];
    if (section.horizontal != null) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), section.horizontal));
    if (section.x) planes.push(section.x.invert ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -section.x.pos) : new THREE.Plane(new THREE.Vector3(-1, 0, 0), section.x.pos));
    if (section.z) planes.push(section.z.invert ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -section.z.pos) : new THREE.Plane(new THREE.Vector3(0, 0, -1), section.z.pos));
    this.sectionPlanes = planes;
    this.applyClip();
  }

  /**
   * Cortes extras (corte por seleção ou por linha): mantém o lado para onde aponta a normal
   * de cada plano. null remove.
   */
  setExtraClip(planes: { normal: Vec3; point: Vec3 }[] | null) {
    this.extraPlanes = (planes ?? []).map((p) => {
      const n = new THREE.Vector3(...p.normal).normalize();
      return new THREE.Plane(n, -n.dot(new THREE.Vector3(...p.point)));
    });
    this.applyClip();
  }

  hasExtraClip() {
    return this.extraPlanes.length > 0;
  }

  private applyClip() {
    this.clipPlanes = [...this.sectionPlanes, ...this.extraPlanes];
    this.renderer.clippingPlanes = this.clipPlanes;
    this.requestRender();
    this.hoverDirty = true;
  }

  /** Limites do modelo IFC na cena (para os controles de corte). */
  getModelBounds(): { min: Vec3; max: Vec3 } | null {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return null;
    return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  }

  private clipped(p: THREE.Vector3): boolean {
    return this.clipPlanes.some((pl) => pl.distanceToPoint(p) < -1e-6);
  }

  /**
   * Cota do piso abaixo de um ponto: primeira face voltada para cima atingida
   * por um raio vertical (até 8 m). null se não houver piso modelado.
   */
  floorBelow([x, y, z]: Vec3, awayFrom?: Vec3, accept: (expressID: number) => boolean = () => true): number | null {
    const origin = new THREE.Vector3(x, y, z);
    if (awayFrom) origin.add(new THREE.Vector3(...awayFrom).multiplyScalar(0.05));
    this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 8;
    const hits = this.raycaster.intersectObjects(this.pickTargets(), false).filter((h) => accept(h.object.userData.expressID));
    this.raycaster.far = Infinity;
    for (const h of hits) {
      const n = this.worldNormal(h);
      if (n && Math.abs(n.y) > 0.7) return h.point.y;
    }
    return null;
  }

  /**
   * Primeira superfície do modelo (visível) atingida por um raio, com a normal
   * voltada para a origem. `accept` filtra pela normal (ex.: só faces de teto).
   */
  castRay(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    accept: (normal: Vec3, expressID: number) => boolean = () => true,
    includeHidden = false,
  ): SurfaceHit | null {
    this.raycaster.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize());
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(includeHidden ? this.modelGroup.children : this.pickTargets(), false);
    this.raycaster.far = Infinity;
    for (const h of hits) {
      const n = this.worldNormal(h);
      if (!n) continue;
      const normal: Vec3 = [n.x, n.y, n.z];
      if (accept(normal, h.object.userData.expressID as number)) return { point: [h.point.x, h.point.y, h.point.z], normal };
    }
    return null;
  }

  /**
   * Destaca ambientes: contorno e preenchimento translúcido sobre o piso.
   * Cada ambiente é uma lista de vértices na cena (já na cota desejada).
   */
  setSpaceOutlines(loops: { points: Vec3[]; selected: boolean }[]) {
    this.spaceOutlineItems = loops;
    this.notifyPlacement();
    this.spacesGroup.clear();
    for (const { points, selected } of loops) {
      if (points.length < 3) continue;
      const color = selected ? 0x00e5ff : 0x7f8c9d;
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: selected ? 1 : 0.6 }),
      );
      line.renderOrder = 3;
      this.spacesGroup.add(line);
      if (selected) {
        const tris = THREE.ShapeUtils.triangulateShape(points.map((p) => new THREE.Vector2(p[0], p[2])), []);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
        geom.setIndex(tris.flat());
        const fill = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
        fill.renderOrder = 3;
        this.spacesGroup.add(fill);
      }
    }
    this.requestRender();
  }

  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
    this.refreshMaterials();
  }

  /** null = todos visíveis. */
  setVisible(ids: Set<number> | null) {
    this.visible = ids;
    for (const [id, e] of this.entries) e.mesh.visible = !ids || ids.has(id) || this.highlighted.has(id);
    this.refreshMaterials();
  }

  setSelection(ids: number[]) {
    this.selected = new Set(ids);
    this.refreshMaterials();
  }

  /** Destaca elementos (ex.: par em interferência). `ghostOthers` deixa o resto translúcido. */
  setHighlight(ids: number[], ghostOthers = false) {
    this.highlighted = new Set(ids);
    this.ghosted = ghostOthers && ids.length > 0;
    this.setVisible(this.visible);
  }

  /**
   * Botões do mouse: em Selecionar, o esquerdo faz a janela de seleção, o do meio desloca e o
   * direito (ou Shift + meio) gira. Locando/traçando, o esquerdo volta a girar a vista.
   */
  private applyMouseButtons() {
    this.controls.mouseButtons = {
      LEFT: (this.placement ? THREE.MOUSE.ROTATE : null) as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
  }

  /** Elementos visíveis na janela da tela (coordenadas do cliente). */
  private idsInScreenBox(x0: number, y0: number, x1: number, y1: number, crossing: boolean): number[] {
    const r = this.renderer.domElement.getBoundingClientRect();
    const [minX, maxX] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [minY, maxY] = [Math.min(y0, y1), Math.max(y0, y1)];
    this.camera.updateMatrixWorld();
    const out: number[] = [];
    const v = new THREE.Vector3();
    for (const [id, e] of this.entries) {
      const m = e.mesh;
      if (!m.visible || !m.parent?.visible) continue;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox!;
      let sx0 = Infinity;
      let sy0 = Infinity;
      let sx1 = -Infinity;
      let sy1 = -Infinity;
      let behind = false;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld).project(this.camera);
        if (v.z > 1) behind = true;
        const px = r.left + ((v.x + 1) / 2) * r.width;
        const py = r.top + ((1 - v.y) / 2) * r.height;
        sx0 = Math.min(sx0, px);
        sy0 = Math.min(sy0, py);
        sx1 = Math.max(sx1, px);
        sy1 = Math.max(sy1, py);
      }
      if (behind) continue;
      const inside = sx0 >= minX && sx1 <= maxX && sy0 >= minY && sy1 <= maxY;
      const touches = sx0 <= maxX && sx1 >= minX && sy0 <= maxY && sy1 >= minY;
      if (crossing ? touches : inside) out.push(id);
    }
    return out;
  }

  /** Caixa (cena) dos elementos indicados, ou null. */
  getBounds(ids: number[]): { min: Vec3; max: Vec3 } | null {
    const box = new THREE.Box3();
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e) box.expandByObject(e.mesh);
    }
    return box.isEmpty() ? null : { min: box.min.toArray() as Vec3, max: box.max.toArray() as Vec3 };
  }

  /** Enquadra os elementos; `direction` é de onde a câmera olha (padrão: diagonal superior). */
  fitTo(ids?: number[], direction?: Vec3) {
    const box = new THREE.Box3();
    const list = ids?.length ? ids : [...this.entries.keys()].filter((id) => this.entries.get(id)!.mesh.visible);
    for (const id of list) {
      const e = this.entries.get(id);
      if (e) box.expandByObject(e.mesh);
    }
    if (box.isEmpty()) return;
    this.fitBox(box, direction);
  }

  /** Enquadra uma caixa (cena). */
  fitBounds(min: Vec3, max: Vec3, direction?: Vec3) {
    this.fitBox(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), direction);
  }

  private fitBox(box: THREE.Box3, direction?: Vec3) {
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    // Usa o menor entre os campos de visão vertical e horizontal.
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vFov, hFov) / 2);
    const dir = new THREE.Vector3(...(direction ?? [1, 0.8, 1])).normalize();
    this.camera.position.copy(center).addScaledVector(dir, Math.max(distance * 1.1, 1.5));
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  /** Posiciona a câmera olhando de `eye` para `target` (coordenadas da cena). */
  setView(eye: Vec3, target: Vec3) {
    this.camera.position.set(...eye);
    this.camera.near = 0.01;
    this.camera.far = 5000;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(...target);
    this.controls.update();
    this.requestRender();
  }

  /** Posição na tela (px, coordenadas do cliente) de um ponto da cena. */
  toScreen(p: Vec3): { x: number; y: number } {
    const v = new THREE.Vector3(...p).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Câmera atual (para gravar numa vista 3D). */
  getCamera(): { eye: Vec3; target: Vec3 } {
    return { eye: this.camera.position.toArray() as Vec3, target: this.controls.target.toArray() as Vec3 };
  }

  /**
   * Imagem de uma vista 3D (câmera, recortes e elementos visíveis), sem mudar a vista atual.
   * Devolve o PNG e a proporção largura/altura.
   */
  snapshotView(v: { eye?: Vec3; target?: Vec3; frame?: { min: Vec3; max: Vec3 }; clip?: { normal: Vec3; point: Vec3 }[]; visible?: Set<number> | null }): { href: string; aspect: number } {
    const pos = this.camera.position.clone();
    const tgt = this.controls.target.clone();
    const near = this.camera.near;
    const far = this.camera.far;
    const extra = this.extraPlanes;
    const vis = this.visible;
    if (v.visible !== undefined) this.setVisible(v.visible);
    this.extraPlanes = (v.clip ?? []).map((p) => {
      const n = new THREE.Vector3(...p.normal).normalize();
      return new THREE.Plane(n, -n.dot(new THREE.Vector3(...p.point)));
    });
    this.clipPlanes = [...this.sectionPlanes, ...this.extraPlanes];
    this.renderer.clippingPlanes = this.clipPlanes;
    if (v.eye && v.target) this.setView(v.eye, v.target);
    else if (v.frame) this.fitBounds(v.frame.min, v.frame.max);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const href = this.renderer.domElement.toDataURL("image/png");
    const aspect = this.renderer.domElement.width / Math.max(1, this.renderer.domElement.height);
    // Restaura a vista.
    this.camera.position.copy(pos);
    this.controls.target.copy(tgt);
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.extraPlanes = extra;
    this.applyClip();
    if (v.visible !== undefined) this.setVisible(vis);
    this.requestRender();
    return { href, aspect };
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.removeKeyListeners();
    this.clear();
    this.materialCache.forEach((m) => m.dispose());
    this.geometryCache.forEach((g) => g.dispose());
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private cachedGeometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geometryCache.get(key);
    if (!g) {
      g = make();
      this.geometryCache.set(key, g);
    }
    return g;
  }

  private buildMesh(v: Visual, material: THREE.Material): THREE.Mesh {
    if (v.kind === "segmento") {
      // Geometria de comprimento unitário ao longo de Y, escalada e orientada pela base do perfil.
      const geometry =
        v.profile === "circular"
          ? this.cachedGeometry(`seg:c:${v.width}`, () => new THREE.CylinderGeometry(v.width / 2, v.width / 2, 1, 16).translate(0, 0.5, 0))
          : this.cachedGeometry(`seg:r:${v.width}:${v.height}`, () => new THREE.BoxGeometry(v.width, 1, v.height).translate(0, 0.5, 0));
      const mesh = new THREE.Mesh(geometry, material);
      const start = new THREE.Vector3(...v.start);
      const dir = new THREE.Vector3(...v.end).sub(start);
      const length = Math.max(dir.length(), 1e-4);
      const { x, z } = segmentBasis([dir.x, dir.y, dir.z]);
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), dir.clone().normalize(), new THREE.Vector3(...z));
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.scale.set(1, length, 1);
      mesh.position.copy(start);
      mesh.updateMatrixWorld();
      return mesh;
    }
    if (v.kind === "no") {
      const geometry =
        v.profile === "circular"
          ? this.cachedGeometry(`no:c:${v.width}`, () => new THREE.SphereGeometry(v.width * 0.6, 16, 12))
          : this.cachedGeometry(`no:r:${v.width}:${v.height}`, () => new THREE.BoxGeometry(v.width * 1.05, v.height * 1.05, v.width * 1.05));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...v.position);
      mesh.updateMatrixWorld();
      return mesh;
    }
    const [w, d, h] = v.size;
    if (v.mesh) {
      let cached = this.meshGeometry.get(v.mesh);
      if (!cached) {
        // Triângulos soltos (não compartilham vértices entre faces) e normais com quinas: as
        // arestas vivas da família ficam nítidas e só as superfícies curvas são suavizadas.
        const { positions, indices, triColors } = v.mesh;
        const n = indices.length;
        const pos = new Float32Array(n * 3);
        const col = triColors ? new Float32Array(n * 3) : null;
        for (let i = 0; i < n; i++) {
          const vi = indices[i] * 3;
          pos[i * 3] = positions[vi] / 1000;
          pos[i * 3 + 1] = positions[vi + 1] / 1000;
          pos[i * 3 + 2] = positions[vi + 2] / 1000;
          if (col && triColors) {
            const t = Math.floor(i / 3) * 3;
            col[i * 3] = triColors[t] / 255;
            col[i * 3 + 1] = triColors[t + 1] / 255;
            col[i * 3 + 2] = triColors[t + 2] / 255;
          }
        }
        let g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        g = toCreasedNormals(g, Math.PI / 6);
        g.computeBoundingBox();
        g.computeBoundingSphere();
        cached = { geometry: g, edges: new THREE.EdgesGeometry(g, 30) };
        this.meshGeometry.set(v.mesh, cached);
      }
      const mesh = new THREE.Mesh(cached.geometry, material);
      // Contorno das arestas (como a vista sombreada com arestas do Revit).
      const edges = new THREE.LineSegments(cached.edges, this.edgeMaterial);
      edges.raycast = () => {};
      mesh.add(edges);
      mesh.position.set(...v.position);
      mesh.rotation.y = v.rotation;
      mesh.updateMatrixWorld();
      return mesh;
    }
    const geometry = this.cachedGeometry(`${v.shape}:${w}:${d}:${h}`, () =>
      v.shape === "cilindro" ? new THREE.CylinderGeometry(w / 2, w / 2, h, 24) : new THREE.BoxGeometry(w, h, d),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...v.position);
    mesh.rotation.y = v.rotation;
    mesh.updateMatrixWorld();
    return mesh;
  }

  /** Pré-visualização fixa, independente do cursor (ex.: traçado automático proposto). */
  setStaticPreview(items: PreviewItem[]) {
    this.staticPreviewItems = items;
    this.notifyPlacement();
    this.staticPreviewGroup.clear();
    for (const it of items) {
      const mesh = this.buildMesh(it, it.ok ? this.previewOk : this.previewBad);
      mesh.renderOrder = 2;
      this.staticPreviewGroup.add(mesh);
    }
    this.requestRender();
  }

  private showPreview(items: PreviewItem[]) {
    this.previewGroup.clear();
    for (const it of items) {
      const mesh = this.buildMesh(it, it.ok ? this.previewOk : this.previewBad);
      mesh.renderOrder = 2;
      this.previewGroup.add(mesh);
    }
    this.requestRender();
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Superfícies do modelo IFC que aceitam locação (visíveis e não translúcidas). */
  private pickTargets(): THREE.Object3D[] {
    return this.modelGroup.children.filter((o) => o.visible && (o as THREE.Mesh).material !== this.ghostMaterial);
  }

  private worldNormal(hit: THREE.Intersection): THREE.Vector3 | null {
    if (!hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    // Faces de malhas de dupla face podem vir invertidas: aponta para quem olha.
    if (n.dot(this.raycaster.ray.direction) > 0) n.negate();
    return n;
  }

  /** Superfície do modelo e objeto do app sob o cursor, mais o raio da câmera. */
  private probe(clientX: number, clientY: number): { hit: SurfaceHit | null; ctx: PointerContext } {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const { origin, direction } = this.raycaster.ray;
    const modelHit = this.raycaster.intersectObjects(this.pickTargets(), false).find((h) => !this.clipped(h.point));
    const n = modelHit && this.worldNormal(modelHit);
    const extras = [...this.pointsGroup.children, ...this.runsGroup.children].filter((o) => o.visible);
    const extraHit = this.raycaster.intersectObjects(extras, false).find((h) => !this.clipped(h.point));
    const extraInFront = extraHit && (!modelHit || extraHit.distance <= modelHit.distance + 0.05);
    return {
      hit: modelHit && n ? { point: [modelHit.point.x, modelHit.point.y, modelHit.point.z], normal: [n.x, n.y, n.z] } : null,
      ctx: {
        ray: { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z] },
        shift: this.shiftDown,
        objectId: extraInFront ? (extraHit.object.userData.expressID as number) : null,
        objectPoint: extraInFront ? [extraHit.point.x, extraHit.point.y, extraHit.point.z] : null,
      },
    };
  }

  private updateHover() {
    if (!this.placement) return;
    if (!this.hoverPos) {
      this.showPreview([]);
      return;
    }
    const { hit, ctx } = this.probe(this.hoverPos.x, this.hoverPos.y);
    this.showPreview(this.placement.hover(hit, ctx));
  }

  private refreshMaterials() {
    for (const [id, e] of this.entries) {
      let mat: THREE.Material = this.colorMode === "ifc" ? e.ifcMaterial : e.disciplineMaterial;
      // Com destaque ativo (ex.: interferência), todo o resto fica translúcido,
      // inclusive a seleção, para não esconder o par em conflito.
      if (this.highlighted.has(id)) mat = this.highlightMaterial;
      else if (this.ghosted) mat = this.ghostMaterial;
      else if (this.selected.has(id)) mat = this.selectionMaterial;
      e.mesh.material = mat;
      e.mesh.renderOrder = mat === this.ghostMaterial ? 1 : 0;
    }
    this.requestRender();
  }

  private material(r: number, g: number, b: number, a: number): THREE.Material {
    const key = [r, g, b, a].map((v) => v.toFixed(3)).join(",");
    let m = this.materialCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        color: new THREE.Color(r, g, b),
        transparent: a < 1,
        opacity: a,
        side: THREE.DoubleSide,
        depthWrite: a >= 1,
      });
      this.materialCache.set(key, m);
    }
    return m;
  }

  private pick(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const targets = [...this.pointsGroup.children, ...this.runsGroup.children, ...this.modelGroup.children].filter(
      (o) => o.visible && (o as THREE.Mesh).material !== this.ghostMaterial,
    );
    const hit = this.raycaster.intersectObjects(targets, false).find((h) => !this.clipped(h.point));
    return hit ? (hit.object.userData.expressID as number) : null;
  }

  /** Fundo da vista: claro (branco) ou escuro (preto). */
  setTheme(dark: boolean) {
    this.renderer.setClearColor(dark ? 0x0b0d10 : 0xffffff);
    const old = this.scene.getObjectByName("grid") as THREE.GridHelper | undefined;
    const grid = dark ? new THREE.GridHelper(100, 100, 0x3a4250, 0x22272f) : new THREE.GridHelper(100, 100, 0xb6c2d1, 0xe2e8f0);
    grid.name = "grid";
    if (old) {
      grid.position.copy(old.position);
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
    this.scene.add(grid);
    this.ghostMaterial.color.set(dark ? 0x9aa4b2 : 0x64748b);
    this.ghostMaterial.opacity = dark ? 0.08 : 0.1;
    this.requestRender();
  }

  private placeGrid() {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const grid = this.scene.getObjectByName("grid");
    if (grid && !box.isEmpty()) grid.position.set((box.min.x + box.max.x) / 2, box.min.y - 0.01, (box.min.z + box.max.z) / 2);
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender() {
    this.needsRender = true;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    if (this.hoverDirty) {
      this.hoverDirty = false;
      this.updateHover();
    }
    const changed = this.controls.update();
    if (this.needsRender || changed) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };
}
