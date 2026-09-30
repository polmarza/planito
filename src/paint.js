// Pintura de paredes, suelos, techos y tejados.
//  - Paredes: cada tramo guarda un color por cara (w.colors.L / w.colors.R).
//  - Suelo de estancia: una "semilla" (punto) con color y acabado; al construir
//    se pinta la estancia que contiene ese punto, así sigue a la habitación
//    aunque se muevan sus paredes.
//  - Zonas de suelo: rectángulos pintados, guardados como celdas de 0,25 m.
//  - Techo de estancia (semilla) y tejado (color + acabado en el propio tejado).
// La pintura se aplica desde el panel del elemento seleccionado o con el pincel.
import * as THREE from 'three';
import { findRooms } from './rooms.js';
import { pointInLoops } from './poly.js';
import { uid } from './state.js';

export const CELL = 0.25;

export const WALL_COLORS = [
  ['Blanco roto', '#f3f0ea'],
  ['Blanco', '#fafaf8'],
  ['Arena', '#e6dccb'],
  ['Gris cálido', '#cfc8bd'],
  ['Gris perla', '#b9bcc0'],
  ['Salvia', '#b7c4ae'],
  ['Oliva', '#8a8f6a'],
  ['Azul niebla', '#aebfcc'],
  ['Petróleo', '#3f5f6b'],
  ['Terracota', '#c07a5a'],
  ['Ocre', '#d4a852'],
  ['Rosa palo', '#e3c2b8'],
  ['Antracita', '#45474b'],
  ['Negro', '#232426'],
];

export const FLOOR_COLORS = [
  ['Roble', '#b58a5c'],
  ['Nogal', '#7a5234'],
  ['Pino', '#d9b88a'],
  ['Gres claro', '#d8d2c8'],
  ['Gres gris', '#9c9a96'],
  ['Hormigón', '#b3b0aa'],
  ['Barro', '#b8704d'],
  ['Mármol', '#ecebe6'],
  ['Verde agua', '#8fb3ad'],
  ['Azul', '#6d8aa6'],
  ['Antracita', '#4a4a4a'],
  ['Negro', '#2b2b2b'],
];

export const FINISHES = [
  ['plain', 'Liso'],
  ['wood', 'Madera'],
  ['tile', 'Baldosa'],
  ['micro', 'Microcemento'],
];

export const ROOF_COLORS = [
  ['Terracota', '#b4664a'],
  ['Rojo teja', '#9c4a36'],
  ['Barro claro', '#c98a62'],
  ['Pizarra', '#4b5158'],
  ['Antracita', '#34363a'],
  ['Gris', '#8d9095'],
  ['Verde', '#5d6b55'],
  ['Arena', '#cbbfa8'],
  ['Blanco', '#e9e7e2'],
  ['Cobre', '#8f5a3c'],
];

export const ROOF_FINISHES = [
  ['plain', 'Liso'],
  ['tiles', 'Teja'],
  ['metal', 'Chapa'],
  ['slate', 'Pizarra'],
];

// ---------------------------------------------------------------------------
// Texturas procedurales (en escala de grises; el color las tiñe)
// ---------------------------------------------------------------------------
const TEX_METERS = 1.2; // cada textura cubre 1,2 × 1,2 m
const textures = {};

