import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInLoops, loopsOf } from './poly.js';
import { findRooms } from './rooms.js';
import { floorMaterial, roofMaterial, ceilingMaterial, CELL } from './paint.js';
import { buildFurniture } from './furniture.js';

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

export const MAT = {
  wall: std('#f3f0ea'),
  wallPaint: std('#ffffff', { vertexColors: true }), // cada cara con su color
  foundation: std('#b9b3a8', { roughness: 0.95 }),
  slab: std('#e4ddd0'),
  roof: std('#b4664a', { roughness: 0.8 }),
  stairs: std('#d9d1c3'),
  frame: std('#34363a', { roughness: 0.5 }),
  door: std('#b38b62', { roughness: 0.7 }),
  garage: std('#d9d7d2', { roughness: 0.45, metalness: 0.15 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: '#b9d6ea',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
};

// ---------------------------------------------------------------------------
// Utilidades geométricas del modelo
// ---------------------------------------------------------------------------
export const rectOf = (r) => ({
  minX: Math.min(r.x0, r.x1),
  maxX: Math.max(r.x0, r.x1),
  minZ: Math.min(r.z0, r.z1),
  maxZ: Math.max(r.z0, r.z1),
});

export const inRect = (r, x, z, m = 0) =>
  x >= r.minX - m && x <= r.maxX + m && z >= r.minZ - m && z <= r.maxZ + m;

const overlap = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

export const elev = (s, level) => s.baseHeight + level * s.levelHeight;

export function onFoundation(d, x, z) {
  return d.foundations.some((f) => pointInLoops(loopsOf(f), x, z));
}

/** Cota del suelo en una planta y punto concretos. */
export function floorY(d, level, x, z) {
  if (level > 0) return elev(d.settings, level);
  return onFoundation(d, x, z) ? d.settings.baseHeight : 0;
}

export function wallInfo(d, w) {
  const [ax, az] = w.a;
  const [bx, bz] = w.b;
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1e-6;
  const bottom = floorY(d, w.level, (ax + bx) / 2, (az + bz) / 2);
  const top = elev(d.settings, w.level + 1);
  const full = Math.max(0.3, top - bottom);
  // w.height: pared de media altura, baja o a medida (si no, llega al techo)
  const height = w.height ? Math.min(w.height, full) : full;
  return {
    len,
    angle: -Math.atan2(dz, dx),
    dir: [dx / len, dz / len],
    bottom,
    height,
    full,
    // llega al techo y es maciza: puede cargar
    bearing: height >= full - 0.01 && (w.style || 'solid') === 'solid',
  };
}

export function stairsRect(st) {
  const along = st.rot % 2 === 0;
  const hx = (along ? st.length : st.width) / 2;
  const hz = (along ? st.width : st.length) / 2;
  return { minX: st.x - hx, maxX: st.x + hx, minZ: st.z - hz, maxZ: st.z + hz };
}

export const skylightRect = (s) => ({
  minX: s.x - s.w / 2,
  maxX: s.x + s.w / 2,
  minZ: s.z - s.d / 2,
  maxZ: s.z + s.d / 2,
});

/** Cota superior de una losa (suelo/techo). */
export function slabTop(d, slab) {
  if (slab.level > 0) return elev(d.settings, slab.level);
  return 0.06; // en planta 0 es un pavimento exterior (terraza, porche...)
}

/** Huecos de una losa: claraboyas propias + escaleras que suben desde la planta de abajo. */
export function slabHoles(d, slab) {
  const r = rectOf(slab);
  const inset = { minX: r.minX + 0.03, maxX: r.maxX - 0.03, minZ: r.minZ + 0.03, maxZ: r.maxZ - 0.03 };
  const raw = [];
  for (const s of d.skylights) if (s.slabId === slab.id) raw.push(skylightRect(s));
  for (const st of d.stairs) if (st.level === slab.level - 1) raw.push(stairsRect(st));

  let holes = raw
    .filter((h) => overlap(h, inset))
    .map((h) => ({
      minX: Math.max(h.minX, inset.minX),
      maxX: Math.min(h.maxX, inset.maxX),
      minZ: Math.max(h.minZ, inset.minZ),
      maxZ: Math.min(h.maxZ, inset.maxZ),
    }))
    .filter((h) => h.maxX - h.minX > 0.05 && h.maxZ - h.minZ > 0.05);

  // Los huecos que se solapan se fusionan (la triangulación no admite solapes).
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const a = holes[i];
        const b = holes[j];
        if (a.minX <= b.maxX + 0.02 && a.maxX >= b.minX - 0.02 && a.minZ <= b.maxZ + 0.02 && a.maxZ >= b.minZ - 0.02) {
          holes[i] = {
            minX: Math.min(a.minX, b.minX),
            maxX: Math.max(a.maxX, b.maxX),
            minZ: Math.min(a.minZ, b.minZ),
            maxZ: Math.max(a.maxZ, b.maxZ),
          };
          holes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return holes;
}

function sharesEndpoint(d, w, p) {
  return d.walls.some(
    (o) =>
      o.id !== w.id &&
      o.level === w.level &&
      (Math.hypot(o.a[0] - p[0], o.a[1] - p[1]) < 1e-3 || Math.hypot(o.b[0] - p[0], o.b[1] - p[1]) < 1e-3),
  );
}

// ---------------------------------------------------------------------------
// Geometrías
// ---------------------------------------------------------------------------
function box(w, h, dpt, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, dpt);
  g.translate(x, y, z);
  return g;
}

function mesh(geo, mat, shadows = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

/**
 * Pared con huecos. Se descompone en bloques: se parte a lo largo en cada borde
 * de hueco y, en cada tramo, se resta verticalmente lo que ocupan los huecos.
 * Así funciona igual para puertas, ventanas o paredes recortadas.
 */
export function wallGeometry(len, H, t, openings, extA = 0, extB = 0) {
  const x0 = -extA;
  const x1 = len + extB;
  const cuts = openings.map((o) => ({
    a: o.pos - o.width / 2,
    b: o.pos + o.width / 2,
    y0: o.sill,
    y1: o.sill + o.height,
  }));
  const xs = new Set([x0, x1]);
  for (const c of cuts) {
    if (c.a > x0 && c.a < x1) xs.add(c.a);
    if (c.b > x0 && c.b < x1) xs.add(c.b);
  }
  const sorted = [...xs].sort((p, q) => p - q);
  const geos = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const xa = sorted[i];
    const xb = sorted[i + 1];
    if (xb - xa < 1e-4) continue;
    const mid = (xa + xb) / 2;
    let solids = [[0, H]];
    for (const c of cuts) {
      if (c.a < mid && mid < c.b) {
        const next = [];
        for (const [s0, s1] of solids) {
          if (c.y1 <= s0 || c.y0 >= s1) next.push([s0, s1]);
          else {
            if (c.y0 > s0) next.push([s0, c.y0]);
            if (c.y1 < s1) next.push([c.y1, s1]);
          }
        }
        solids = next;
      }
    }
    for (const [ya, yb] of solids) {
      if (yb - ya > 1e-4) geos.push(box(xb - xa, yb - ya, t, mid, (ya + yb) / 2, 0));
    }
  }
  if (!geos.length) return null;
  const g = mergeGeometries(geos);
  geos.forEach((x) => x.dispose());
  return g;
}

/** Marco + hoja/cristal de una puerta o ventana, en coordenadas locales de la pared. */
export function openingGroup(o, t, maxH, openAll = false) {
  const g = new THREE.Group();
  const fw = 0.05; // ancho del perfil
  const top = Math.min(o.sill + o.height, maxH);
  const h = top - o.sill;
  const clipped = top < o.sill + o.height - 1e-4;
  const w = o.width;
  if (h <= 0.01) return g;

  if (o.kind === 'door') {
    const fd = t + 0.02;
    g.add(mesh(box(fw, h, fd, -w / 2 + fw / 2, h / 2, 0), MAT.frame));
    g.add(mesh(box(fw, h, fd, w / 2 - fw / 2, h / 2, 0), MAT.frame));
    if (!clipped) g.add(mesh(box(w, fw, fd, 0, h - fw / 2, 0), MAT.frame));
    const lh = clipped ? h : h - fw;
    const lw = w - 2 * fw;
    // la hoja gira sobre las bisagras; el tirador queda en el lado libre
    const swing = o.swing === -1 ? -1 : 1;
    const angle = openAll ? Math.max(o.open || 0, 80) : o.open || 0; // al pasear, las puertas se ven abiertas
    // una hoja (con su lado de bisagra) o dos hojas que abren desde el centro
    const leaves =
      o.leaves === 2
        ? [
            { right: false, w: lw / 2 },
            { right: true, w: lw / 2 },
          ]
        : [{ right: o.hinge === 'right', w: lw }];
    for (const leaf of leaves) {
      const side = leaf.right ? -1 : 1; // hacia dónde se extiende la hoja desde la bisagra
      const pivot = new THREE.Group();
      pivot.position.set(-side * (lw / 2), 0, 0);
      pivot.rotation.y = THREE.MathUtils.degToRad(angle) * swing * (leaf.right ? 1 : -1);
      pivot.add(mesh(box(leaf.w - 0.004, lh, 0.04, (side * leaf.w) / 2, lh / 2, 0), MAT.door));
      if (lh > 1.05) pivot.add(mesh(box(0.12, 0.025, 0.1, side * (leaf.w - 0.12), 1.0, 0), MAT.frame));
      g.add(pivot);
    }
  } else if (o.kind === 'garage') {
    // puerta seccional: paneles horizontales
    const fd = t + 0.02;
    g.add(mesh(box(fw, h, fd, -w / 2 + fw / 2, h / 2, 0), MAT.frame));
    g.add(mesh(box(fw, h, fd, w / 2 - fw / 2, h / 2, 0), MAT.frame));
    if (!clipped) g.add(mesh(box(w, fw, fd, 0, h - fw / 2, 0), MAT.frame));
    const lh = clipped ? h : h - fw;
    const lw = w - 2 * fw;
    g.add(mesh(box(lw, lh, 0.05, 0, lh / 2, 0), MAT.garage));
    const n = Math.max(2, Math.round(o.height / 0.5));
    for (let i = 1; i < n; i++) {
      const y = (o.height - fw) * (i / n);
      if (y < lh) g.add(mesh(box(lw, 0.018, 0.06, 0, y, 0), MAT.frame));
    }
  } else {
    const fd = 0.08;
    g.add(mesh(box(fw, h, fd, -w / 2 + fw / 2, h / 2, 0), MAT.frame));
    g.add(mesh(box(fw, h, fd, w / 2 - fw / 2, h / 2, 0), MAT.frame));
    if (o.sill > 0.01) g.add(mesh(box(w, fw, fd, 0, fw / 2, 0), MAT.frame));
    // vierteaguas exterior
    if (o.sill > 0.01) g.add(mesh(box(w + 0.06, 0.03, t / 2 + 0.05, 0, -0.015, t / 4 + 0.025), MAT.frame));
    if (!clipped) g.add(mesh(box(w, fw, fd, 0, h - fw / 2, 0), MAT.frame));
    if (w >= 1.4) g.add(mesh(box(fw * 0.8, h, fd * 0.8, 0, h / 2, 0), MAT.frame));
    const gh = h - (o.sill > 0.01 ? fw : 0) - (clipped ? 0 : fw);
    const gy = (o.sill > 0.01 ? fw : 0) + gh / 2;
    g.add(mesh(box(w - 2 * fw, gh, 0.012, 0, gy, 0), MAT.glass, false));
  }
  return g;
}

function stairsGeometry(length, width, H) {
  const n = Math.max(3, Math.round(H / 0.18));
  const rise = H / n;
  const tread = length / n;
  const slope = rise / tread;
  const c = 0.28; // grosor de la losa de la escalera
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i < n; i++) {
    shape.lineTo(i * tread, (i + 1) * rise);
    shape.lineTo((i + 1) * tread, (i + 1) * rise);
  }
  shape.lineTo(length, H - c);
  shape.lineTo(Math.min(c / slope, length * 0.5), 0);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.translate(-length / 2, 0, -width / 2);
  return g;
}

const rectLoop = (r) => [
  [r.minX, r.minZ],
  [r.maxX, r.minZ],
  [r.maxX, r.maxZ],
  [r.minX, r.maxZ],
];

/** Forma 2D (en XY, con y = -z) a partir de un contorno y sus huecos. */
function shapeOf(outer, holes = []) {
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  return shape;
}

/** Losa horizontal extruida entre y0 y y0 + thick. */
function extrudeFlat(outer, holes, y0, thick) {
  const g = new THREE.ExtrudeGeometry(shapeOf(outer, holes), { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function slabGeometry(r, holes, y0, thick) {
  return extrudeFlat(rectLoop(r), holes.map(rectLoop), y0, thick);
}

/** Superficie plana de una base (para dibujar la cuadrícula encima). */
export function foundationTopGeometry(f, y) {
  const g = new THREE.ShapeGeometry(shapeOf(f.points, f.holes));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// ---------------------------------------------------------------------------
// Constructores por elemento
// ---------------------------------------------------------------------------
function tag(obj, kind, id, level) {
  obj.userData = { kind, id, level };
  return obj;
}

export const WALL_DEFAULT = '#f3f0ea';

/** Colorea por vértice: cara izquierda (+z local), cara derecha (−z local), resto en blanco roto. */
function paintWallGeometry(geo, colors = {}) {
  const n = geo.attributes.normal;
  const cL = new THREE.Color(colors.L || WALL_DEFAULT);
  const cR = new THREE.Color(colors.R || WALL_DEFAULT);
  const c0 = new THREE.Color(WALL_DEFAULT);
  const arr = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const z = n.getZ(i);
    const c = z > 0.5 ? cL : z < -0.5 ? cR : c0;
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

export const SLAT_DEFAULTS = { slatColor: '#b58a5c', slatWidth: 0.05, slatGap: 0.05, slatDir: 'v' };
const colorMats = new Map();
export function colorMat(color, rough = 0.7) {
  const k = `${color}|${rough}`;
  if (!colorMats.has(k)) colorMats.set(k, std(color, { roughness: rough }));
  return colorMats.get(k);
}

/** Pared de listones (celosía): tiras verticales u horizontales con separación. */
function buildSlats(g, len, H, t, w, extA, extB) {
  const o = { ...SLAT_DEFAULTS, ...w };
  const m = colorMat(o.slatColor, 0.65);
  const depth = Math.min(t, 0.05);
  const x0 = -extA;
  const x1 = len + extB;
  const L = x1 - x0;
  const sw = Math.max(0.01, o.slatWidth);
  const gap = Math.max(0.005, o.slatGap);
  if (o.slatDir === 'h') {
    // listones horizontales entre dos postes
    const post = Math.max(sw, 0.05);
    g.add(mesh(box(post, H, depth, x0 + post / 2, H / 2, 0), m));
    g.add(mesh(box(post, H, depth, x1 - post / 2, H / 2, 0), m));
    const n = Math.max(1, Math.floor((H + gap) / (sw + gap)));
    const step = (H - sw) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) g.add(mesh(box(L - 2 * post, sw, depth * 0.8, (x0 + x1) / 2, sw / 2 + i * step, 0), m));
  } else {
    const n = Math.max(2, Math.floor((L + gap) / (sw + gap)));
    const step = (L - sw) / (n - 1);
    for (let i = 0; i < n; i++) g.add(mesh(box(sw, H, depth, x0 + sw / 2 + i * step, H / 2, 0), m));
  }
}

/**
 * Tramo de barandilla a lo largo de +X (de 0 a len), con la base subiendo de yA a yB
 * (plano = barandilla normal; inclinado = barandilla de escalera). Postes verticales,
 * pasamanos, perfil inferior y paneles de cristal o barrotes.
 */
export function railRun(len, yA, yB, h, style, m) {
  const g = new THREE.Group();
  const y = (x) => yA + ((yB - yA) * x) / len;
  const post = 0.045;
  const spans = Math.max(1, Math.ceil(len / 1.2));
  for (let i = 0; i <= spans; i++) {
    const x = (len * i) / spans;
    g.add(mesh(box(post, h, post, x, y(x) + h / 2, 0), m));
  }
  const slope = Math.atan2(yB - yA, len);
  const hyp = Math.hypot(len, yB - yA);
  const bar = (dy, thick, depth, extra = 0) => {
    const b = mesh(new THREE.BoxGeometry(hyp + extra, thick, depth), m);
    b.position.set(len / 2, (yA + yB) / 2 + dy, 0);
    b.rotation.z = slope;
    g.add(b);
  };
  bar(h - 0.025, 0.05, 0.06, post); // pasamanos
  bar(0.075, 0.035, 0.035); // perfil inferior
  for (let i = 0; i < spans; i++) {
    const a = (len * i) / spans + post / 2;
    const b = (len * (i + 1)) / spans - post / 2;
    if (style === 'bars') {
      const n = Math.max(1, Math.round((b - a) / 0.11));
      for (let k = 1; k < n; k++) {
        const x = a + ((b - a) * k) / n;
        g.add(mesh(box(0.016, h - 0.16, 0.016, x, y(x) + 0.1 + (h - 0.16) / 2, 0), m));
      }
    } else {
      // panel de cristal (paralelogramo si la barandilla es inclinada)
      const sh = new THREE.Shape([
        new THREE.Vector2(a + 0.01, y(a + 0.01) + 0.1),
        new THREE.Vector2(b - 0.01, y(b - 0.01) + 0.1),
        new THREE.Vector2(b - 0.01, y(b - 0.01) + h - 0.06),
        new THREE.Vector2(a + 0.01, y(a + 0.01) + h - 0.06),
      ]);
      g.add(mesh(new THREE.ShapeGeometry(sh), MAT.glass, false));
    }
  }
  return g;
}

/** Barandilla: postes, pasamanos y cristal (o barrotes) con perfiles del color elegido. */
export function buildRailing(d, r) {
  const dx = r.b[0] - r.a[0];
  const dz = r.b[1] - r.a[1];
  const len = Math.hypot(dx, dz) || 1e-6;
  const g = new THREE.Group();
  g.position.set(r.a[0], floorY(d, r.level, (r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2), r.a[1]);
  g.rotation.y = -Math.atan2(dz, dx);
  g.add(railRun(len, 0, 0, r.height || 1.0, r.style, colorMat(r.color || '#1c1d1f', 0.45)));
  return tag(g, 'railing', r.id, r.level);
}

export function buildWall(d, w, cutHeight = null, openDoors = false) {
  const info = wallInfo(d, w);
  const H = cutHeight ? Math.min(cutHeight, info.height) : info.height;
  const t = w.thickness;
  const ops = d.openings.filter((o) => o.wallId === w.id);
  // prolongación en las uniones; 2 mm menos para que el canto quede oculto dentro
  // de la otra pared y no "pelee" con su cara (evita franjas en las esquinas pintadas)
  const extA = sharesEndpoint(d, w, w.a) ? t / 2 - 0.002 : 0;
  const extB = sharesEndpoint(d, w, w.b) ? t / 2 - 0.002 : 0;
  const g = new THREE.Group();
  g.position.set(w.a[0], info.bottom, w.a[1]);
  g.rotation.y = info.angle;
  if (w.style === 'slats') {
    buildSlats(g, info.len, H, t, w, extA, extB);
    return tag(g, 'wall', w.id, w.level);
  }
  const geo = wallGeometry(info.len, H, t, ops, extA, extB);
  if (geo) {
    paintWallGeometry(geo, w.colors);
    g.add(mesh(geo, MAT.wallPaint));
  }
  for (const o of ops) {
    if (o.sill >= H) continue;
    if (H < 0.5) continue; // sin paredes: solo se ve el hueco en el zócalo
    // pared baja o de media altura más baja que la puerta: queda solo el paso libre
    if (info.height < info.full - 0.01 && o.sill + o.height >= info.height - 0.01) continue;
    const og = tag(openingGroup(o, t, H, openDoors), 'opening', o.id, w.level);
    og.position.set(o.pos, o.sill, 0);
    g.add(og);
  }
  return tag(g, 'wall', w.id, w.level);
}

/** Suelos pintados: por estancia (semillas) y a pincel (celdas). */
export function buildFloorPaint(d, visible) {
  const g = new THREE.Group();
  const roomsBy = new Map();
  const rooms = (l) => (roomsBy.has(l) ? roomsBy.get(l) : roomsBy.set(l, findRooms(d, l)).get(l));
  const holesBy = new Map();
  const holes = (l) => {
    if (!holesBy.has(l)) holesBy.set(l, d.slabs.filter((s) => s.level === l).flatMap((s) => slabHoles(d, s)));
    return holesBy.get(l);
  };
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.raycast = () => {};
    g.add(m);
  };

  // estancias
  for (const s of d.floorPaint) {
    if (!visible(s.level)) continue;
    const room = rooms(s.level).find((r) => pointInLoops([r.points], s.x, s.z));
    if (!room) continue;
    const inner = s.level > 0 ? holes(s.level).filter((h) => rectLoop(h).every(([x, z]) => pointInLoops([room.points], x, z))) : [];
    const shape = shapeOf(room.points, inner.map(rectLoop));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, floorY(d, s.level, s.x, s.z) + 0.003, 0);
    add(geo, floorMaterial(s.color, s.finish));
  }

  // celdas a pincel, agrupadas por color y acabado
  const groups = new Map();
  for (const [k, v] of Object.entries(d.floorCells)) {
    const [l, i, j] = k.split(':').map(Number);
    if (!visible(l)) continue;
    const x0 = i * CELL;
    const z0 = j * CELL;
    const cx = x0 + CELL / 2;
    const cz = z0 + CELL / 2;
    if (l > 0) {
      if (!d.slabs.some((s) => s.level === l && inRect(rectOf(s), cx, cz))) continue;
      if (holes(l).some((h) => inRect(h, cx, cz))) continue;
    }
    const gk = `${v.color}|${v.finish}`;
    if (!groups.has(gk)) groups.set(gk, { v, pos: [], uv: [] });
    const G = groups.get(gk);
    const y = floorY(d, l, cx, cz) + 0.005;
    const x1 = x0 + CELL;
    const z1 = z0 + CELL;
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) {
      G.pos.push(x, y, z);
      G.uv.push(x, -z);
    }
  }
  for (const G of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    geo.computeVertexNormals();
    add(geo, floorMaterial(G.v.color, G.v.finish));
  }
  return g;
}

export function buildFoundation(d, f) {
  const h = Math.max(0.02, d.settings.baseHeight);
  const g = new THREE.Group();
  g.add(mesh(extrudeFlat(f.points, f.holes, 0, h), MAT.foundation));
  return tag(g, 'foundation', f.id, 0);
}

export function buildSlab(d, s) {
  const r = rectOf(s);
  const top = slabTop(d, s);
  const thick = Math.min(d.settings.slabThickness, top);
  const g = new THREE.Group();
  g.add(mesh(slabGeometry(r, slabHoles(d, s), top - thick, thick), MAT.slab));
  return tag(g, 'slab', s.id, s.level);
}

export const STAIRS_DEFAULTS = {
  type: 'solid', // 'solid' (maciza) | 'open' (zanca abierta, peldaños volados)
  color: '#d9d1c3', // estructura
  treadColor: '#d9d1c3', // peldaños
  rail: 'right', // 'none' | 'left' | 'right' | 'both' (mirando escalera arriba)
  railStyle: 'glass',
  railColor: '#1c1d1f',
  railHeight: 0.9,
  holeRail: false, // barandilla alrededor del hueco en la planta de arriba
};

/** Tramos de barandilla de una escalera en coordenadas locales (x = subida, z = ancho). */
export function stairsRailSpecs(st) {
  const o = { ...STAIRS_DEFAULTS, ...st };
  const L = st.length;
  const W = st.width;
  const out = [];
  // lados (inclinados): izquierda = −z local, derecha = +z local
  const sides = { left: [-1], right: [1], both: [-1, 1], none: [] }[o.rail] || [];
  for (const s of sides) out.push({ x0: -L / 2 + 0.05, x1: L / 2, z: s * (W / 2 - 0.04), sloped: true });
  if (o.holeRail) {
    // alrededor del hueco, en la planta de arriba: los dos lados largos y el arranque
    for (const s of [-1, 1]) out.push({ x0: -L / 2, x1: L / 2, z: s * (W / 2 + 0.04), upper: true });
    out.push({ x0: -W / 2 - 0.04, x1: W / 2 + 0.04, x: -L / 2 - 0.04, upper: true, across: true });
  }
  return out;
}

/** Local de la escalera → mundo (x, z). */
export function stairsToWorld(st, x, z) {
  const a = (st.rot * Math.PI) / 2;
  return [st.x + x * Math.cos(a) + z * Math.sin(a), st.z - x * Math.sin(a) + z * Math.cos(a)];
}

export function buildStairs(d, st, showUpper = true) {
  const o = { ...STAIRS_DEFAULTS, ...st };
  const bottom = floorY(d, st.level, st.x, st.z);
  const H = elev(d.settings, st.level + 1) - bottom;
  const L = st.length;
  const W = st.width;
  const g = new THREE.Group();
  g.position.set(st.x, bottom, st.z);
  g.rotation.y = (st.rot * Math.PI) / 2;
  const body = colorMat(o.color, 0.8);
  const tread = colorMat(o.treadColor, 0.7);
  const n = Math.max(3, Math.round(H / 0.18));
  const rise = H / n;
  const run = L / n;

  if (o.type === 'open') {
    // zanca abierta: dos zancas inclinadas y peldaños volados, sin tabicas
    const zt = 0.05;
    const zd = 0.28;
    const hyp = Math.hypot(L, H);
    for (const s of [-1, 1]) {
      const z = mesh(new THREE.BoxGeometry(hyp, zd, zt), body);
      z.position.set(0, H / 2 - zd / 2 + 0.04, s * (W / 2 - zt / 2));
      z.rotation.z = Math.atan2(H, L);
      g.add(z);
    }
    for (let i = 0; i < n; i++) {
      g.add(mesh(box(run + 0.03, 0.045, W - 2 * zt, -L / 2 + (i + 0.5) * run, (i + 1) * rise - 0.045, 0), tread));
    }
  } else {
    // maciza: laterales en el color de la estructura, huellas y tabicas en el de los peldaños
    g.add(mesh(stairsGeometry(L, W, H), [body, tread]));
  }

  const rm = colorMat(o.railColor, 0.45);
  for (const r of stairsRailSpecs(st)) {
    if (r.upper && !showUpper) continue;
    const len = r.x1 - r.x0;
    const run = r.sloped ? railRun(len, (H * (r.x0 + L / 2)) / L, H, o.railHeight, o.railStyle, rm) : railRun(len, H, H, 1.0, o.railStyle, rm);
    if (r.across) {
      run.rotation.y = -Math.PI / 2; // a lo ancho (eje z local)
      run.position.set(r.x, 0, r.x0);
    } else {
      run.position.set(r.x0, 0, r.z);
    }
    g.add(run);
  }
  return tag(g, 'stairs', st.id, st.level);
}

export function buildSkylight(d, s) {
  const slab = d.slabs.find((x) => x.id === s.slabId);
  if (!slab) return null;
  const top = slabTop(d, slab);
  const thick = Math.min(d.settings.slabThickness, top);
  const curb = 0.15;
  const fw = 0.06;
  const h = thick + curb;
  const y = top - thick + h / 2;
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);
  g.add(mesh(box(s.w, h, fw, 0, y, -s.d / 2 + fw / 2), MAT.frame));
  g.add(mesh(box(s.w, h, fw, 0, y, s.d / 2 - fw / 2), MAT.frame));
  g.add(mesh(box(fw, h, s.d - 2 * fw, -s.w / 2 + fw / 2, y, 0), MAT.frame));
  g.add(mesh(box(fw, h, s.d - 2 * fw, s.w / 2 - fw / 2, y, 0), MAT.frame));
  g.add(mesh(box(s.w - 0.02, 0.015, s.d - 0.02, 0, top + curb, 0), MAT.glass, false));
  return tag(g, 'skylight', s.id, slab.level);
}

const gableMats = new Map();

/** El hastial toma el color exterior de la pared sobre la que se apoya. */
function gableMaterial(d, r, R, alongX, side) {
  const cx = (R.minX + R.maxX) / 2;
  const cz = (R.minZ + R.maxZ) / 2;
  const line = alongX ? (side > 0 ? R.maxX : R.minX) : side > 0 ? R.maxZ : R.minZ;
  let color = null;
  for (const w of d.walls) {
    if (w.level !== r.level - 1 || !w.colors) continue;
    const k = alongX ? 0 : 1; // coordenada constante a lo largo del hastial
    if (Math.abs(w.a[k] - line) > 0.15 || Math.abs(w.b[k] - line) > 0.15) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const n = [-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len];
    const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    const inward = n[0] * (cx - m[0]) + n[1] * (cz - m[1]) > 0;
    color = w.colors[inward ? 'R' : 'L'] || color;
  }
  if (!color) return MAT.wall;
  if (!gableMats.has(color)) gableMats.set(color, std(color));
  return gableMats.get(color);
}

/** Tejado a dos aguas: dos faldones + dos hastiales (muros triangulares). */
export function buildRoof(d, r) {
  const R = rectOf(r);
  const alongX = r.ridge === 'x';
  const L = alongX ? R.maxX - R.minX : R.maxZ - R.minZ; // largo de la cumbrera
  const W = alongX ? R.maxZ - R.minZ : R.maxX - R.minX; // luz a salvar
  const p = THREE.MathUtils.degToRad(r.pitch);
  const o = r.overhang;
  const t = 0.12;
  const h = (W / 2) * Math.tan(p);
  const g = new THREE.Group();
  g.position.set((R.minX + R.maxX) / 2, elev(d.settings, r.level), (R.minZ + R.maxZ) / 2);
  g.rotation.y = alongX ? 0 : Math.PI / 2;

  // Faldones
  const run = W / 2 + o;
  const k = t * Math.tan(p); // prolongación para cerrar la cumbrera por arriba
  const S = run / Math.cos(p) + k;
  const roofMat = r.color ? roofMaterial(r.color, r.finish || 'plain') : MAT.roof;
  for (const side of [1, -1]) {
    const geo = new THREE.BoxGeometry(L + 2 * o, t, S);
    // UV en metros (la textura de teja/chapa/pizarra se repite a escala real);
    // en el faldón opuesto se invierte para que las tejas "caigan" hacia el alero
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L + 2 * o), uv.getY(i) * S * side);
    const m = mesh(geo, roofMat);
    const n = new THREE.Vector3(0, Math.cos(p), side * Math.sin(p));
    const down = new THREE.Vector3(0, -Math.sin(p), side * Math.cos(p));
    const center = new THREE.Vector3(0, h, 0)
      .addScaledVector(down, run / Math.cos(p) / 2 - k / 2)
      .addScaledVector(n, t / 2);
    m.position.copy(center);
    m.rotation.x = side * p;
    g.add(m);
  }

  // Hastiales
  if (h > 0.02) {
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2, 0);
    tri.lineTo(W / 2, 0);
    tri.lineTo(0, h);
    tri.closePath();
    const wt = d.settings.wallThickness;
    for (const side of [1, -1]) {
      const geo = new THREE.ExtrudeGeometry(tri, { depth: wt, bevelEnabled: false });
      geo.translate(0, 0, -wt / 2);
      geo.rotateY(Math.PI / 2);
      geo.translate((side * L) / 2, 0, 0);
      g.add(mesh(geo, gableMaterial(d, r, R, alongX, side)));
    }
  }
  return tag(g, 'roof', r.id, r.level);
}

