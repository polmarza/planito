// Operaciones de edición sobre el modelo (se llaman dentro de store.commit / gestos).
import { unionShapes, loopsOf, bboxOf } from './poly.js';
import { wallInfo, onFoundation } from './build.js';
import { findRooms } from './rooms.js';
import { pointInLoops as inLoops, rectToPoly as rectPoly } from './poly.js';

const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6;

/**
 * Normaliza las bases: las que se solapan o comparten lado se funden en una.
 * `preferId` conserva ese id en la pieza que lo contenga (p. ej. la seleccionada).
 */
export function rebuildFoundations(d, preferId = null) {
  if (!d.foundations.length) return;
  const src = d.foundations;
  const pieces = unionShapes(src.map(loopsOf));
  const used = new Set();
  d.foundations = pieces
    .filter((p) => p.points && p.points.length >= 4)
    .map((p) => {
      const ids = p.sources.map((s) => src[s].id);
      let id = ids.includes(preferId) && !used.has(preferId) ? preferId : ids.find((x) => !used.has(x));
      if (!id) id = Math.random().toString(36).slice(2, 10);
      used.add(id);
      return { id, points: p.points, holes: p.holes };
    });
}

/** Mueve un vértice de un polígono ortogonal arrastrando con él sus dos lados. */
export function moveVertex(points, i, x, z) {
  const n = points.length;
  const [ox, oz] = points[i];
  for (const k of [(i + n - 1) % n, (i + 1) % n]) {
    if (Math.abs(points[k][0] - ox) < 1e-6) points[k][0] = x;
    if (Math.abs(points[k][1] - oz) < 1e-6) points[k][1] = z;
  }
  points[i] = [x, z];
}

/** Desplaza el lado i→i+1 (perpendicular a sí mismo). */
export function moveEdge(points, i, x, z) {
  const n = points.length;
  const a = points[i];
  const b = points[(i + 1) % n];
  if (Math.abs(a[0] - b[0]) < 1e-6) {
    a[0] = x;
    b[0] = x;
  } else {
    a[1] = z;
    b[1] = z;
  }
}

/** Cambia el ancho (eje X) o el largo (eje Z) estirando los vértices del lado máximo. */
export function stretchFoundation(f, axis, size) {
  const k = axis === 'x' ? 0 : 1;
  const b = bboxOf(f.points);
  const min = axis === 'x' ? b.minX : b.minZ;
  const max = axis === 'x' ? b.maxX : b.maxZ;
  const target = min + size;
  for (const loop of loopsOf(f)) {
    for (const p of loop) if (Math.abs(p[k] - max) < 1e-6) p[k] = target;
  }
}

export function translateFoundation(f, dx, dz) {
  for (const loop of loopsOf(f)) for (const p of loop) (p[0] += dx), (p[1] += dz);
}

/** Todos los extremos de pared (de una planta) situados en un punto. */
export function endpointsAt(d, level, pt) {
  const out = [];
  for (const w of d.walls) {
    if (w.level !== level) continue;
    if (same(w.a, pt)) out.push({ id: w.id, end: 'a' });
    if (same(w.b, pt)) out.push({ id: w.id, end: 'b' });
  }
  return out;
}

export function setEndpoints(d, refs, pt) {
  for (const r of refs) {
    const w = d.walls.find((x) => x.id === r.id);
    if (w) w[r.end] = [pt[0], pt[1]];
  }
}

/**
 * Tras editar paredes: las corta en cruces y uniones en T (cada tramo queda
 * como pared independiente), fusiona las superpuestas, quita las de longitud
 * cero y recoloca los huecos que ya no caben.
 */
export function fixWalls(d) {
  normalizeWalls(d);
  const dead = new Set(d.walls.filter((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) < 0.05).map((w) => w.id));
  d.walls = d.walls.filter((w) => !dead.has(w.id));
  d.openings = d.openings.filter((o) => {
    const w = d.walls.find((x) => x.id === o.wallId);
    if (!w) return false;
    const len = wallInfo(d, w).len;
    if (o.width > len - 0.1) return false;
    o.pos = Math.max(o.width / 2 + 0.05, Math.min(len - o.width / 2 - 0.05, o.pos));
    return true;
  });
}

/** Posición en planta del centro de cada hueco de las paredes indicadas. */
export function anchorOpenings(d, wallIds) {
  const ids = new Set(wallIds);
  const out = new Map();
  for (const o of d.openings) {
    if (!ids.has(o.wallId)) continue;
    const w = d.walls.find((x) => x.id === o.wallId);
    const { dir } = wallInfo(d, w);
    out.set(o.id, [w.a[0] + dir[0] * o.pos, w.a[1] + dir[1] * o.pos]);
  }
  return out;
}

