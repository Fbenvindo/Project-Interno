import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Shape } from "../../../core/library";
import type { SurfaceHit } from "../../../core/placement";
import type { Vec3 } from "../../../core/types";
import type { ElementMesh } from "../../../ifc/loadIfc";

export type ColorMode = "ifc" | "disciplina";

/** Representação de um componente locado (ou de sua pré-visualização). */
export interface PointVisual {
  id: number;
  shape: Shape;
  /** [largura, profundidade, altura] em metros. */
  size: Vec3;
  position: Vec3;
  rotation: number;
  color: string;
}

export interface PreviewItem extends Omit<PointVisual, "id" | "color"> {
  ok: boolean;
}

/** Modo de locação: o visualizador informa a superfície sob o cursor e os cliques. */
export interface PlacementHandler {
  hover(hit: SurfaceHit | null): PreviewItem[];
  click(hit: SurfaceHit): void;
}

interface Entry {
  mesh: THREE.Mesh;
  ifcMaterial: THREE.Material;
  disciplineMaterial: THREE.Material;
  isPoint: boolean;
}

/** Visualizador 3D: um THREE.Mesh por elemento IFC ou ponto locado, com seleção, filtros e locação. */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private modelGroup = new THREE.Group();
  private pointsGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
  private entries = new Map<number, Entry>();
  private materialCache = new Map<string, THREE.Material>();
  private geometryCache = new Map<string, THREE.BufferGeometry>();
  private selectionMaterial = new THREE.MeshLambertMaterial({ color: 0x00e5ff, emissive: 0x004455, side: THREE.DoubleSide });
  private highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xff2d55, emissive: 0x440011, side: THREE.DoubleSide });
  private ghostMaterial = new THREE.MeshLambertMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.08, depthWrite: false });
  private previewOk = new THREE.MeshLambertMaterial({ color: 0x2fbf71, emissive: 0x0c3a20, transparent: true, opacity: 0.75 });
  private previewBad = new THREE.MeshLambertMaterial({ color: 0xef5350, emissive: 0x3a0c0c, transparent: true, opacity: 0.6 });
  private colorMode: ColorMode = "disciplina";
  private selected = new Set<number>();
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
    this.controls.addEventListener("change", () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);
    this.scene.add(this.modelGroup, this.pointsGroup, this.previewGroup);

    const grid = new THREE.GridHelper(100, 100, 0x3a4250, 0x262c35);
    grid.name = "grid";
    this.scene.add(grid);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => (this.pointerDown = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerup", (e) => {
      if (!this.pointerDown) return;
      const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      this.pointerDown = null;
      if (moved >= 4 || e.button !== 0) return;
      if (this.placement) {
        const hit = this.surfaceHit(e.clientX, e.clientY);
        if (hit) this.placement.click(hit);
        this.refreshPlacement();
      } else {
        this.onPick(this.pick(e.clientX, e.clientY), e.ctrlKey || e.metaKey || e.shiftKey);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.placement) return;
      this.hoverPos = { x: e.clientX, y: e.clientY };
      this.hoverDirty = true;
    });
    canvas.addEventListener("pointerleave", () => {
      if (!this.placement) return;
      this.hoverPos = null;
      this.hoverDirty = true;
    });
    canvas.addEventListener("dblclick", () => {
      if (!this.placement) this.fitTo(this.selected.size ? [...this.selected] : undefined);
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  load(meshes: ElementMesh[], disciplineColorOf: (expressID: number) => string) {
    this.clear();
    for (const m of meshes) {
      if (!m.positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(m.indices, 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const ifcMaterial = this.material(m.color[0], m.color[1], m.color[2], m.color[3]);
      const disciplineColor = new THREE.Color(disciplineColorOf(m.expressID));
      const disciplineMaterial = this.material(disciplineColor.r, disciplineColor.g, disciplineColor.b, m.color[3] < 1 ? 0.4 : 1);
      const mesh = new THREE.Mesh(geometry, this.colorMode === "ifc" ? ifcMaterial : disciplineMaterial);
      mesh.userData.expressID = m.expressID;
      this.modelGroup.add(mesh);
      this.entries.set(m.expressID, { mesh, ifcMaterial, disciplineMaterial, isPoint: false });
    }
    this.placeGrid();
    this.fitTo();
  }

  clear() {
    for (const { mesh, isPoint } of this.entries.values()) if (!isPoint) mesh.geometry.dispose();
    this.modelGroup.clear();
    this.pointsGroup.clear();
    this.entries.clear();
    this.selected.clear();
    this.highlighted.clear();
    this.visible = null;
    this.requestRender();
  }

  /** Substitui os pontos locados exibidos. */
  setPoints(points: PointVisual[]) {
    for (const [id, e] of this.entries) if (e.isPoint) this.entries.delete(id);
    this.pointsGroup.clear();
    for (const p of points) {
      const c = new THREE.Color(p.color);
      const mat = this.material(c.r, c.g, c.b, 1);
      const mesh = this.shapeMesh(p, mat);
      mesh.userData.expressID = p.id;
      this.pointsGroup.add(mesh);
      this.entries.set(p.id, { mesh, ifcMaterial: mat, disciplineMaterial: mat, isPoint: true });
    }
    this.setVisible(this.visible);
  }

  /** Ativa (ou desativa, com null) o modo de locação. */
  setPlacementHandler(handler: PlacementHandler | null) {
    this.placement = handler;
    this.renderer.domElement.style.cursor = handler ? "crosshair" : "";
    if (!handler) this.showPreview([]);
    this.hoverDirty = true;
  }

  /** Recalcula a pré-visualização (ex.: após girar ou mudar a altura). */
  refreshPlacement() {
    this.hoverDirty = true;
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

  /** Enquadra os elementos; `direction` é de onde a câmera olha (padrão: diagonal superior). */
  fitTo(ids?: number[], direction?: Vec3) {
    const box = new THREE.Box3();
    const list = ids?.length ? ids : [...this.entries.keys()].filter((id) => this.entries.get(id)!.mesh.visible);
    for (const id of list) {
      const e = this.entries.get(id);
      if (e) box.expandByObject(e.mesh);
    }
    if (box.isEmpty()) return;
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

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clear();
    this.materialCache.forEach((m) => m.dispose());
    this.geometryCache.forEach((g) => g.dispose());
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private shapeMesh(p: Omit<PointVisual, "id" | "color">, material: THREE.Material): THREE.Mesh {
    const [w, d, h] = p.size;
    const key = `${p.shape}:${w}:${d}:${h}`;
    let geometry = this.geometryCache.get(key);
    if (!geometry) {
      geometry = p.shape === "cilindro" ? new THREE.CylinderGeometry(w / 2, w / 2, h, 24) : new THREE.BoxGeometry(w, h, d);
      this.geometryCache.set(key, geometry);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p.position);
    mesh.rotation.y = p.rotation;
    mesh.updateMatrixWorld();
    return mesh;
  }

  private showPreview(items: PreviewItem[]) {
    this.previewGroup.clear();
    for (const it of items) {
      const mesh = this.shapeMesh(it, it.ok ? this.previewOk : this.previewBad);
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

  private surfaceHit(clientX: number, clientY: number): SurfaceHit | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets(), false)[0];
    const n = hit && this.worldNormal(hit);
    if (!hit || !n) return null;
    return { point: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z] };
  }

  private updateHover() {
    if (!this.placement) return;
    const hit = this.hoverPos ? this.surfaceHit(this.hoverPos.x, this.hoverPos.y) : null;
    this.showPreview(this.placement.hover(hit));
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
    const targets = [...this.pointsGroup.children, ...this.modelGroup.children].filter(
      (o) => o.visible && (o as THREE.Mesh).material !== this.ghostMaterial,
    );
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? (hit.object.userData.expressID as number) : null;
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
