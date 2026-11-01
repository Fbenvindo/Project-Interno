import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ElementMesh } from "../../../ifc/loadIfc";

export type ColorMode = "ifc" | "disciplina";

interface Entry {
  mesh: THREE.Mesh;
  ifcMaterial: THREE.Material;
  disciplineMaterial: THREE.Material;
}

/** Visualizador 3D: um THREE.Mesh por elemento IFC, com seleção, filtros e enquadramento. */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private modelGroup = new THREE.Group();
  private entries = new Map<number, Entry>();
  private materialCache = new Map<string, THREE.Material>();
  private selectionMaterial = new THREE.MeshLambertMaterial({ color: 0x00e5ff, emissive: 0x004455, side: THREE.DoubleSide });
  private highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xff2d55, emissive: 0x440011, side: THREE.DoubleSide });
  private ghostMaterial = new THREE.MeshLambertMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.08, depthWrite: false });
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
    this.scene.add(this.modelGroup);

    const grid = new THREE.GridHelper(100, 100, 0x3a4250, 0x262c35);
    grid.name = "grid";
    this.scene.add(grid);

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => (this.pointerDown = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener("pointerup", (e) => {
      if (!this.pointerDown) return;
      const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      this.pointerDown = null;
      if (moved < 4 && e.button === 0) this.onPick(this.pick(e.clientX, e.clientY), e.ctrlKey || e.metaKey || e.shiftKey);
    });
    canvas.addEventListener("dblclick", () => this.fitTo(this.selected.size ? [...this.selected] : undefined));

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
      this.entries.set(m.expressID, { mesh, ifcMaterial, disciplineMaterial });
    }
    this.placeGrid();
    this.fitTo();
  }

  clear() {
    for (const { mesh } of this.entries.values()) mesh.geometry.dispose();
    this.modelGroup.clear();
    this.entries.clear();
    this.selected.clear();
    this.highlighted.clear();
    this.visible = null;
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

  fitTo(ids?: number[]) {
    const box = new THREE.Box3();
    const list = ids?.length ? ids : [...this.entries.keys()].filter((id) => this.entries.get(id)!.mesh.visible);
    for (const id of list) {
      const e = this.entries.get(id);
      if (e?.mesh.geometry.boundingBox) box.union(e.mesh.geometry.boundingBox);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, distance * 1.1);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
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
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = this.modelGroup.children.filter((o) => o.visible && (o as THREE.Mesh).material !== this.ghostMaterial);
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
    const changed = this.controls.update();
    if (this.needsRender || changed) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };
}