/** Tras mover extremos, deja cada hueco donde estaba (proyectado sobre su pared). */
export function reprojectOpenings(d, anchors) {
  for (const o of d.openings) {
    const p = anchors.get(o.id);
    if (!p) continue;
    const w = d.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const { dir } = wallInfo(d, w);
    o.pos = (p[0] - w.a[0]) * dir[0] + (p[1] - w.a[1]) * dir[1];
  }
}

// ---------------------------------------------------------------------------
// Tramos de pared independientes
// ---------------------------------------------------------------------------
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const newId = () => Math.random().toString(36).slice(2, 10);

/** Distancia a lo largo de la pared de un punto situado sobre ella (o null). */
function paramOn(w, p) {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uz = dz / len;
  const t = (p[0] - w.a[0]) * ux + (p[1] - w.a[1]) * uz;
  const off = Math.abs((p[0] - w.a[0]) * uz - (p[1] - w.a[1]) * ux);
  if (off > 1e-3 || t < 0.01 || t > len - 0.01) return null;
  return t;
}

/** Punto de cruce propio (interior a ambas) de dos paredes, o null. */
function crossing(A, B) {
  const [x1, z1] = A.a;
  const [x2, z2] = A.b;
  const [x3, z3] = B.a;
  const [x4, z4] = B.b;
  const den = (x1 - x2) * (z3 - z4) - (z1 - z2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1 - x3) * (z3 - z4) - (z1 - z3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (z1 - z3) - (z1 - z2) * (x1 - x3)) / den;
  if (t <= 1e-4 || t >= 1 - 1e-4 || u <= 1e-4 || u >= 1 - 1e-4) return null;
  return [r4(x1 + t * (x2 - x1)), r4(z1 + t * (z2 - z1))];
}

function splitWall(d, w, points) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const ux = (w.b[0] - w.a[0]) / len;
  const uz = (w.b[1] - w.a[1]) / len;
  const ts = [...new Set(points.map((p) => r4(paramOn(w, p) ?? -1)))].filter((t) => t > 0).sort((a, b) => a - b);
  if (!ts.length) return;
  const cuts = [0, ...ts, len];
  const at = (t) => (t === 0 ? [...w.a] : t === len ? [...w.b] : [r4(w.a[0] + ux * t), r4(w.a[1] + uz * t)]);
  const pieces = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    pieces.push({ ...w, id: i === 0 ? w.id : newId(), a: at(cuts[i]), b: at(cuts[i + 1]), t0: cuts[i], t1: cuts[i + 1] });
  }
  // cada hueco va al tramo que contiene su centro
  for (const o of d.openings) {
    if (o.wallId !== w.id) continue;
    const piece = pieces.find((p) => o.pos >= p.t0 && o.pos <= p.t1) || pieces[0];
    o.wallId = piece.id;
    o.pos -= piece.t0;
  }
  const idx = d.walls.indexOf(w);
  d.walls.splice(idx, 1, ...pieces.map(({ t0, t1, ...p }) => p));
}

export function normalizeWalls(d) {
  // 1) cortar en uniones en T y cruces
  const levels = [...new Set(d.walls.map((w) => w.level))];
  for (const level of levels) {
    const walls = d.walls.filter((w) => w.level === level);
    const cuts = new Map(walls.map((w) => [w, []]));
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const A = walls[i];
        const B = walls[j];
        for (const p of [B.a, B.b]) if (paramOn(A, p) !== null) cuts.get(A).push(p);
        for (const p of [A.a, A.b]) if (paramOn(B, p) !== null) cuts.get(B).push(p);
        const x = crossing(A, B);
        if (x) {
          cuts.get(A).push(x);
          cuts.get(B).push(x);
        }
      }
    }
    for (const [w, pts] of cuts) if (pts.length) splitWall(d, w, pts);
  }

  // 2) fusionar tramos duplicados (misma posición)
  const key = (w) => {
    const p = [w.a.map(r4).join(','), w.b.map(r4).join(',')].sort();
    return `${w.level}|${p[0]}|${p[1]}`;
  };
  const seen = new Map();
  const remove = new Set();
  for (const w of d.walls) {
    const k = key(w);
    const keep = seen.get(k);
    if (!keep) {
      seen.set(k, w);
      continue;
    }
    remove.add(w.id);
    // sus huecos pasan a la pared que se conserva
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const o of d.openings) {
      if (o.wallId !== w.id) continue;
      const cx = w.a[0] + ((w.b[0] - w.a[0]) / len) * o.pos;
      const cz = w.a[1] + ((w.b[1] - w.a[1]) / len) * o.pos;
      o.wallId = keep.id;
      o.pos = Math.hypot(cx - keep.a[0], cz - keep.a[1]);
    }
  }
  d.walls = d.walls.filter((w) => !remove.has(w.id));
}

