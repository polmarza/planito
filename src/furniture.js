// Muebles: catálogo, geometría procedural y colocación (con imán a paredes).
//
// Cada mueble se modela en coordenadas locales: origen en el centro de su
// huella, suelo en y = 0, frente hacia +z y espalda hacia −z (contra la pared).
import * as THREE from 'three';
import { floorY, wallInfo } from './build.js';
import { distToSeg } from './rooms.js';

export const CATEGORIES = [
  ['bath', 'Baño'],
  ['kitchen', 'Cocina'],
  ['living', 'Salón y comedor'],
  ['bed', 'Dormitorio'],
  ['other', 'Otros'],
];

export const FURN_COLORS = [
  ['Blanco', '#f2f1ee'],
  ['Crema', '#e8dfcc'],
  ['Roble', '#b58a5c'],
  ['Nogal', '#6f4a2f'],
  ['Gris claro', '#c9c9c6'],
  ['Gris', '#8a8f96'],
  ['Grafito', '#46484c'],
  ['Negro', '#222325'],
  ['Salvia', '#9fb09a'],
  ['Verde', '#4f6b55'],
  ['Azul', '#4d6a8a'],
  ['Terracota', '#b86a4b'],
  ['Mostaza', '#c9a13f'],
  ['Rosa', '#d8a9a0'],
];

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------
const cache = new Map();
function mat(color, rough = 0.7, metal = 0) {
  const k = `${color}|${rough}|${metal}`;
  if (!cache.has(k)) cache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return cache.get(k);
}
const FIX = {
  ceramic: () => mat('#f5f5f3', 0.2),
  steel: () => mat('#b9bdc1', 0.35, 0.6),
  black: () => mat('#1c1d1f', 0.25),
  dark: () => mat('#2c2d30', 0.6),
  mattress: () => mat('#f1eee8', 0.9),
  mirror: () => mat('#dfe7ea', 0.05, 0.9),
  leaf: () => mat('#5f7f4f', 0.8),
  glass: () => {
    const k = 'glass';
    if (!cache.has(k)) {
      cache.set(k, new THREE.MeshPhysicalMaterial({ color: '#cfe3ee', roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    }
    return cache.get(k);
  },
};

/** Ayudantes de modelado: todas las alturas se dan desde la base de la pieza. */
function kit(g) {
  const add = (geo, m, x, y, z) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  return {
    box: (w, h, d, x, y, z, m) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z),
    cyl: (r, h, x, y, z, m, r2 = r, seg = 24) => add(new THREE.CylinderGeometry(r, r2, h, seg), m, x, y + h / 2, z),
    sphere: (r, x, y, z, m) => add(new THREE.SphereGeometry(r, 20, 14), m, x, y, z),
  };
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------
// w = ancho (x), d = fondo (z), h = alto. wall: se pega a la pared.
// layer: piezas de la misma capa no pueden solaparse ('high' = colgadas).
// color / accent: colores editables (cuerpo y detalle) con su nombre.

/** Mueble bajo de cocina: zócalo, cuerpo, puerta, tirador y encimera. */
function kitchenBase(k, w, d, c, a, { door = true } = {}) {
  k.box(w - 0.02, 0.1, d - 0.1, 0, 0, -0.04, FIX.dark());
  k.box(w, 0.76, d - 0.04, 0, 0.1, -0.02, c);
  if (door) {
    k.box(0.004, 0.72, 0.005, 0, 0.12, d / 2 - 0.035, FIX.dark()); // junta entre puertas
    k.box(w - 0.12, 0.012, 0.02, 0, 0.78, d / 2 - 0.03, FIX.steel()); // tirador
  }
  k.box(w, 0.04, d, 0, 0.86, 0, a); // encimera
}

export const CATALOG = {
  // ------------------------------------------------------------------ Baño
  shower: {
    name: 'Ducha', cat: 'bath', w: 0.9, d: 0.9, h: 2.0, wall: true, layer: 'floor',
    color: '#f5f5f3', colorName: 'Plato', accent: '#b9bdc1', accentName: 'Grifería',
    build(k, { w, d }, c, a) {
      k.box(w, 0.05, d, 0, 0, 0, c);
      k.box(0.01, 1.95, d - 0.02, w / 2 - 0.01, 0.05, 0, FIX.glass());
      k.box(w / 2, 1.95, 0.01, w / 4, 0.05, d / 2 - 0.01, FIX.glass());
      k.cyl(0.012, 1.3, 0, 0.8, -d / 2 + 0.05, mat(a, 0.3, 0.6));
      k.box(0.03, 0.03, 0.22, 0, 2.08, -d / 2 + 0.15, mat(a, 0.3, 0.6));
      k.cyl(0.1, 0.02, 0, 2.06, -d / 2 + 0.26, mat(a, 0.3, 0.6));
      k.box(0.12, 0.06, 0.05, 0, 1.05, -d / 2 + 0.03, mat(a, 0.3, 0.6));
    },
  },
  bathtub: {
    name: 'Bañera', cat: 'bath', w: 1.7, d: 0.75, h: 0.55, wall: true, layer: 'floor',
    color: '#f5f5f3', colorName: 'Bañera', accent: '#b9bdc1', accentName: 'Grifería',
    build(k, { w, d, h }, c, a) {
      const t = 0.08;
      k.box(t, h, d, -w / 2 + t / 2, 0, 0, c);
      k.box(t, h, d, w / 2 - t / 2, 0, 0, c);
      k.box(w - 2 * t, h, t, 0, 0, -d / 2 + t / 2, c);
      k.box(w - 2 * t, h, t, 0, 0, d / 2 - t / 2, c);
      k.box(w - 2 * t, 0.25, d - 2 * t, 0, 0, 0, c);
      k.cyl(0.015, 0.2, -w / 2 + 0.25, h, -d / 2 + 0.05, mat(a, 0.3, 0.6));
      k.box(0.03, 0.03, 0.12, -w / 2 + 0.25, h + 0.18, -d / 2 + 0.1, mat(a, 0.3, 0.6));
    },
  },
  sink: {
    name: 'Lavabo con espejo', cat: 'bath', w: 0.8, d: 0.46, h: 0.85, wall: true, layer: 'floor',
    color: '#b58a5c', colorName: 'Mueble', accent: '#f5f5f3', accentName: 'Lavabo',
    build(k, { w, d }, c, a) {
      k.box(w, 0.6, d - 0.02, 0, 0.2, -0.01, c);
      k.box(w - 0.04, 0.004, 0.005, 0, 0.5, d / 2 - 0.015, FIX.dark());
      k.box(w, 0.05, d, 0, 0.8, 0, mat(a, 0.2));
      k.box(w - 0.24, 0.006, d - 0.2, 0, 0.848, 0.03, mat('#d7dcdf', 0.15));
      k.cyl(0.015, 0.16, 0, 0.85, -d / 2 + 0.06, FIX.steel());
      k.box(0.03, 0.02, 0.1, 0, 0.99, -d / 2 + 0.1, FIX.steel());
      k.box(w - 0.1, 0.75, 0.02, 0, 1.15, -d / 2 + 0.01, FIX.mirror());
    },
  },
  toilet: {
    name: 'Inodoro', cat: 'bath', w: 0.38, d: 0.68, h: 0.8, wall: true, layer: 'floor',
    color: '#f5f5f3', colorName: 'Loza', accent: '#f5f5f3', accentName: 'Tapa',
    build(k, { w, d }, c, a) {
      k.box(w, 0.4, 0.17, 0, 0.4, -d / 2 + 0.085, c);
      k.cyl(0.13, 0.38, 0, 0, 0.05, c, 0.11).scale.z = 1.3;
      k.cyl(0.19, 0.04, 0, 0.38, 0.05, mat(a, 0.3)).scale.z = 1.25;
    },
  },
  washer: {
    name: 'Lavadora', cat: 'bath', w: 0.6, d: 0.6, h: 0.85, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Cuerpo', accent: '#46484c', accentName: 'Puerta',
    build(k, { w, d, h }, c, a) {
      k.box(w, h, d - 0.02, 0, 0, -0.01, c);
      const door = k.cyl(0.2, 0.03, 0, 0.35, d / 2, mat(a, 0.3));
      door.rotation.x = Math.PI / 2;
      k.box(w - 0.04, 0.1, 0.01, 0, h - 0.14, d / 2 - 0.015, mat('#dcdcda', 0.4));
    },
  },

  // ------------------------------------------------------------------ Cocina
  kbase: {
    name: 'Módulo bajo', cat: 'kitchen', w: 0.6, d: 0.6, h: 0.9, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Frentes', accent: '#46484c', accentName: 'Encimera',
    build(k, { w, d }, c, a) {
      kitchenBase(k, w, d, c, a);
    },
  },
  kstove: {
    name: 'Módulo con fogones', cat: 'kitchen', w: 0.6, d: 0.6, h: 0.9, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Frentes', accent: '#46484c', accentName: 'Encimera',
    build(k, { w, d }, c, a) {
      kitchenBase(k, w, d, c, a, { door: false });
      k.box(w - 0.06, 0.48, 0.012, 0, 0.18, d / 2 - 0.03, FIX.black()); // horno
      k.box(w - 0.14, 0.012, 0.02, 0, 0.61, d / 2 - 0.015, FIX.steel());
      k.box(0.56, 0.006, 0.5, 0, 0.9, 0, FIX.black()); // placa
      for (const [x, z, r] of [[-0.13, -0.1, 0.08], [0.13, -0.1, 0.06], [-0.13, 0.12, 0.06], [0.13, 0.12, 0.08]]) {
        k.cyl(r, 0.003, x, 0.906, z, mat('#4a4c50', 0.4));
      }
    },
  },
  ksink: {
    name: 'Módulo con fregadero', cat: 'kitchen', w: 0.8, d: 0.6, h: 0.9, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Frentes', accent: '#46484c', accentName: 'Encimera',
    build(k, { w, d }, c, a) {
      kitchenBase(k, w, d, c, a);
      k.box(0.55, 0.006, 0.4, 0, 0.9, 0.02, mat('#8e9398', 0.3, 0.7)); // seno
      k.cyl(0.018, 0.3, 0, 0.9, -d / 2 + 0.07, FIX.steel());
      k.box(0.025, 0.025, 0.2, 0, 1.18, -d / 2 + 0.15, FIX.steel());
    },
  },
  fridge: {
    name: 'Nevera', cat: 'kitchen', w: 0.6, d: 0.65, h: 1.85, wall: true, layer: 'floor',
    color: '#c9ccd0', colorName: 'Cuerpo', accent: '#8e9398', accentName: 'Tiradores',
    build(k, { w, d, h }, c, a) {
      k.box(w, h, d - 0.02, 0, 0, -0.01, mat(c, 0.35, 0.3));
      k.box(w - 0.01, 0.006, 0.005, 0, 1.15, d / 2 - 0.018, FIX.dark());
      k.box(0.02, 0.5, 0.03, w / 2 - 0.06, 1.3, d / 2, mat(a, 0.3, 0.6));
      k.box(0.02, 0.5, 0.03, w / 2 - 0.06, 0.55, d / 2, mat(a, 0.3, 0.6));
    },
  },
  kcolumn: {
    name: 'Columna con horno', cat: 'kitchen', w: 0.6, d: 0.6, h: 2.1, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Frentes', accent: '#1c1d1f', accentName: 'Horno',
    build(k, { w, d, h }, c, a) {
      k.box(w - 0.02, 0.1, d - 0.1, 0, 0, -0.04, FIX.dark());
      k.box(w, h - 0.1, d - 0.04, 0, 0.1, -0.02, c);
      k.box(w - 0.06, 0.58, 0.012, 0, 0.85, d / 2 - 0.02, mat(a, 0.25));
      k.box(w - 0.14, 0.012, 0.02, 0, 1.38, d / 2 - 0.01, FIX.steel());
      k.box(w - 0.12, 0.012, 0.02, 0, 0.75, d / 2 - 0.01, FIX.steel());
    },
  },
  kwall: {
    name: 'Módulo alto', cat: 'kitchen', w: 0.6, d: 0.35, h: 0.7, wall: true, layer: 'high', y: 1.45,
    color: '#f2f1ee', colorName: 'Frentes', accent: '#b9bdc1', accentName: 'Tirador',
    build(k, { w, d, h }, c, a) {
      k.box(w, h, d, 0, 1.45, 0, c);
      k.box(0.004, h - 0.04, 0.005, 0, 1.47, d / 2 + 0.002, FIX.dark());
      k.box(w - 0.12, 0.012, 0.02, 0, 1.49, d / 2 + 0.01, mat(a, 0.3, 0.6));
    },
  },
  hood: {
    name: 'Campana', cat: 'kitchen', w: 0.6, d: 0.5, h: 0.9, wall: true, layer: 'high', y: 1.55,
    color: '#b9bdc1', colorName: 'Campana', accent: '#1c1d1f', accentName: 'Filtro',
    build(k, { w, d }, c, a) {
      k.box(w, 0.1, d, 0, 1.55, 0, mat(c, 0.35, 0.6));
      k.box(w - 0.04, 0.01, d - 0.06, 0, 1.545, 0.01, mat(a, 0.5));
      k.box(0.28, 0.75, 0.24, 0, 1.65, -d / 2 + 0.12, mat(c, 0.35, 0.6));
    },
  },

  // ------------------------------------------------------------------ Salón y comedor
  sofa: {
    name: 'Sofá', cat: 'living', w: 2.1, d: 0.92, h: 0.82, wall: true, layer: 'floor',
    color: '#8a8f96', colorName: 'Tapizado', accent: '#e8dfcc', accentName: 'Cojines',
    build(k, { w, d }, c, a) {
      for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) k.box(0.04, 0.1, 0.04, x, 0, z, FIX.dark());
      k.box(w, 0.25, d, 0, 0.1, 0, c);
      k.box(w - 0.3, 0.45, 0.22, 0, 0.35, -d / 2 + 0.11, c);
      k.box(0.15, 0.3, d, -w / 2 + 0.075, 0.35, 0, c);
      k.box(0.15, 0.3, d, w / 2 - 0.075, 0.35, 0, c);
      const n = w > 1.5 ? 3 : 2;
      const cw = (w - 0.3) / n;
      for (let i = 0; i < n; i++) k.box(cw - 0.02, 0.12, d - 0.26, -w / 2 + 0.15 + cw * (i + 0.5), 0.35, 0.1, c);
      for (let i = 0; i < 2; i++) {
        const p = k.box(0.42, 0.38, 0.12, (i ? 1 : -1) * (w / 2 - 0.45), 0.47, -d / 2 + 0.3, mat(a, 0.9));
        p.rotation.x = -0.25;
      }
    },
  },
  armchair: {
    name: 'Butaca', cat: 'living', w: 0.85, d: 0.85, h: 0.8, wall: false, layer: 'floor',
    color: '#b86a4b', colorName: 'Tapizado', accent: '#6f4a2f', accentName: 'Patas',
    build(k, { w, d }, c, a) {
      for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) k.box(0.04, 0.15, 0.04, x, 0, z, mat(a, 0.6));
      k.box(w, 0.2, d, 0, 0.15, 0, c);
      k.box(w - 0.2, 0.45, 0.18, 0, 0.35, -d / 2 + 0.09, c);
      k.box(0.12, 0.25, d, -w / 2 + 0.06, 0.35, 0, c);
      k.box(0.12, 0.25, d, w / 2 - 0.06, 0.35, 0, c);
      k.box(w - 0.26, 0.1, d - 0.24, 0, 0.35, 0.08, c);
    },
  },
  coffee: {
    name: 'Mesa baja', cat: 'living', w: 1.1, d: 0.6, h: 0.4, wall: false, layer: 'floor',
    color: '#b58a5c', colorName: 'Tablero', accent: '#222325', accentName: 'Patas',
    build(k, { w, d, h }, c, a) {
      k.box(w, 0.04, d, 0, h - 0.04, 0, c);
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.05, d / 2 - 0.05]) k.box(0.035, h - 0.04, 0.035, x, 0, z, mat(a, 0.5));
    },
  },
  dtable: {
    name: 'Mesa de comedor', cat: 'living', w: 1.6, d: 0.9, h: 0.75, wall: false, layer: 'floor',
    color: '#b58a5c', colorName: 'Tablero', accent: '#222325', accentName: 'Patas',
    build(k, { w, d, h }, c, a) {
      k.box(w, 0.04, d, 0, h - 0.04, 0, c);
      for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) for (const z of [-d / 2 + 0.07, d / 2 - 0.07]) k.box(0.05, h - 0.04, 0.05, x, 0, z, mat(a, 0.5));
    },
  },
  rtable: {
    name: 'Mesa redonda', cat: 'living', w: 1.1, d: 1.1, h: 0.75, wall: false, layer: 'floor',
    color: '#f2f1ee', colorName: 'Tablero', accent: '#b58a5c', accentName: 'Pie',
    build(k, { w, h }, c, a) {
      k.cyl(w / 2, 0.035, 0, h - 0.035, 0, c, w / 2, 48);
      k.cyl(0.045, h - 0.035, 0, 0, 0, mat(a, 0.6));
      k.cyl(0.25, 0.03, 0, 0, 0, mat(a, 0.6), 0.28);
    },
  },
  chair: {
    name: 'Silla', cat: 'living', w: 0.45, d: 0.5, h: 0.85, wall: false, layer: 'chair',
    color: '#b58a5c', colorName: 'Asiento', accent: '#222325', accentName: 'Patas',
    build(k, { w, d }, c, a) {
      for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.04, d / 2 - 0.04]) k.box(0.03, 0.44, 0.03, x, 0, z, mat(a, 0.5));
      k.box(w, 0.04, d - 0.04, 0, 0.44, 0.02, c);
      k.box(w, 0.36, 0.03, 0, 0.5, -d / 2 + 0.03, c);
      for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) k.box(0.03, 0.42, 0.03, x, 0.44, -d / 2 + 0.04, mat(a, 0.5));
    },
  },
  tv: {
    name: 'Mueble TV', cat: 'living', w: 1.6, d: 0.42, h: 0.45, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Mueble', accent: '#b58a5c', accentName: 'Frentes',
    build(k, { w, d, h }, c, a) {
      k.box(w, h - 0.08, d, 0, 0.08, 0, c);
      k.box(w - 0.04, h - 0.14, 0.01, 0, 0.11, d / 2, mat(a, 0.6));
      k.box(w - 0.1, 0.08, d - 0.06, 0, 0, 0, FIX.dark());
      k.box(1.25, 0.72, 0.04, 0, h + 0.1, -0.05, FIX.black()); // televisor
      k.box(0.3, 0.1, 0.18, 0, h, -0.05, FIX.dark());
    },
  },
  shelf: {
    name: 'Estantería', cat: 'living', w: 0.9, d: 0.35, h: 1.9, wall: true, layer: 'floor',
    color: '#b58a5c', colorName: 'Madera', accent: '#4d6a8a', accentName: 'Libros',
    build(k, { w, d, h }, c, a) {
      k.box(0.03, h, d, -w / 2 + 0.015, 0, 0, c);
      k.box(0.03, h, d, w / 2 - 0.015, 0, 0, c);
      k.box(w, h, 0.01, 0, 0, -d / 2 + 0.005, c);
      const rows = 5;
      const books = [a, '#c9a13f', '#b86a4b', '#e8dfcc', '#46484c', '#9fb09a'];
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let r = 0; r <= rows; r++) {
        const y = (r * (h - 0.03)) / rows;
        k.box(w - 0.06, 0.03, d - 0.01, 0, y, 0.005, c);
        if (r === rows) break;
        let x = -w / 2 + 0.05;
        while (x < w / 2 - 0.12 && rnd() > 0.08) {
          const bw = 0.025 + rnd() * 0.03;
          const bh = 0.2 + rnd() * 0.12;
          k.box(bw, bh, d - 0.1, x + bw / 2, y + 0.03, 0.02, mat(books[Math.floor(rnd() * books.length)], 0.8));
          x += bw + 0.004;
        }
      }
    },
  },
  lamp: {
    name: 'Lámpara de pie', cat: 'living', w: 0.4, d: 0.4, h: 1.6, wall: false, layer: 'floor',
    color: '#222325', colorName: 'Pie', accent: '#e8dfcc', accentName: 'Pantalla',
    build(k, { h }, c, a) {
      k.cyl(0.15, 0.03, 0, 0, 0, mat(c, 0.4));
      k.cyl(0.012, h - 0.35, 0, 0.03, 0, mat(c, 0.4));
      k.cyl(0.14, 0.3, 0, h - 0.32, 0, mat(a, 0.9), 0.2);
    },
  },

  // ------------------------------------------------------------------ Dormitorio
  bed2: {
    name: 'Cama doble', cat: 'bed', w: 1.66, d: 2.05, h: 1.0, wall: true, layer: 'floor',
    color: '#b58a5c', colorName: 'Estructura', accent: '#9fb09a', accentName: 'Edredón',
    build(k, dims, c, a) {
      bed(k, dims, c, a, 2);
    },
  },
  bed1: {
    name: 'Cama individual', cat: 'bed', w: 0.96, d: 1.95, h: 1.0, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Estructura', accent: '#4d6a8a', accentName: 'Edredón',
    build(k, dims, c, a) {
      bed(k, dims, c, a, 1);
    },
  },
  nightstand: {
    name: 'Mesilla', cat: 'bed', w: 0.45, d: 0.4, h: 0.5, wall: true, layer: 'floor',
    color: '#b58a5c', colorName: 'Madera', accent: '#e8dfcc', accentName: 'Lámpara',
    build(k, { w, d, h }, c, a) {
      k.box(w, h, d, 0, 0, 0, c);
      k.box(w - 0.04, 0.004, 0.005, 0, h - 0.18, d / 2 + 0.002, FIX.dark());
      k.cyl(0.05, 0.2, 0, h, -0.05, FIX.dark(), 0.06);
      k.cyl(0.08, 0.14, 0, h + 0.2, -0.05, mat(a, 0.9), 0.11);
    },
  },
  wardrobe: {
    name: 'Armario', cat: 'bed', w: 1.2, d: 0.6, h: 2.2, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Frentes', accent: '#b9bdc1', accentName: 'Tiradores',
    build(k, { w, d, h }, c, a) {
      k.box(w, h - 0.08, d, 0, 0.08, 0, c);
      k.box(w - 0.02, 0.08, d - 0.06, 0, 0, -0.03, FIX.dark());
      const doors = Math.max(2, Math.round(w / 0.5));
      for (let i = 1; i < doors; i++) k.box(0.004, h - 0.12, 0.005, -w / 2 + (w * i) / doors, 0.1, d / 2 + 0.002, FIX.dark());
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / doors + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.05);
        k.box(0.015, 0.3, 0.025, x, 1.0, d / 2 + 0.012, mat(a, 0.3, 0.6));
      }
    },
  },
  desk: {
    name: 'Escritorio', cat: 'bed', w: 1.2, d: 0.6, h: 0.75, wall: true, layer: 'floor',
    color: '#f2f1ee', colorName: 'Tablero', accent: '#46484c', accentName: 'Patas',
    build(k, { w, d, h }, c, a) {
      k.box(w, 0.03, d, 0, h - 0.03, 0, c);
      for (const x of [-w / 2 + 0.04, w / 2 - 0.04]) {
        k.box(0.04, h - 0.03, 0.04, x, 0, -d / 2 + 0.04, mat(a, 0.5));
        k.box(0.04, h - 0.03, 0.04, x, 0, d / 2 - 0.04, mat(a, 0.5));
      }
      k.box(0.4, 0.14, d - 0.06, w / 2 - 0.24, h - 0.17, 0, c);
    },
  },

  // ------------------------------------------------------------------ Otros
  rug: {
    name: 'Alfombra', cat: 'other', w: 2.0, d: 1.4, h: 0.01, wall: false, layer: 'rug',
    color: '#c9c2b6', colorName: 'Alfombra', accent: '#8a8f96', accentName: 'Borde',
    build(k, { w, d }, c, a) {
      k.box(w, 0.008, d, 0, 0.001, 0, mat(a, 1));
      k.box(w - 0.16, 0.01, d - 0.16, 0, 0.001, 0, mat(c, 1));
    },
  },
  plant: {
    name: 'Planta', cat: 'other', w: 0.45, d: 0.45, h: 1.1, wall: false, layer: 'floor',
    color: '#5f7f4f', colorName: 'Hojas', accent: '#b86a4b', accentName: 'Maceta',
    build(k, _, c, a) {
      k.cyl(0.17, 0.35, 0, 0, 0, mat(a, 0.8), 0.13);
      k.cyl(0.02, 0.35, 0, 0.35, 0, mat('#5b4632', 0.8));
      const leaf = mat(c, 0.8);
      for (const [x, y, z, r] of [[0, 0.85, 0, 0.2], [0.1, 0.72, 0.06, 0.15], [-0.1, 0.78, -0.05, 0.16], [0.02, 1.0, -0.04, 0.13]]) {
        k.sphere(r, x, y, z, leaf);
      }
    },
  },
};

