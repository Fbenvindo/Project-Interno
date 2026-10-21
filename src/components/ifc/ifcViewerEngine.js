import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IfcAPI, IFCSPACE } from 'web-ifc';
import wasmUrl from 'web-ifc/web-ifc.wasm?url';

const HIGHLIGHT_MATERIAL = new THREE.MeshLambertMaterial({
  color: 0x2563eb,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
  depthTest: true,
});

// Ambiente selecionado é desenhado por cima das paredes para ficar visível
const SPACE_HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x2563eb,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthTest: false,
  depthWrite: false,
});

const SPACE_MATERIAL = new THREE.MeshLambertMaterial({
  color: 0x22c55e,
  transparent: true,
  opacity: 0.25,
  side: THREE.DoubleSide,
  depthWrite: false,
});

export const isSpaceType = (type) => String(type || '').toUpperCase() === 'IFCSPACE';

let ifcApiPromise = null;

// O módulo WASM é carregado uma única vez e compartilhado entre instâncias do visualizador.
function getIfcApi() {
  if (!ifcApiPromise) {
    ifcApiPromise = (async () => {
      const api = new IfcAPI();
      await api.Init((path) => (path.endsWith('.wasm') ? wasmUrl : path), true);
      return api;
    })().catch((err) => {
      ifcApiPromise = null;
      throw err;
    });
  }
  return ifcApiPromise;
}