/** Si un extremo está en mitad de una pared recta (unión en T), devuelve esa recta para deslizarse por ella. */
export function tLine(d, level, pt, excludeId) {
  const others = endpointsAt(d, level, pt).filter((r) => r.id !== excludeId);
  if (others.length !== 2) return null;
  const [w1, w2] = others.map((r) => d.walls.find((w) => w.id === r.id));
  const dir = (w, r) => {
    const q = r.end === 'a' ? w.b : w.a;
    const l = Math.hypot(q[0] - pt[0], q[1] - pt[1]);
    return [(q[0] - pt[0]) / l, (q[1] - pt[1]) / l];
  };
  const d1 = dir(w1, others[0]);
  const d2 = dir(w2, others[1]);
  if (Math.abs(d1[0] + d2[0]) > 1e-3 || Math.abs(d1[1] + d2[1]) > 1e-3) return null; // no son colineales
  return { p: [...pt], u: d1 };
}

/** Proyecta un punto sobre una recta { p, u }. */
export function projectOnLine(line, q) {
  const t = (q[0] - line.p[0]) * line.u[0] + (q[1] - line.p[1]) * line.u[1];
  return [line.p[0] + line.u[0] * t, line.p[1] + line.u[1] * t];
}

// ---------------------------------------------------------------------------
// Rectángulos (suelos y tejados)
// ---------------------------------------------------------------------------
export function setRect(e, b) {
  e.x0 = b.minX;
  e.z0 = b.minZ;
  e.x1 = Math.max(b.maxX, b.minX + 0.5);
  e.z1 = Math.max(b.maxZ, b.minZ + 0.5);
}

// ---------------------------------------------------------------------------
// La base crece sola
// ---------------------------------------------------------------------------
/**
 * Margen habitual de la base alrededor de las paredes exteriores de la planta 0
 * (lo que sobresale la base por fuera de su eje). Se mide antes de editar.
 */
export function foundationMargin(d) {
  let best = null;
  for (const w of d.walls) {
    if (w.level !== 0) continue;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (len < 0.2) continue;
    const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    if (!onFoundation(d, m[0], m[1])) continue;
    const n = [-(w.b[1] - w.a[1]) / len, (w.b[0] - w.a[0]) / len];
    let wallMin = Infinity;
    for (const s of [1, -1]) {
      let t = 0;
      while (t < 1.5 && onFoundation(d, m[0] + s * n[0] * (t + 0.05), m[1] + s * n[1] * (t + 0.05))) t += 0.05;
      wallMin = Math.min(wallMin, t);
    }
    if (wallMin < 1.5) best = best === null ? wallMin : Math.min(best, wallMin);
  }
  return Math.round((best ?? 0.3) / 0.05) * 0.05;
}

/**
 * Amplía las bases para cubrir las estancias de la planta 0 que se apoyan en
 * ellas (con el margen indicado alrededor de sus paredes). Nunca las encoge.
 */
export function growFoundations(d, margin, preferId = null) {
  if (!d.foundations.length) return;
  const rooms = findRooms(d, 0);
  const add = [];
  for (const room of rooms) {
    // ¿la estancia pisa alguna base? (se prueban puntos de su interior)
    const b = room.points.reduce(
      (acc, [x, z]) => ({ minX: Math.min(acc.minX, x), maxX: Math.max(acc.maxX, x), minZ: Math.min(acc.minZ, z), maxZ: Math.max(acc.maxZ, z) }),
      { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
    );
    let on = 0;
    let off = 0;
    const step = Math.max(0.2, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 30);
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
        if (!inLoops([room.points], x, z)) continue;
        if (onFoundation(d, x, z)) on++;
        else off++;
      }
    }
    if (!on) continue; // estancia fuera de la base (un jardín, un muro suelto...)
    const wallsOut = room.walls.some(({ id }) => {
      const w = d.walls.find((x) => x.id === id);
      return !onFoundation(d, (w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2);
    });
    if (!off && !wallsOut) continue;
    add.push([room.points]);
    for (const { id } of room.walls) {
      const w = d.walls.find((x) => x.id === id);
      add.push([
        rectPoly({
          minX: Math.min(w.a[0], w.b[0]) - margin,
          maxX: Math.max(w.a[0], w.b[0]) + margin,
          minZ: Math.min(w.a[1], w.b[1]) - margin,
          maxZ: Math.max(w.a[1], w.b[1]) + margin,
        }),
      ]);
    }
  }
  if (!add.length) return;
  for (const loops of add) d.foundations.push({ id: newId(), points: loops[0], holes: [] });
  rebuildFoundations(d, preferId ?? d.foundations[0].id);
}