function bed(k, { w, d }, c, a, pillows) {
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) for (const z of [-d / 2 + 0.1, d / 2 - 0.05]) k.box(0.05, 0.12, 0.05, x, 0, z, FIX.dark());
  k.box(w, 0.2, d - 0.06, 0, 0.12, 0.03, c);
  k.box(w, 1.0, 0.07, 0, 0, -d / 2 + 0.035, c); // cabecero
  k.box(w - 0.06, 0.22, d - 0.14, 0, 0.32, 0.05, FIX.mattress());
  k.box(w - 0.02, 0.06, d * 0.64, 0, 0.5, d / 2 - d * 0.32 - 0.02, mat(a, 0.95)); // edredón
  const pw = pillows === 2 ? (w - 0.24) / 2 : w - 0.3;
  for (let i = 0; i < pillows; i++) {
    const x = pillows === 2 ? (i ? 1 : -1) * (pw / 2 + 0.04) : 0;
    k.box(pw, 0.12, 0.36, x, 0.54, -d / 2 + 0.3, FIX.mattress());
  }
}

// ---------------------------------------------------------------------------
// Geometría de un mueble colocado
// ---------------------------------------------------------------------------
export const defOf = (type) => CATALOG[type];

/** Grupo del mueble (sin posicionar si no se pasa `d`). */
export function buildFurniture(d, f) {
  const def = CATALOG[f.type];
  const g = new THREE.Group();
  if (!def) return g;
  def.build(kit(g), def, f.color || def.color, f.accent || def.accent);
  // los colores llegan como hex: las piezas que los usan tal cual reciben aquí su material
  g.traverse((o) => {
    if (o.isMesh && typeof o.material === 'string') o.material = mat(o.material);
  });
  if (d) {
    g.position.set(f.x, floorY(d, f.level, f.x, f.z), f.z);
    g.rotation.y = THREE.MathUtils.degToRad(f.rot || 0);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Colocación
// ---------------------------------------------------------------------------
/** Huella del mueble como rectángulo girado (4 esquinas). */
export function footprint(f) {
  const def = CATALOG[f.type];
  const a = THREE.MathUtils.degToRad(f.rot || 0);
  const c = Math.cos(a);
  const s = Math.sin(a);
  // eje x local → (cos, −sin), eje z local → (sin, cos)
  return [
    [-def.w / 2, -def.d / 2],
    [def.w / 2, -def.d / 2],
    [def.w / 2, def.d / 2],
    [-def.w / 2, def.d / 2],
  ].map(([x, z]) => [f.x + x * c + z * s, f.z - x * s + z * c]);
}

/** ¿Se solapan dos rectángulos girados? (ejes separadores) */
function overlaps(p, q) {
  for (const poly of [p, q]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1;
      const nz = x1 - x2;
      const proj = (pts) => pts.map(([x, z]) => x * nx + z * nz);
      const a = proj(p);
      const b = proj(q);
      const eps = 1e-3 * Math.hypot(nx, nz);
      if (Math.max(...a) <= Math.min(...b) + eps || Math.max(...b) <= Math.min(...a) + eps) return false;
    }
  }
  return true;
}

const collides = (la, lb) => la === lb;

/**
 * Calcula dónde queda un mueble al soltarlo en el punto p.
 * Los muebles de pared se pegan a la pared más cercana mirando a la estancia
 * y se alinean con los muebles vecinos de esa pared.
 */
export function place(d, type, level, p, rot, excludeId = null) {
  const def = CATALOG[type];
  const snap = (v, s = 0.05) => Math.round(v / s) * s;
  let out = { x: snap(p.x), z: snap(p.z), rot: ((rot % 360) + 360) % 360, wall: null };

  if (def.wall) {
    let best = null;
    for (const w of d.walls) {
      if (w.level !== level) continue;
      const dist = distToSeg([p.x, p.z], w.a, w.b);
      if (dist < Math.max(0.9, def.d + 0.3) && (!best || dist < best.dist)) best = { w, dist };
    }
    if (best) {
      const w = best.w;
      const info = wallInfo(d, w);
      const [ux, uz] = info.dir;
      let n = [-uz, ux];
      if ((p.x - w.a[0]) * n[0] + (p.z - w.a[1]) * n[1] < 0) n = [-n[0], -n[1]];
      const shares = (q) =>
        d.walls.some((o) => o !== w && o.level === level && (Math.hypot(o.a[0] - q[0], o.a[1] - q[1]) < 1e-3 || Math.hypot(o.b[0] - q[0], o.b[1] - q[1]) < 1e-3));
      const m0 = def.w / 2 + (shares(w.a) ? 0.1 : 0);
      const m1 = def.w / 2 + (shares(w.b) ? 0.1 : 0);
      let t = snap((p.x - w.a[0]) * ux + (p.z - w.a[1]) * uz);
      if (info.len >= m0 + m1) t = Math.max(m0, Math.min(info.len - m1, t));
      const off = w.thickness / 2 + def.d / 2 + 0.003;
      const r = ((THREE.MathUtils.radToDeg(Math.atan2(n[0], n[1])) % 360) + 360) % 360;
      // alinear con muebles vecinos pegados a la misma pared
      for (const f of d.furniture) {
        if (f.id === excludeId || f.level !== level) continue;
        const fd = CATALOG[f.type];
        if (!fd?.wall || Math.abs(((f.rot - r + 540) % 360) - 180) > 1) continue; // otra orientación
        const ft = (f.x - w.a[0]) * ux + (f.z - w.a[1]) * uz;
        const fo = (f.x - w.a[0]) * n[0] + (f.z - w.a[1]) * n[1];
        if (Math.abs(fo - (w.thickness / 2 + fd.d / 2)) > 0.1) continue; // no está en esta pared
        const touch = (fd.w + def.w) / 2;
        if (Math.abs(Math.abs(t - ft) - touch) < 0.12) t = ft + Math.sign(t - ft || 1) * touch;
      }
      out = { x: w.a[0] + ux * t + n[0] * off, z: w.a[1] + uz * t + n[1] * off, rot: r, wall: w.id };
    }
  }

  const fp = footprint({ type, ...out });
  out.ok = !d.furniture.some(
    (f) => f.id !== excludeId && f.level === level && CATALOG[f.type] && collides(CATALOG[f.type].layer, def.layer) && overlaps(fp, footprint(f)),
  );
  return out;
}

/** Mini icono SVG (planta del mueble) para el catálogo. */
export function catalogIcon(type) {
  const def = CATALOG[type];
  const s = 20 / Math.max(def.w, def.d);
  const w = def.w * s;
  const h = def.d * s;
  return `<svg viewBox="-12 -12 24 24"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="1.5"/>${
    def.wall ? `<line x1="${-w / 2}" y1="${-h / 2}" x2="${w / 2}" y2="${-h / 2}" stroke-width="3"/>` : ''
  }</svg>`;
}
