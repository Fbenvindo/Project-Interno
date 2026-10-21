import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IfcAPI, IFCPROJECT, IFCSPACE } from 'web-ifc';
import wasmUrl from 'web-ifc/web-ifc.wasm?url';
import { lerUnidades } from '@/components/ifc/ifcLevantamento';

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

// Estilo técnico: faces brancas (empurradas para trás para as arestas ficarem nítidas) e arestas pretas
// Branco com sombreamento: tubos e cilindros, que quase não têm arestas vivas, continuam legíveis
const TECH_FILL_MATERIAL = new THREE.MeshLambertMaterial({
  color: 0xffffff,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
const TECH_GLASS_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xdbeafe,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const EDGE_MATERIAL = new THREE.LineBasicMaterial({ color: 0x1e293b });
const MATERIAIS_FIXOS = [HIGHLIGHT_MATERIAL, SPACE_HIGHLIGHT_MATERIAL, SPACE_MATERIAL, TECH_FILL_MATERIAL, TECH_GLASS_MATERIAL, EDGE_MATERIAL];

// Elementos fora do nível filtrado vão para esta camada, que a câmera e o clique não enxergam
const CAMADA_OCULTA = 1;

// Direções da câmera (do alvo para a câmera) na cena: +X leste, +Y para cima, -Z norte de projeto
const r3 = 1 / Math.sqrt(3);
const DIMETRICA = [1 / 3, 1 / 3, Math.sqrt(7 / 9)]; // ISO 5456-3: escalas 1 : 1 : 1/2
const TRIMETRICA = [Math.cos(THREE.MathUtils.degToRad(25)) * Math.sin(THREE.MathUtils.degToRad(30)), Math.sin(THREE.MathUtils.degToRad(25)), Math.cos(THREE.MathUtils.degToRad(25)) * Math.cos(THREE.MathUtils.degToRad(30))];
export const VISTAS = {
  iso_se: { nome: 'Isométrica sudeste', dir: [r3, r3, r3], axonometrica: true },
  iso_so: { nome: 'Isométrica sudoeste', dir: [-r3, r3, r3], axonometrica: true },
  iso_ne: { nome: 'Isométrica nordeste', dir: [r3, r3, -r3], axonometrica: true },
  iso_no: { nome: 'Isométrica noroeste', dir: [-r3, r3, -r3], axonometrica: true },
  dimetrica: { nome: 'Dimétrica', dir: DIMETRICA, axonometrica: true },
  trimetrica: { nome: 'Trimétrica', dir: TRIMETRICA, axonometrica: true },
  topo: { nome: 'Planta (topo)', dir: [0, 1, 1e-3], axonometrica: true },
  frente: { nome: 'Elevação sul (frente)', dir: [0, 0, 1], axonometrica: true },
  fundos: { nome: 'Elevação norte (fundos)', dir: [0, 0, -1], axonometrica: true },
  direita: { nome: 'Elevação leste', dir: [1, 0, 0], axonometrica: true },
  esquerda: { nome: 'Elevação oeste', dir: [-1, 0, 0], axonometrica: true },
};

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
    this.niveis = [];
    this.nivelDe = new Map();
    this.nivelAtivo = null;
    this.alturaCorte = null;
    this.explosao = 0;
    this.estilo = 'cores';
    this.projecao = 'perspectiva';
    this.translacao = [0, 0, 0];
    this.planosCorte = [];
    this.globalIds = new Map();
    this.distantes = [];
    // Elementos repetidos (luminárias, conexões) compartilham geometria e arestas
    this.geometrias = new Map();
    this.arestas = new Map();
    MATERIAIS_FIXOS.forEach((m) => { m.clippingPlanes = this.planosCorte; });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9);

    const { clientWidth: w, clientHeight: h } = container;
    this.perspCamera = new THREE.PerspectiveCamera(45, w / Math.max(h, 1), 0.1, 10000);
    this.perspCamera.position.set(20, 20, 20);
    this.orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 10000);
    this.camera = this.perspCamera;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.localClippingEnabled = true;
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
    this.perspCamera.aspect = w / h;
    this.perspCamera.updateProjectionMatrix();
    this._ajustarOrtho(this._meiaAlturaOrtho());
    this.renderer.setSize(w, h);
  }

  _handleClick(e) {
    // Ignora o clique se o usuário arrastou para orbitar a câmera
    if (!this._downPos || Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y) > 4) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const visible = this.modelGroup.children.filter((m) => m.visible && m.layers.test(this.camera.layers));
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
      mat.clippingPlanes = this.planosCorte;
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
    // Deslocamento aplicado pelo COORDINATE_TO_ORIGIN, em eixos da cena (para voltar às coordenadas do IFC)
    const coord = this.api.GetCoordinationMatrix(modelID);
    this.translacao = [coord[12] || 0, coord[13] || 0, coord[14] || 0];
    this.niveis = this._calcularNiveis();
    this.distantes = this._acharDistantes();
    this.fitToView();

    return {
      tree,
      schema: this.api.GetModelSchema(modelID),
      elementCount: [...this.typeById.values()].filter((t) => !isSpaceType(t)).length,
      types: this._countTypes(),
      niveis: this.niveis.map(({ indice, nome, cotaIfc, quantidade }) => ({ indice, nome, cota: cotaIfc, quantidade })),
      distantes: this.distantes,
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
      let geometry = this.geometrias.get(pg.geometryExpressID);
      if (!geometry) {
        const geomData = this.api.GetGeometry(modelID, pg.geometryExpressID);
        const verts = this.api.GetVertexArray(geomData.GetVertexData(), geomData.GetVertexDataSize());
        const indices = this.api.GetIndexArray(geomData.GetIndexData(), geomData.GetIndexDataSize());

        // Cada vértice tem 6 floats: posição (x, y, z) e normal (nx, ny, nz)
        const interleaved = new THREE.InterleavedBuffer(new Float32Array(verts), 6);
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
        geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        geomData.delete();
        this.geometrias.set(pg.geometryExpressID, geometry);
      }

      const mesh = new THREE.Mesh(geometry, material || this._getMaterial(pg.color));
      matrix.fromArray(pg.flatTransformation);
      mesh.applyMatrix4(matrix);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.userData.expressID = id;
      mesh.userData.baseMaterial = mesh.material;
      mesh.userData.baseMatrix = mesh.matrix.clone();
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
        m.material = this._materialBase(m);
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

  // Elementos muito afastados da massa do modelo (em geral erros de modelagem): não entram no enquadramento
  _acharDistantes() {
    const centros = [];
    for (const [id, meshes] of this.meshesById) {
      if (isSpaceType(this.typeById.get(id))) continue;
      const box = new THREE.Box3();
      meshes.forEach((m) => box.expandByObject(m));
      centros.push({ id, c: box.getCenter(new THREE.Vector3()) });
    }
    if (centros.length < 10) return [];
    const mediana = (arr) => [...arr].sort((a, b) => a - b)[arr.length >> 1];
    const med = new THREE.Vector3(mediana(centros.map((e) => e.c.x)), mediana(centros.map((e) => e.c.y)), mediana(centros.map((e) => e.c.z)));
    const dists = centros.map((e) => e.c.distanceTo(med)).sort((a, b) => a - b);
    const p95 = dists[Math.floor(dists.length * 0.95)];
    const limite = Math.max(p95 * 1.5, dists[dists.length >> 1] * 4, 5);
    return centros
      .map((e) => ({ id: e.id, distancia: e.c.distanceTo(med), tipo: this.typeById.get(e.id) }))
      .filter((e) => e.distancia > limite)
      .sort((a, b) => b.distancia - a.distancia);
  }

  _caixaEnquadramento() {
    const ignorar = new Set(this.distantes.map((d) => d.id));
    const box = new THREE.Box3();
    const tudo = new THREE.Box3();
    for (const m of this.modelGroup.children) {
      if (!m.visible || !m.layers.test(this.camera.layers)) continue;
      tudo.expandByObject(m);
      if (!ignorar.has(m.userData.expressID) || m.userData.expressID === this.selectedId) box.expandByObject(m);
    }
    return box.isEmpty() ? tudo : box;
  }

  fitToView() {
    const box = this._caixaEnquadramento();
    if (box.isEmpty()) return;
    // Na projeção ortográfica mantém a direção atual (a vista axonométrica escolhida)
    this._fitBox(box, 1.4, this.projecao === 'ortografica' ? this._direcaoAtual() : undefined);

    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, 10);
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = new THREE.GridHelper(Math.ceil(extent * 2), 40, 0xcbd5e1, 0xe2e8f0);
    this.grid.position.set(box.getCenter(new THREE.Vector3()).x, box.min.y, box.getCenter(new THREE.Vector3()).z);
    this.grid.visible = this.estilo === 'cores';
    this.scene.add(this.grid);
  }

  _fitBox(box, padding, direcao) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const dir = (direcao || new THREE.Vector3(1, 0.8, 1)).clone().normalize();
    if (this.projecao === 'ortografica') {
      const distancia = radius * 4;
      this.orthoCamera.position.copy(center).addScaledVector(dir, distancia);
      this.orthoCamera.near = 0.01;
      this.orthoCamera.far = distancia * 4;
      this.orthoCamera.zoom = 1;
      // Enquadra pela projeção da caixa no plano da vista
      const cantos = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) cantos.push(new THREE.Vector3(x, y, z));
      this.orthoCamera.up.set(0, 1, 0);
      this.orthoCamera.lookAt(center);
      this.orthoCamera.updateMatrixWorld(true);
      const inv = this.orthoCamera.matrixWorldInverse;
      let mx = 0;
      let my = 0;
      for (const c of cantos) {
        const p = c.applyMatrix4(inv);
        mx = Math.max(mx, Math.abs(p.x));
        my = Math.max(my, Math.abs(p.y));
      }
      const aspecto = this._aspecto();
      this._ajustarOrtho(Math.max(my, mx / aspecto) * (1 + (padding - 1) / 3));
    } else {
      const fov = THREE.MathUtils.degToRad(this.perspCamera.fov);
      const distance = (radius * padding) / Math.sin(fov / 2);
      this.perspCamera.position.copy(center).addScaledVector(dir, distance);
      this.perspCamera.near = Math.max(distance / 1000, 0.01);
      this.perspCamera.far = distance * 100;
      this.perspCamera.updateProjectionMatrix();
    }
    this.controls.target.copy(center);
    this.controls.update();
  }

  _aspecto() {
    const { clientWidth: w, clientHeight: h } = this.container;
    return w && h ? w / h : 1;
  }

  _meiaAlturaOrtho() {
    return (this.orthoCamera.top - this.orthoCamera.bottom) / 2;
  }

  _ajustarOrtho(meiaAltura) {
    const a = this._aspecto();
    this.orthoCamera.top = meiaAltura;
    this.orthoCamera.bottom = -meiaAltura;
    this.orthoCamera.left = -meiaAltura * a;
    this.orthoCamera.right = meiaAltura * a;
    this.orthoCamera.updateProjectionMatrix();
  }

  _direcaoAtual() {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  // ---- Axonometria: projeção, vistas, níveis, corte, explosão e estilo ----

  setProjecao(tipo) {
    if (tipo === this.projecao) return;
    const alvo = this.controls.target.clone();
    const dir = this._direcaoAtual();
    const dist = this.camera.position.distanceTo(alvo);
    if (tipo === 'ortografica') {
      // Mantém o mesmo enquadramento: altura visível na distância do alvo
      const meia = dist * Math.tan(THREE.MathUtils.degToRad(this.perspCamera.fov / 2)) / (this.perspCamera.zoom || 1);
      this.orthoCamera.position.copy(alvo).addScaledVector(dir, Math.max(dist, 50));
      this.orthoCamera.near = 0.01;
      this.orthoCamera.far = Math.max(dist, 50) * 10;
      this.orthoCamera.zoom = 1;
      this._ajustarOrtho(meia);
      this.camera = this.orthoCamera;
    } else {
      const meia = this._meiaAlturaOrtho() / this.orthoCamera.zoom;
      const d = meia / Math.tan(THREE.MathUtils.degToRad(this.perspCamera.fov / 2));
      this.perspCamera.position.copy(alvo).addScaledVector(dir, d);
      this.perspCamera.near = Math.max(d / 1000, 0.01);
      this.perspCamera.far = d * 100;
      this.perspCamera.updateProjectionMatrix();
      this.camera = this.perspCamera;
    }
    this.projecao = tipo;
    this.camera.layers.mask = 1; // só a camada 0
    this.controls.object = this.camera;
    this.controls.update();
  }

  setVista(chave) {
    const vista = VISTAS[chave];
    if (!vista) return;
    if (vista.axonometrica) this.setProjecao('ortografica');
    const box = this._caixaEnquadramento();
    if (box.isEmpty()) return;
    this._fitBox(box, 1.15, new THREE.Vector3(...vista.dir));
  }

  travarRotacao(travar) {
    this.controls.enableRotate = !travar;
  }

  // Agrupa os IfcBuildingStorey por cota (o Revit costuma repetir níveis na mesma cota)
  _calcularNiveis() {
    this.nivelDe.clear();
    if (!this.tree) return [];
    const un = lerUnidades(this.api, this.modelID);
    const pavimentos = [];
    const percorrer = (no, pav) => {
      const tipo = String(no.type || '').toUpperCase();
      let atual = pav;
      if (tipo === 'IFCBUILDINGSTOREY') {
        atual = { id: no.expressID, nome: no.name || `#${no.expressID}`, ids: [] };
        atual.cota = this._cotaPavimento(no.expressID, un.L);
        pavimentos.push(atual);
      }
      if (atual && this.meshesById.has(no.expressID)) atual.ids.push(no.expressID);
      (no.children || []).forEach((c) => percorrer(c, atual));
    };
    percorrer(this.tree, null);
    pavimentos.sort((a, b) => a.cota - b.cota);
    const grupos = [];
    for (const p of pavimentos) {
      const g = grupos[grupos.length - 1];
      if (g && Math.abs(p.cota - g.cota) < 0.1) {
        g.nomes.push(p.nome);
        g.ids.push(...p.ids);
      } else {
        grupos.push({ cota: p.cota, nomes: [p.nome], ids: [...p.ids] });
      }
    }
    const niveis = grupos.filter((g) => g.ids.length > 0).map((g, indice) => ({
      indice,
      cota: g.cota,
      // Cota como está no IFC (sem o deslocamento para a origem), para exibição
      cotaIfc: g.cota - this.translacao[1],
      nome: g.nomes.length > 2 ? `${g.nomes.slice(0, 2).join(' / ')} …` : g.nomes.join(' / '),
      ids: g.ids,
      quantidade: g.ids.length,
    }));
    niveis.forEach((n) => n.ids.forEach((id) => this.nivelDe.set(id, n.indice)));
    // Elementos fora da árvore de pavimentos: nível mais alto abaixo da base do elemento
    for (const [id, meshes] of this.meshesById) {
      if (this.nivelDe.has(id) || !niveis.length) continue;
      const box = new THREE.Box3();
      meshes.forEach((m) => box.expandByObject(m));
      let escolhido = niveis[0];
      for (const n of niveis) if (n.cota <= box.min.y + 0.05) escolhido = n;
      this.nivelDe.set(id, escolhido.indice);
      escolhido.quantidade += 1;
    }
    return niveis;
  }

  // Cota (Y da cena) do pavimento a partir da cadeia de IfcLocalPlacement
  _cotaPavimento(id, L) {
    try {
      const linha = this.api.GetLine(this.modelID, id, true);
      let m = new THREE.Matrix4();
      const cadeia = [];
      let pl = linha.ObjectPlacement;
      while (pl) { cadeia.push(pl); pl = pl.PlacementRelTo; }
      const num = (v) => Number(v?.value ?? v);
      for (const p of cadeia.reverse()) {
        const rp = p.RelativePlacement;
        const o = (rp?.Location?.Coordinates || []).map(num);
        while (o.length < 3) o.push(0);
        const z = rp?.Axis ? rp.Axis.DirectionRatios.map(num) : [0, 0, 1];
        const x = rp?.RefDirection ? rp.RefDirection.DirectionRatios.map(num) : [1, 0, 0];
        while (x.length < 3) x.push(0);
        const vz = new THREE.Vector3(...z).normalize();
        const vx = new THREE.Vector3(...x).normalize();
        const vy = new THREE.Vector3().crossVectors(vz, vx);
        const local = new THREE.Matrix4().makeBasis(vx, vy, vz).setPosition(o[0], o[1], o[2]);
        m = m.multiply(local);
      }
      const zIfc = new THREE.Vector3().setFromMatrixPosition(m).z * L;
      return zIfc + this.translacao[1];
    } catch {
      return 0;
    }
  }

  // nivel: índice em this.niveis ou null para todos; corte: altura acima do nível (m) ou null
  setNivel(nivel, corte = null) {
    this.nivelAtivo = nivel;
    for (const [id, meshes] of this.meshesById) {
      const dentro = nivel == null || this.nivelDe.get(id) === nivel;
      for (const m of meshes) {
        m.layers.set(dentro ? 0 : CAMADA_OCULTA);
        if (m.userData.edges) m.userData.edges.layers.set(dentro ? 0 : CAMADA_OCULTA);
      }
    }
    this.setCorte(nivel == null ? null : corte);
  }

  setCorte(altura) {
    this.alturaCorte = altura;
    this.planosCorte.length = 0;
    const nivel = this.niveis[this.nivelAtivo];
    if (altura != null && nivel) {
      // Remove o que está acima do plano (normal para baixo)
      this.planosCorte.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), nivel.cota + altura));
    }
  }

  // fator 0 = montado; 1 = cada nível afastado uma altura de pavimento do de baixo
  setExplosao(fator) {
    this.explosao = fator;
    const cotas = this.niveis.map((n) => n.cota);
    const alturas = cotas.slice(1).map((c, i) => c - cotas[i]).filter((h) => h > 0.5);
    const passo = Math.max(3, alturas.length ? alturas.reduce((a, b) => a + b, 0) / alturas.length : 3);
    const t = new THREE.Matrix4();
    for (const [id, meshes] of this.meshesById) {
      const indice = this.nivelDe.get(id) ?? 0;
      t.makeTranslation(0, fator * indice * passo, 0);
      for (const m of meshes) {
        m.matrix.copy(m.userData.baseMatrix).premultiply(t);
        m.matrixWorldNeedsUpdate = true;
      }
    }
  }

  // Volta a geometria ao estado original (sem filtro de nível nem explosão), usado antes do levantamento
  restaurarGeometria() {
    if (this.explosao) this.setExplosao(0);
    if (this.nivelAtivo != null) this.setNivel(null);
    this.scene.updateMatrixWorld(true);
  }

  _materialBase(mesh) {
    const base = mesh.userData.baseMaterial;
    if (this.estilo !== 'tecnico' || base === SPACE_MATERIAL) return base;
    return base.transparent ? TECH_GLASS_MATERIAL : TECH_FILL_MATERIAL;
  }

  // 'cores' | 'tecnico' (faces brancas + arestas) | 'cores_arestas'.
  // As arestas são calculadas uma vez por geometria, em blocos, para não travar a tela.
  async setEstilo(estilo, onProgresso) {
    this.estilo = estilo;
    const comArestas = estilo !== 'cores';
    const pendentes = comArestas
      ? this.modelGroup.children.filter((m) => !m.userData.edges && m.userData.baseMaterial !== SPACE_MATERIAL)
      : [];
    for (let i = 0; i < pendentes.length; i++) {
      const m = pendentes[i];
      let geo = this.arestas.get(m.geometry.uuid);
      if (!geo) {
        geo = new THREE.EdgesGeometry(m.geometry, 30);
        this.arestas.set(m.geometry.uuid, geo);
      }
      const linhas = new THREE.LineSegments(geo, EDGE_MATERIAL);
      linhas.layers.mask = m.layers.mask;
      m.add(linhas);
      m.userData.edges = linhas;
      if (i % 300 === 299) {
        onProgresso?.(Math.round(((i + 1) / pendentes.length) * 100));
        await new Promise((r) => setTimeout(r, 0));
        if (this.estilo !== estilo) return; // trocou de estilo no meio
      }
    }
    for (const [id, meshes] of this.meshesById) {
      for (const m of meshes) {
        if (m.userData.edges) m.userData.edges.visible = comArestas;
        if (id !== this.selectedId) m.material = this._materialBase(m);
      }
    }
    this.scene.background = new THREE.Color(estilo === 'cores' ? 0xf1f5f9 : 0xffffff);
    this.grid.visible = estilo === 'cores';
    onProgresso?.(100);
  }

  // Imagem da vista atual em alta resolução (escala sobre o tamanho da tela)
  capturarImagem(escala = 2) {
    const prAnterior = this.renderer.getPixelRatio();
    const gridVisivel = this.grid.visible;
    this.grid.visible = false;
    this.renderer.setPixelRatio(prAnterior * escala);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');
    const largura = this.renderer.domElement.width;
    const altura = this.renderer.domElement.height;
    this.renderer.setPixelRatio(prAnterior);
    this.grid.visible = gridVisivel;
    return { dataUrl, largura, altura };
  }

  // Altura visível (m) na projeção ortográfica, usada para a escala do PDF e o BCF
  alturaVisivelOrtho() {
    return (this.orthoCamera.top - this.orthoCamera.bottom) / this.orthoCamera.zoom;
  }

  estadoVista() {
    return {
      projecao: this.projecao,
      posicao: this.camera.position.toArray(),
      alvo: this.controls.target.toArray(),
      up: this.camera.up.toArray(),
      fov: this.perspCamera.fov,
      meiaAlturaOrtho: this._meiaAlturaOrtho() / this.orthoCamera.zoom,
      nivel: this.nivelAtivo,
      alturaCorte: this.alturaCorte,
      explosao: this.explosao,
      estilo: this.estilo,
      rotacaoTravada: !this.controls.enableRotate,
    };
  }

  async aplicarEstadoVista(e) {
    this.setProjecao(e.projecao);
    this.setNivel(e.nivel, e.alturaCorte);
    this.setExplosao(e.explosao || 0);
    await this.setEstilo(e.estilo || 'cores');
    this.travarRotacao(!!e.rotacaoTravada);
    this.camera.up.fromArray(e.up);
    this.camera.position.fromArray(e.posicao);
    this.controls.target.fromArray(e.alvo);
    if (e.projecao === 'ortografica') {
      this.orthoCamera.zoom = 1;
      this._ajustarOrtho(e.meiaAlturaOrtho);
    }
    this.controls.update();
  }

  // Cena -> coordenadas do IFC (m, Z para cima), desfazendo o deslocamento para a origem
  paraCoordenadasIfc(v) {
    const [tx, ty, tz] = this.translacao;
    return [v.x - tx, -(v.z - tz), v.y - ty];
  }

  // Direção na cena -> direção no IFC
  direcaoParaIfc(v) {
    return [v.x, -v.z, v.y];
  }

  idsVisiveis() {
    const ids = [];
    for (const [id, meshes] of this.meshesById) {
      if (meshes.some((m) => m.visible && m.layers.test(this.camera.layers))) ids.push(id);
    }
    return ids;
  }

  projetoGlobalId() {
    try {
      const ids = this.api.GetLineIDsWithType(this.modelID, IFCPROJECT);
      return ids.size() ? this.api.GetLine(this.modelID, ids.get(0))?.GlobalId?.value || null : null;
    } catch {
      return null;
    }
  }

  globalIdDe(id) {
    if (!this.globalIds.has(id)) {
      let guid = null;
      try { guid = this.api.GetLine(this.modelID, id)?.GlobalId?.value || null; } catch { guid = null; }
      this.globalIds.set(id, guid);
    }
    return this.globalIds.get(id);
  }

  clear() {
    this.select(null);
    this.geometrias.forEach((g) => g.dispose());
    this.geometrias.clear();
    this.arestas.forEach((g) => g.dispose());
    this.arestas.clear();
    this.modelGroup.clear();
    this.meshesById.clear();
    this.typeById.clear();
    this.globalIds.clear();
    this.nivelDe.clear();
    this.niveis = [];
    this.nivelAtivo = null;
    this.explosao = 0;
    this.planosCorte.length = 0;
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