export class IfcViewerEngine {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.api = null;
    this.modelID = null;
    this.meshesById = new Map();
    this.typeById = new Map();
    this.materialCache = new Map();
    this.selectedId = null;
    this.tree = null;
    this.modelGroup = new THREE.Group();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);

    const { clientWidth: w, clientHeight: h } = container;
    this.camera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 10000);
    this.camera.position.set(20, 20, 20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(50, 100, 30);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-50, 40, -30);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(100, 50, 0xcbd5e1, 0xe2e8f0);
    this.scene.add(this.grid);
    this.scene.add(this.modelGroup);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._downPos = null;

    this._onPointerDown = (e) => { this._downPos = { x: e.clientX, y: e.clientY }; };
    this._onPointerUp = (e) => this._handleClick(e);
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this._onPointerUp);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);

    this._animate = this._animate.bind(this);
    this._frame = requestAnimationFrame(this._animate);
  }

  _animate() {
    this._frame = requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _handleClick(e) {
    // Ignora o clique se o usuário arrastou para orbitar a câmera
    if (!this._downPos || Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const visible = this.modelGroup.children.filter((m) => m.visible);
    const hit = this.raycaster.intersectObjects(visible, false)[0];
    const id = hit ? hit.object.userData.expressID : null;
    this.select(id);
    this.onSelect?.(id);
  }

  _getMaterial(color) {
    const key = `${color.x}-${color.y}-${color.z}-${color.w}`;
    let mat = this.materialCache.get(key);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(color.x, color.y, color.z),
        transparent: color.w < 1,
        opacity: color.w,
        side: THREE.DoubleSide,
        depthWrite: color.w >= 1,
      });
      this.materialCache.set(key, mat);
    }
    return mat;
  }

  // source: File/Blob local ou os bytes do arquivo (Uint8Array) já baixados
  async load(source, onProgress) {
    this.api = await getIfcApi();
    this.clear();

    const data = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
    onProgress?.({ stage: 'Lendo arquivo...', percent: 0 });
    const modelID = this.api.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    if (modelID < 0) throw new Error('Não foi possível abrir o arquivo IFC.');
    this.modelID = modelID;

    let lastReport = 0;
    this.api.StreamAllMeshes(modelID, (flatMesh, index, total) => {
      this._addFlatMesh(flatMesh);
      const percent = Math.round(((index + 1) / total) * 100);
      if (percent - lastReport >= 5) {
        lastReport = percent;
        onProgress?.({ stage: 'Gerando geometria...', percent });
      }
    });
    // Ambientes (IfcSpace) não vêm no StreamAllMeshes; ficam ocultos por padrão
    this.api.StreamAllMeshesWithTypes(modelID, [IFCSPACE], (flatMesh) => {
      this._addFlatMesh(flatMesh, SPACE_MATERIAL).forEach((m) => { m.visible = false; });
    });

    onProgress?.({ stage: 'Montando estrutura...', percent: 100 });
    const spatial = await this.api.properties.getSpatialStructure(modelID, false);
    const tree = await this._decorateTree(spatial);
    this.tree = tree;
    this.fitToView();

    return {
      tree,
      schema: this.api.GetModelSchema(modelID),
      elementCount: [...this.typeById.values()].filter((t) => !isSpaceType(t)).length,
      types: this._countTypes(),
    };
  }

  _addFlatMesh(flatMesh, material = null) {
    const modelID = this.modelID;
    const id = flatMesh.expressID;
    const placed = flatMesh.geometries;
    const matrix = new THREE.Matrix4();
    const created = [];
    for (let i = 0; i < placed.size(); i++) {
      const pg = placed.get(i);
      const geomData = this.api.GetGeometry(modelID, pg.geometryExpressID);
      const verts = this.api.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize());
      const indices = this.api.GetIndexArray(geomData.GetIndexData(), geomData.GetIndexDataSize());

      // Cada vértice tem 6 floats: posição (x, y, z) e normal (nx, ny, nz)
      const interleaved = new THREE.InterleavedBuffer(new Float32Array(verts), 6);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
      geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      geomData.delete();

      const mesh = new THREE.Mesh(geometry, material || this._getMaterial(pg.color));
      matrix.fromArray(pg.flatTransformation);
      mesh.applyMatrix4(matrix);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.expressID = id;
      mesh.userData.baseMaterial = mesh.material;
      this.modelGroup.add(mesh);
      created.push(mesh);

      if (!this.meshesById.has(id)) this.meshesById.set(id, []);
      this.meshesById.get(id).push(mesh);
    }
    if (!this.typeById.has(id)) {
      this.typeById.set(id, this.api.GetNameFromTypeCode(this.api.GetLineType(modelID, id)));
    }
    return created;
  }

  async _decorateTree(node) {
    let name = null;
    try {
      const props = await this.api.properties.getItemProperties(this.modelID, node.expressID, false);
      name = props?.LongName?.value || props?.Name?.value || null;
    } catch {
      name = null;
    }
    const children = [];
    for (const child of node.children || []) {
      children.push(await this._decorateTree(child));
    }
    return {
      expressID: node.expressID,
      type: node.type,
      name,
      hasGeometry: this.meshesById.has(node.expressID),
      children,
    };
  }

  _countTypes() {
    const counts = new Map();
    for (const type of this.typeById.values()) counts.set(type, (counts.get(type) || 0) + 1);
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  async getProperties(expressID) {
    if (this.modelID == null || expressID == null) return null;
    const props = this.api.properties;
    const item = await props.getItemProperties(this.modelID, expressID, false);
    // includeTypeProperties=true retorna vazio no web-ifc, por isso os psets do tipo são lidos à parte
    const psets = await props.getPropertySets(this.modelID, expressID, true, false);
    let typePsets = [];
    try {
      const typeObjects = await props.getTypeProperties(this.modelID, expressID, true);
      typePsets = typeObjects.flatMap((t) => (t.HasPropertySets || []).filter(Boolean));
    } catch {
      typePsets = [];
    }
    let materials = [];
    try {
      materials = await props.getMaterialsProperties(this.modelID, expressID, true, true);
    } catch {
      materials = [];
    }

    const attributes = [];
    for (const [key, val] of Object.entries(item || {})) {
      // type 5 = referência para outra entidade; mostramos apenas valores simples
      if (val && typeof val === 'object' && 'value' in val && typeof val.value !== 'object' && val.type !== 5) {
        attributes.push({ name: key, value: String(val.value) });
      }
    }
    attributes.unshift({ name: 'Tipo', value: this.typeById.get(expressID) || this.api.GetNameFromTypeCode(item?.type) });
    attributes.unshift({ name: 'ExpressID', value: String(expressID) });

    const groups = [
      ...psets.map((set) => ({ set, suffix: '' })),
      ...typePsets.map((set) => ({ set, suffix: ' (tipo)' })),
    ].map(({ set, suffix }) => {
      const entries = set.HasProperties || set.Quantities || [];
      return {
        name: (set?.Name?.value || 'Sem nome') + suffix,
        properties: entries
          .filter(Boolean)
          .map((p) => ({ name: p?.Name?.value ?? '—', value: formatIfcValue(p) })),
      };
    }).filter((g) => g.properties.length > 0);

    const materialNames = materials
      .flatMap((m) => this._collectMaterialNames(m))
      .filter((v, i, arr) => v && arr.indexOf(v) === i);

    return { attributes, groups, materials: materialNames };
  }

  _collectMaterialNames(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return [];
    if (Array.isArray(node)) return node.flatMap((n) => this._collectMaterialNames(n, depth + 1));
    const names = [];
    if (typeof node.type === 'number' && node.Name?.value) {
      const typeName = this.api.GetNameFromTypeCode(node.type) || '';
      if (/^IFCMATERIAL(LAYER|CONSTITUENT|PROFILE)?$/i.test(typeName)) names.push(node.Name.value);
    }
    for (const [key, val] of Object.entries(node)) {
      if (key !== 'Name' && val && typeof val === 'object') names.push(...this._collectMaterialNames(val, depth + 1));
    }
    return names;
  }

  select(expressID) {
    if (this.selectedId != null) {
      for (const m of this.meshesById.get(this.selectedId) || []) {
        m.material = m.userData.baseMaterial;
        m.renderOrder = 0;
        if (m.userData.tempVisible) { m.visible = false; m.userData.tempVisible = false; }
      }
    }
    this.selectedId = expressID;
    if (expressID != null) {
      const highlight = isSpaceType(this.typeById.get(expressID)) ? SPACE_HIGHLIGHT_MATERIAL : HIGHLIGHT_MATERIAL;
      for (const m of this.meshesById.get(expressID) || []) {
        m.material = highlight;
        m.renderOrder = highlight === SPACE_HIGHLIGHT_MATERIAL ? 10 : 0;
        // Um ambiente oculto aparece enquanto estiver selecionado
        if (!m.visible) { m.visible = true; m.userData.tempVisible = true; }
      }
    }
  }

  hasGeometry(expressID) {
    return this.meshesById.has(expressID);
  }

  focus(ids) {
    const box = new THREE.Box3();
    for (const id of ids) (this.meshesById.get(id) || []).forEach((m) => box.expandByObject(m));
    if (box.isEmpty()) return;
    this._fitBox(box, ids.length > 1 ? 1.4 : 2.2);
  }

  setTypeVisible(type, visible) {
    for (const [id, meshes] of this.meshesById) {
      if (this.typeById.get(id) === type) meshes.forEach((m) => { m.visible = visible; });
    }
  }

  // Ambientes só aparecem quando são o único item pedido (ex.: um ambiente clicado na árvore)
  setElementsVisible(ids, visible) {
    for (const id of ids) {
      const show = visible && (ids.length === 1 || !isSpaceType(this.typeById.get(id)));
      (this.meshesById.get(id) || []).forEach((m) => { m.visible = show; });
    }
  }

  isolate(ids) {
    const keep = new Set(ids);
    for (const [id, meshes] of this.meshesById) {
      const show = keep.has(id) && (ids.length === 1 || !isSpaceType(this.typeById.get(id)));
      meshes.forEach((m) => { m.visible = show; });
    }
  }

  // Mostra todos os elementos; os ambientes continuam ocultos
  showAll() {
    for (const [id, meshes] of this.meshesById) {
      const visible = !isSpaceType(this.typeById.get(id));
      meshes.forEach((m) => { m.visible = visible; m.userData.tempVisible = false; });
    }
    if (this.selectedId != null) this.select(this.selectedId);
  }

  fitToView() {
    const box = new THREE.Box3();
    this.modelGroup.children.forEach((m) => { if (m.visible) box.expandByObject(m); });
    if (box.isEmpty()) return;
    this._fitBox(box, 1.4);

    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, 10);
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = new THREE.GridHelper(Math.ceil(extent * 2), 40, 0xcbd5e1, 0xe2e8f0);
    this.grid.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y, box.getCenter(new THREE.Vector3()).z);
    this.scene.add(this.grid);
  }

  _fitBox(box, padding) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius * padding) / Math.sin(fov / 2);
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, distance);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  clear() {
    this.select(null);
    for (const mesh of this.modelGroup.children) mesh.geometry.dispose();
    this.modelGroup.clear();
    this.meshesById.clear();
    this.typeById.clear();
    this.tree = null;
    if (this.api && this.modelID != null) this.api.CloseModel(this.modelID);
    this.modelID = null;
  }

  dispose() {
    cancelAnimationFrame(this._frame);
    this._resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this._onPointerUp);
    this.clear();
    this.materialCache.forEach((m) => m.dispose());
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function formatIfcValue(prop) {
  const raw =
    prop?.NominalValue?.value ??
    prop?.LengthValue?.value ??
    prop?.AreaValue?.value ??
    prop?.VolumeValue?.value ??
    prop?.CountValue?.value ??
    prop?.WeightValue?.value ??
    prop?.TimeValue?.value ??
    prop?.EnumerationValues?.map?.((v) => v?.value).join(', ');
  if (raw === undefined || raw === null) return '—';
  if (typeof raw === 'number') return Number.isInteger(raw) ? String(raw) : raw.toFixed(3);
  if (raw === 'T' || raw === true) return 'Sim';
  if (raw === 'F' || raw === false) return 'Não';
  return String(raw);
}