function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function makeTexture(finish) {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const rand = rng(finish.length * 977 + 13);
  const px = N / TEX_METERS; // píxeles por metro
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, N, N);

  if (finish === 'wood') {
    const plankW = 0.15 * px;
    const rows = Math.round(N / plankW);
    for (let r = 0; r < rows; r++) {
      const y = r * plankW;
      const offset = ((r * 0.37) % 1) * N;
      for (let k = -1; k < 2; k++) {
        const x = offset + k * N;
        const v = 205 + Math.floor(rand() * 50);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, N, plankW);
        // veta
        for (let i = 0; i < 14; i++) {
          g.strokeStyle = `rgba(0,0,0,${0.03 + rand() * 0.05})`;
          g.lineWidth = 1 + rand() * 1.5;
          const yy = y + rand() * plankW;
          g.beginPath();
          g.moveTo(x, yy);
          g.bezierCurveTo(x + N * 0.3, yy + (rand() - 0.5) * 6, x + N * 0.6, yy + (rand() - 0.5) * 6, x + N, yy);
          g.stroke();
        }
        // junta de testa
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x, y, 2, plankW);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y, N, 2);
    }
  } else if (finish === 'tile') {
    const t = 0.6 * px;
    for (let i = 0; i < N / t; i++) {
      for (let j = 0; j < N / t; j++) {
        const v = 238 + Math.floor(rand() * 17);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(i * t, j * t, t, t);
      }
    }
    g.fillStyle = 'rgb(170,170,170)';
    for (let i = 0; i <= N / t; i++) {
      g.fillRect(i * t - 1.5, 0, 3, N);
      g.fillRect(0, i * t - 1.5, N, 3);
    }
  } else if (finish === 'tiles') {
    // teja curva: hileras horizontales con piezas desfasadas y sombra en la parte baja
    const rowH = 0.3 * px;
    const tileW = 0.24 * px;
    for (let r = 0; r * rowH < N; r++) {
      const y = r * rowH;
      const off = (r % 2) * (tileW / 2);
      for (let x = -tileW + off; x < N; x += tileW) {
        const grd = g.createLinearGradient(x, 0, x + tileW, 0);
        const v = 215 + Math.floor(rand() * 35);
        grd.addColorStop(0, `rgb(${v - 60},${v - 60},${v - 60})`);
        grd.addColorStop(0.5, `rgb(${v},${v},${v})`);
        grd.addColorStop(1, `rgb(${v - 60},${v - 60},${v - 60})`);
        g.fillStyle = grd;
        g.fillRect(x, y, tileW, rowH);
      }
      const sh = g.createLinearGradient(0, y + rowH * 0.75, 0, y + rowH);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = sh;
      g.fillRect(0, y + rowH * 0.75, N, rowH * 0.25);
    }
  } else if (finish === 'metal') {
    // chapa de junta alzada: nervios cada 0,4 m a lo largo de la pendiente
    const step = 0.4 * px;
    for (let x = 0; x < N; x += step) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, 0, 3, N);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillRect(x + 3, 0, 2, N);
    }
  } else if (finish === 'slate') {
    const rowH = 0.2 * px;
    const w = 0.3 * px;
    for (let r = 0; r * rowH < N; r++) {
      const off = (r % 2) * (w / 2);
      for (let x = -w + off; x < N; x += w) {
        const v = 200 + Math.floor(rand() * 55);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + 1, r * rowH + 1, w - 2, rowH - 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(0, r * rowH + rowH - 3, N, 3);
    }
  } else if (finish === 'micro') {
    for (let i = 0; i < 900; i++) {
      const x = rand() * N;
      const y = rand() * N;
      const r = 8 + rand() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.025 + rand() * 0.04;
      grd.addColorStop(0, rand() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 2})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / TEX_METERS, 1 / TEX_METERS);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const floorMats = new Map();
const ROUGH = { plain: 0.85, wood: 0.6, tile: 0.35, micro: 0.75, tiles: 0.8, metal: 0.45, slate: 0.7 };

const roofMats = new Map();
/** Material de tejado (color + acabado). Los faldones llevan UV en metros. */
export function roofMaterial(color, finish = 'plain') {
  const k = `${color}|${finish}`;
  if (!roofMats.has(k)) {
    if (finish !== 'plain' && !textures[finish]) textures[finish] = makeTexture(finish);
    roofMats.set(
      k,
      new THREE.MeshStandardMaterial({
        color,
        map: finish === 'plain' ? null : textures[finish],
        roughness: ROUGH[finish] ?? 0.8,
        metalness: finish === 'metal' ? 0.3 : 0,
      }),
    );
  }
  return roofMats.get(k);
}

const ceilingMats = new Map();
export function ceilingMaterial(color) {
  if (!ceilingMats.has(color)) ceilingMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
  return ceilingMats.get(color);
}

/** Material de suelo pintado (compartido por color + acabado). */
export function floorMaterial(color, finish = 'plain') {
  const k = `${color}|${finish}`;
  if (!floorMats.has(k)) {
    if (finish !== 'plain' && !textures[finish]) textures[finish] = makeTexture(finish);
    floorMats.set(
      k,
      new THREE.MeshStandardMaterial({
        color,
        map: finish === 'plain' ? null : textures[finish],
        roughness: ROUGH[finish] ?? 0.85,
      }),
    );
  }
  return floorMats.get(k);
}

/** Muestra de acabado para el panel (dataURL). */
export function finishSwatch(finish, color) {
  if (finish === 'plain') return null;
  if (!textures[finish]) textures[finish] = makeTexture(finish);
  const src = textures[finish].image;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, 256, 256, 0, 0, 64, 64);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  return c.toDataURL();
}