// ---------------------------------------------------------------------------
// Escena completa
// ---------------------------------------------------------------------------
/**
 * view = { level, showAll, cutaway }   (cutaway = altura a la que se recortan las paredes, o null)
 *  - Las plantas por encima de la actual se ocultan (salvo showAll).
 *  - cutaway recorta las paredes de la planta actual (1,15 m = bajas; 0,1 m = sin paredes).
 */
export function buildBuilding(d, view) {
  const root = new THREE.Group();
  const visible = (lvl) => view.showAll || lvl <= view.level;

  for (const f of d.foundations) root.add(buildFoundation(d, f));
  for (const s of d.slabs) if (visible(s.level)) root.add(buildSlab(d, s));
  for (const w of d.walls) {
    if (!visible(w.level)) continue;
    const cut = view.cutaway && w.level === view.level ? view.cutaway : null;
    root.add(buildWall(d, w, cut, view.openDoors));
  }
  for (const st of d.stairs) if (visible(st.level)) root.add(buildStairs(d, st, visible(st.level + 1)));
  for (const s of d.skylights) {
    const slab = d.slabs.find((x) => x.id === s.slabId);
    if (slab && visible(slab.level)) {
      const g = buildSkylight(d, s);
      if (g) root.add(g);
    }
  }
  for (const r of d.roofs) if (visible(r.level)) root.add(buildRoof(d, r));
  for (const r of d.railings || []) if (visible(r.level)) root.add(buildRailing(d, r));
  root.add(buildFloorPaint(d, visible));
  root.add(buildCeilings(d));
  for (const f of d.furniture) if (visible(f.level)) root.add(tag(buildFurniture(d, f), 'furniture', f.id, f.level));
  return root;
}

