// Miniaturas del catálogo: cada pieza (pared, ventana, sofá...) se renderiza con el
// mismo motor 3D en un lienzo pequeño, una sola vez, y se guarda como imagen.
import * as THREE from 'three';
import { emptyProject } from './state.js';
import { buildWall, buildRoof, buildStairs, buildRailing, buildSlab, buildSkylight, buildFoundation } from './build.js';
import { buildFurniture } from './furniture.js';

const W = 128;
const H = 96;
let renderer = null;
let scene = null;
let camera = null;
const cache = new Map();

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9b1a3', 1.4));
  const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(28, W / H, 0.01, 200);
}

/** Proyecto mínimo para construir piezas sueltas (sin base, planta de 2,8 m). */
function mini() {
  const d = emptyProject();
  d.settings.baseHeight = 0;
  d.settings.levelHeight = 2.8;
  return d;
}

/** Renderiza un objeto 3D encuadrado en vista isométrica y devuelve un dataURL. */
function snap(obj, dir = [1, 0.75, 1.5], zoom = 0.82) {
  if (!renderer) setup();
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const v = new THREE.Vector3(...dir).normalize();
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * zoom;
  camera.position.copy(center).addScaledVector(v, dist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  obj.traverse((o) => o.geometry?.dispose());
  return url;
}

/** Miniatura cacheada por clave; `make()` devuelve el objeto a fotografiar. */
export function thumb(key, make, dir, zoom) {
  if (!cache.has(key)) {
    try {
      cache.set(key, snap(make(), dir, zoom));
    } catch (err) {
      console.warn('miniatura', key, err);
      cache.set(key, '');
    }
  }
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// Piezas de obra
// ---------------------------------------------------------------------------
export const thumbs = {
  wall: (props) => {
    const d = mini();
    const w = { id: 'w', level: 0, a: [0, 0], b: [2.4, 0], thickness: 0.2, ...props };
    d.walls.push(w);
    return buildWall(d, w);
  },
  opening: (o) => {
    const d = mini();
    const len = Math.max(1.6, o.width + 0.8);
    const w = { id: 'w', level: 0, a: [0, 0], b: [len, 0], thickness: 0.2 };
    d.walls.push(w);
    d.openings.push({ id: 'o', wallId: 'w', pos: len / 2, ...o });
    return buildWall(d, w);
  },
  room: () => {
    const d = mini();
    const pts = [[0, 0], [3, 0], [3, 2.4], [0, 2.4]];
    const g = new THREE.Group();
    pts.forEach((p, i) => d.walls.push({ id: `w${i}`, level: 0, a: p, b: pts[(i + 1) % 4], thickness: 0.2, height: 1.2 }));
    for (const w of d.walls) g.add(buildWall(d, w));
    return g;
  },
  foundation: () => {
    const d = mini();
    d.settings.baseHeight = 0.5;
    return buildFoundation(d, { id: 'f', points: [[0, 0], [3, 0], [3, 2.2], [0, 2.2]], holes: [] });
  },
  slab: () => {
    const d = mini();
    return buildSlab(d, { id: 's', level: 1, x0: 0, z0: 0, x1: 3, z1: 2.2 });
  },
  roof: (pitch) => {
    const d = mini();
    return buildRoof(d, { id: 'r', level: 0, x0: 0, z0: 0, x1: 3.2, z1: 2.4, pitch, overhang: 0.3, ridge: 'x' });
  },
  stairs: (props) => {
    const d = mini();
    return buildStairs(d, { id: 's', level: 0, x: 0, z: 0, rot: 0, width: 1, length: 3.2, ...props }, false);
  },
  railing: (style) => {
    const d = mini();
    return buildRailing(d, { id: 'r', level: 0, a: [0, 0], b: [2.4, 0], height: 1, style });
  },
  skylight: (w, dd) => {
    const d = mini();
    const slab = { id: 's', level: 1, x0: -1.4, z0: -1.4, x1: 1.4, z1: 1.4 };
    d.slabs.push(slab);
    const k = { id: 'k', slabId: 's', x: 0, z: 0, w, d: dd };
    d.skylights.push(k);
    const g = new THREE.Group();
    g.add(buildSlab(d, slab), buildSkylight(d, k));
    return g;
  },
  furniture: (type) => buildFurniture(null, { type }),
};