// ---------------------------------------------------------------------------
// Qué se pinta bajo el ratón y cómo se aplica
// ---------------------------------------------------------------------------
export const cellKey = (level, x, z) => `${level}:${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;

/** Celdas que cubre un rectángulo (con los bordes redondeados a la celda). */
export function rectCells(level, r) {
  const keys = [];
  const i0 = Math.round(r.minX / CELL);
  const i1 = Math.round(r.maxX / CELL);
  const j0 = Math.round(r.minZ / CELL);
  const j1 = Math.round(r.maxZ / CELL);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) keys.push(`${level}:${i}:${j}`);
  return keys;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------
/** Caras exteriores: las que no dan a ninguna estancia. */
export function facadeFaces(d) {
  const faces = [];
  const levels = [...new Set(d.walls.map((w) => w.level))];
  for (const L of levels) {
    const inside = new Set();
    for (const r of findRooms(d, L)) for (const f of r.walls) inside.add(`${f.id}|${f.side}`);
    for (const w of d.walls) {
      if (w.level !== L || w.style === 'slats') continue;
      for (const side of ['L', 'R']) if (!inside.has(`${w.id}|${side}`)) faces.push({ id: w.id, side });
    }
  }
  return faces;
}

/** Estancia a la que da una cara de pared (o null si es exterior). */
export function roomOfFace(d, wallId, side) {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return null;
  return findRooms(d, w.level).find((r) => r.walls.some((f) => f.id === wallId && f.side === side)) || null;
}

/** Estancia que contiene un punto de una planta. */
export function roomAt(d, level, x, z) {
  return findRooms(d, level).find((r) => pointInLoops([r.points], x, z)) || null;
}

/** Cara de pared bajo el ratón: { id, side } según el lado del muro que se toca. */
export function faceFromHit(hit) {
  const local = hit.object.worldToLocal(hit.point.clone());
  return { id: hit.id, side: local.z >= 0 ? 'L' : 'R' };
}

// ---------------------------------------------------------------------------
// Aplicar pintura
// ---------------------------------------------------------------------------
/**
 * target:
 *  { kind: 'faces', faces: [{id, side}] }       caras de pared
 *  { kind: 'floor', level, x, z, room }          suelo de la estancia entera
 *  { kind: 'cells', cells: [...] }               zona de suelo
 *  { kind: 'ceiling', level, x, z, room }        techo de la estancia
 *  { kind: 'roof', id }                          tejado
 * paint = { color, finish?, erase? }
 */
export function applyPaint(d, target, paint) {
  if (target.kind === 'faces') {
    for (const f of target.faces) {
      const w = d.walls.find((x) => x.id === f.id);
      if (!w) continue;
      const colors = { ...(w.colors || {}) };
      if (paint.erase) delete colors[f.side];
      else colors[f.side] = paint.color;
      w.colors = colors;
    }
  }
  if (target.kind === 'roof') {
    const r = d.roofs.find((x) => x.id === target.id);
    if (r) {
      if (paint.erase) {
        delete r.color;
        delete r.finish;
      } else {
        r.color = paint.color;
        r.finish = paint.finish || r.finish || 'plain';
      }
    }
  }
  const inRoom = (s) => s.level === target.level && pointInLoops([target.room.points], s.x, s.z);
  if (target.kind === 'ceiling') {
    d.ceilingPaint = d.ceilingPaint.filter((s) => !inRoom(s));
    if (!paint.erase) d.ceilingPaint.push({ id: uid(), level: target.level, x: target.x, z: target.z, color: paint.color });
  }
  if (target.kind === 'floor') {
    d.floorPaint = d.floorPaint.filter((s) => !inRoom(s));
    if (!paint.erase) {
      d.floorPaint.push({ id: uid(), level: target.level, x: target.x, z: target.z, color: paint.color, finish: paint.finish || 'plain' });
    }
    if (paint.clearZones) {
      // "pintar todo" también quita las zonas pintadas dentro de la estancia
      for (const k of Object.keys(d.floorCells)) {
        const [l, i, j] = k.split(':').map(Number);
        if (l === target.level && pointInLoops([target.room.points], (i + 0.5) * CELL, (j + 0.5) * CELL)) delete d.floorCells[k];
      }
    }
  }
  if (target.kind === 'cells') {
    for (const k of target.cells) {
      if (paint.erase) delete d.floorCells[k];
      else d.floorCells[k] = { color: paint.color, finish: paint.finish || 'plain' };
    }
  }
}

// ---------------------------------------------------------------------------
// Pincel (como en Los Sims): el cursor pinta lo que se toca
//  - 'wall': clic en cualquier cara de pared; Shift+clic, todas las de la estancia
//  - 'zone': arrastrar un rectángulo sobre el suelo
// ---------------------------------------------------------------------------
const BRUSH_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M20 3l5 5-9.5 9.5-5-5z' fill='%23fff' stroke='%23222' stroke-width='1.5' stroke-linejoin='round'/%3E%3Cpath d='M10.5 12.5l5 5c-1 3-4 5.5-8.5 6.5L3 25l1-4c1-4.5 3.5-7.5 6.5-8.5z' fill='%232f6fed' stroke='%23222' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E\") 3 25, crosshair";

export class PaintController {
  constructor(app) {
    this.app = app;
    this.state = { mode: 'wall', wallColor: '#e6dccb', floorColor: '#b58a5c', finish: 'wood', erase: false };
    this.hoverKey = null;
    this.rect = null; // zona en curso { start, end }
    this.ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#2f6fed', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.ghost.renderOrder = 6;
    this.ghost.visible = false;
    app.scene.add(this.ghost);
  }

  static cursor = BRUSH_CURSOR;

  get paint() {
    const s = this.state;
    return s.mode === 'zone' ? { color: s.floorColor, finish: s.finish, erase: s.erase } : { color: s.wallColor, erase: s.erase };
  }

  /** Cara (o estancia con Shift) bajo el ratón. */
  wallTarget(e) {
    const d = this.app.store.data;
    const hit = this.app.pickKind(e, ['wall'], (ud) => ud.level <= this.app.view.level);
    if (!hit) return null;
    const w = d.walls.find((x) => x.id === hit.id);
    if (!w || w.style === 'slats') return null;
    const face = faceFromHit(hit);
    if (e.shiftKey) {
      const room = roomOfFace(d, face.id, face.side);
      if (room) return { kind: 'faces', faces: room.walls, key: `r${room.id}` };
      return { kind: 'faces', faces: facadeFaces(d), key: 'facade' };
    }
    return { kind: 'faces', faces: [face], key: `f${face.id}${face.side}` };
  }

  snapped(e) {
    const p = this.app.pickPlane(e);
    if (!p) return null;
    const s = Math.max(CELL, this.app.view.snap);
    return { x: Math.round(p.x / s) * s, z: Math.round(p.z / s) * s };
  }

  zoneRect() {
    const { start, end } = this.rect;
    return { minX: Math.min(start.x, end.x), maxX: Math.max(start.x, end.x), minZ: Math.min(start.z, end.z), maxZ: Math.max(start.z, end.z) };
  }

  onMove(e) {
    if (this.state.mode === 'zone') {
      const p = this.snapped(e);
      if (!p) return;
      if (!this.rect) {
        this.ghost.visible = false;
        return this.app.setMeasure(e, 'Arrastra para pintar una zona');
      }
      this.rect.end = p;
      const r = this.zoneRect();
      const w = r.maxX - r.minX;
      const h = r.maxZ - r.minZ;
      this.ghost.visible = w > 0 && h > 0;
      this.ghost.scale.set(w || 1, 1, h || 1);
      this.ghost.position.set((r.minX + r.maxX) / 2, this.app.planeY(r.minX + w / 2, r.minZ + h / 2) + 0.03, (r.minZ + r.maxZ) / 2);
      this.ghost.material.color.set(this.state.erase ? '#d9463b' : this.state.floorColor);
      this.app.setMeasure(e, `${w.toFixed(2).replace('.', ',')} × ${h.toFixed(2).replace('.', ',')} m`);
      return;
    }
    const t = this.wallTarget(e);
    const key = t ? t.key + (this.state.erase ? 'x' : '') : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.app.previewPaint(t ? (d) => applyPaint(d, t, this.paint) : null);
    this.app.setMeasure(e, t ? (e.shiftKey ? 'toda la estancia' : null) : null);
  }

  onDown(e) {
    if (this.state.mode === 'zone') {
      const p = this.snapped(e);
      if (p) this.rect = { start: p, end: p };
      return;
    }
    const t = this.wallTarget(e);
    if (!t) return;
    this.app.previewPaint(null);
    this.app.store.commit((d) => applyPaint(d, t, this.paint));
    this.hoverKey = null;
  }

  onUp() {
    if (this.state.mode !== 'zone' || !this.rect) return;
    const r = this.zoneRect();
    this.rect = null;
    this.ghost.visible = false;
    if (r.maxX - r.minX < CELL || r.maxZ - r.minZ < CELL) return;
    const cells = rectCells(this.app.view.level, r);
    this.app.store.commit((d) => applyPaint(d, { kind: 'cells', cells }, this.paint));
  }

  reset() {
    this.ghost.visible = false;
    this.rect = null;
    if (this.hoverKey) {
      this.hoverKey = null;
      this.app.previewPaint(null);
    }
  }
}
