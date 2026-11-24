// Visualizador 3D das interferências: modelos da análise em transparência (cor por disciplina) e
// os dois elementos da interferência em destaque (vermelho e azul), com a câmera no ponto.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const DISCIPLINE_COLOR = { AR: 0x9ca3af, ES: 0xb45309, EL: 0xeab308, HD: 0x2563eb, IN: 0xdc2626, AC: 0x059669, GS: 0xa16207, TC: 0x7c3aed };
const COLOR_A = 0xef4444;
const COLOR_B = 0x2563eb;

/** Lê o cache de geometria ("SEBGEO1"): cabeçalho + posições + índices. */
export function parseGeometry(buf) {
  const magic = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, 7));
  if (magic !== 'SEBGEO1') throw new Error('Geometria em formato desconhecido.');
  const hl = new DataView(buf).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl)));
  const off = 12 + hl;
  return {
    origem: h.origem,
    elementos: h.elementos,
    positions: new Float32Array(buf, off, h.nPos),
    indices: new Uint32Array(buf, off + h.nPos * 4, h.nIdx),
  };
}

export class ClashViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xf3f4f6);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
    this.camera.position.set(10, 10, 10);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(1, 2, 1.5);
    this.scene.add(sun);
    this.models = [];
    this.highlight = new THREE.Group();
    this.scene.add(this.highlight);
    this.origin = [0, 0, 0];
    this.contextVisible = true;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** models: [{ geo (parseGeometry), disciplina }]; origin: origem da análise (coordenadas de cena). */
  setModels(models, origin) {
    this.origin = origin;
    for (const m of this.models) {
      this.scene.remove(m.mesh);
      m.mesh.geometry.dispose();
      m.mesh.material.dispose();
    }
    this.models = models.map(({ geo, disciplina }) => {
      const o = [0, 1, 2].map((k) => geo.origem[k] - origin[k]);
      const pos = new Float32Array(geo.positions.length);
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] = geo.positions[i] + o[0];
        pos[i + 1] = geo.positions[i + 1] + o[1];
        pos[i + 2] = geo.positions[i + 2] + o[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(geo.indices, 1));
      g.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: DISCIPLINE_COLOR[disciplina] ?? 0x8b5cf6, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat);
      mesh.visible = this.contextVisible;
      this.scene.add(mesh);
      const byId = new Map(geo.elementos.map((e) => [e.id, e]));
      return { mesh, geo, byId, offset: o };
    });
    this.fitAll();
  }

  setContextVisible(v) {
    this.contextVisible = v;
    this.models.forEach((m) => (m.mesh.visible = v));
    this.render();
  }

  fitAll() {
    const box = new THREE.Box3();
    this.models.forEach((m) => {
      m.mesh.geometry.computeBoundingBox();
      box.union(m.mesh.geometry.boundingBox);
    });
    if (box.isEmpty()) return this.render();
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(r * 2.2));
    this.camera.far = r * 20 + 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  /** Malha de um elemento (reaproveita as posições do modelo). */
  elementMesh(mi, id, color, opacity) {
    const m = this.models[mi];
    const el = m?.byId.get(id);
    if (!el) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', m.mesh.geometry.getAttribute('position'));
    g.setAttribute('normal', m.mesh.geometry.getAttribute('normal'));
    g.setIndex(new THREE.BufferAttribute(m.geo.indices.subarray(el.i0, el.i0 + el.in), 1));
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
    // Só as arestas vivas (as facetas de tubos redondos não escurecem o elemento).
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 45), new THREE.LineBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.6 }));
    const grp = new THREE.Group();
    grp.add(mesh, edges);
    grp.userData.box = [el.min.map((v, k) => v - this.origin[k]), el.max.map((v, k) => v - this.origin[k])];
    return grp;
  }

  /** Mostra a interferência: ma/mb = índices dos modelos na análise. */
  focus(clash, ma, mb) {
    for (const c of [...this.highlight.children]) {
      this.highlight.remove(c);
      c.traverse((o) => {
        if (o.material) o.material.dispose();
        if (o.geometry && o.isLineSegments) o.geometry.dispose();
      });
    }
    if (!clash) return this.render();
    // A semitransparente (deixa ver o B quando ele está embutido); B opaco, desenhado por cima.
    const b = this.elementMesh(mb, clash.b.id, COLOR_B, 1);
    const a = this.elementMesh(ma, clash.a.id, COLOR_A, 0.45);
    if (a) a.renderOrder = 2;
    [b, a].forEach((x) => x && this.highlight.add(x));
    const p = new THREE.Vector3(...clash.ponto.map((v, k) => v - this.origin[k]));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0x111827 }));
    marker.position.copy(p);
    this.highlight.add(marker);
    // Enquadra a região do ponto (até ~8 m), não os elementos inteiros (um tubo pode ter 50 m).
    let size = 1.5;
    for (const x of [a, b]) {
      if (!x) continue;
      const [lo, hi] = x.userData.box;
      size = Math.max(size, Math.min(8, Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k])) / 2));
    }
    // Sempre o mesmo ângulo (vista isométrica de cima), para as imagens do relatório ficarem iguais.
    this.controls.target.copy(p);
    this.camera.position.copy(p).add(new THREE.Vector3(1, 0.9, 1.25).normalize().multiplyScalar(size * 2.2));
    this.camera.near = 0.02;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  /** Imagem da vista atual (JPEG), no tamanho indicado. */
  snapshot(width = 640, height = 420) {
    const prev = [this.container.clientWidth, this.container.clientHeight];
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
    const url = this.renderer.domElement.toDataURL('image/jpeg', 0.82);
    this.renderer.setSize(prev[0] || 1, prev[1] || 1);
    this.camera.aspect = (prev[0] || 1) / (prev[1] || 1);
    this.camera.updateProjectionMatrix();
    this.render();
    return url;
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.focus(null);
    this.models.forEach((m) => {
      m.mesh.geometry.dispose();
      m.mesh.material.dispose();
    });
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