/**
 * Techos pintados: la estancia vista desde abajo, bajo el forjado (o a la altura
 * de coronación de las paredes si encima hay un tejado). Solo tienen cara hacia
 * abajo, así que desde la vista aérea no tapan el interior.
 */
export function buildCeilings(d) {
  const g = new THREE.Group();
  const roomsBy = new Map();
  for (const c of d.ceilingPaint) {
    if (!roomsBy.has(c.level)) roomsBy.set(c.level, findRooms(d, c.level));
    const room = roomsBy.get(c.level).find((r) => pointInLoops([r.points], c.x, c.z));
    if (!room) continue;
    const above = d.slabs.filter((s) => s.level === c.level + 1);
    const slab = above.find((s) => inRect(rectOf(s), c.x, c.z));
    const y = elev(d.settings, c.level + 1) - (slab ? Math.min(d.settings.slabThickness, slabTop(d, slab)) : 0) - 0.004;
    const holes = above
      .flatMap((s) => slabHoles(d, s))
      .filter((h) => rectLoop(h).every(([x, z]) => pointInLoops([room.points], x, z)));
    const shape = new THREE.Shape(room.points.map(([x, z]) => new THREE.Vector2(x, z)));
    for (const h of holes) shape.holes.push(new THREE.Path(rectLoop(h).map(([x, z]) => new THREE.Vector2(x, z))));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // cara hacia abajo
    geo.translate(0, y, 0);
    const m = new THREE.Mesh(geo, ceilingMaterial(c.color));
    m.receiveShadow = true;
    m.raycast = () => {};
    g.add(m);
  }
  return g;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.isMesh || o.isLine) {
      o.geometry?.dispose();
      if (o.userData.ownMaterial) [].concat(o.material).forEach((x) => x.dispose());
    }
  });
}

// ---------------------------------------------------------------------------
// Resaltado (hover / selección / borrar)
// ---------------------------------------------------------------------------
const TINTS = { hover: '#2f6fed', select: '#2f6fed', delete: '#d9463b' };

export function setTint(obj, mode) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const each = (mat, fn) => (Array.isArray(mat) ? mat.map(fn) : fn(mat));
    if (m.userData.origMaterial) {
      each(m.material, (x) => x.dispose());
      m.material = m.userData.origMaterial;
      delete m.userData.origMaterial;
      delete m.userData.ownMaterial;
    }
    if (mode) {
      m.userData.origMaterial = m.material;
      m.material = each(m.material, (x) => {
        const mat = x.clone();
        mat.emissive = new THREE.Color(TINTS[mode]);
        mat.emissiveIntensity = mode === 'select' ? 0.28 : 0.18;
        return mat;
      });
      m.userData.ownMaterial = true;
    }
  });
}
