// Detección de estancias: recintos cerrados por paredes en una planta.
//
// Las paredes forman un grafo plano (ya están cortadas en cada unión). Se
// recorren las caras del grafo girando siempre hacia la izquierda: cada cara
// interior (área positiva) es una estancia. También se anota a qué lado de
// cada pared queda la estancia (útil para pintar por caras).

import { signedArea, pointInLoops } from './poly.js';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const key = (p) => `${r4(p[0])},${r4(p[1])}`;

export function findRooms(d, level) {
  const walls = d.walls.filter((w) => w.level === level);
  const verts = new Map();
  const vert = (p) => {
    const k = key(p);
    if (!verts.has(k)) verts.set(k, { p: [r4(p[0]), r4(p[1])], out: [] });
    return verts.get(k);
  };
  const half = [];
  for (const w of walls) {
    const u = vert(w.a);
    const v = vert(w.b);
    if (u === v) continue;
    const h1 = { from: u, to: v, wall: w, forward: true };
    const h2 = { from: v, to: u, wall: w, forward: false };
    h1.twin = h2;
    h2.twin = h1;
    u.out.push(h1);
    v.out.push(h2);
    half.push(h1, h2);
  }
  for (const v of verts.values()) {
    for (const h of v.out) h.angle = Math.atan2(h.to.p[1] - v.p[1], h.to.p[0] - v.p[0]);
    v.out.sort((a, b) => a.angle - b.angle);
  }

  const visited = new Set();
  const rooms = [];
  for (const h0 of half) {
    if (visited.has(h0)) continue;
    const loop = [];
    let h = h0;
    let guard = 0;
    while (!visited.has(h) && guard++ < 100000) {
      visited.add(h);
      loop.push(h);
      const out = h.to.out;
      const i = out.indexOf(h.twin);
      h = out[(i - 1 + out.length) % out.length];
    }
    const points = loop.map((x) => x.from.p);
    const area = signedArea(points);
    if (area < 0.25) continue; // cara exterior o recinto degenerado
    rooms.push({
      level,
      points,
      area,
      // la estancia queda a la izquierda de cada semiarista: 'L' si coincide con a→b
      walls: loop.map((x) => ({ id: x.wall.id, side: x.forward ? 'L' : 'R' })),
    });
  }

  // numerar de izquierda a derecha y de arriba abajo, con un punto interior para la etiqueta
  for (const r of rooms) r.label = labelPoint(r.points);
  // de izquierda a derecha y de arriba abajo (por franjas de 2 m)
  rooms.sort((a, b) => Math.round(a.label[1] / 2) - Math.round(b.label[1] / 2) || a.label[0] - b.label[0]);
  rooms.forEach((r, i) => {
    r.name = `Estancia ${i + 1}`;
    r.id = `${level}:${i}`;
  });
  return rooms;
}

export function bbox(points) {
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** ¿Es un rectángulo alineado con los ejes? */
export function isRect(points) {
  const b = bbox(points);
  return Math.abs(signedArea(points) - (b.maxX - b.minX) * (b.maxZ - b.minZ)) < 1e-3;
}

/** Punto interior bien centrado (para etiquetas): el más alejado de los bordes en una malla. */
export function labelPoint(points) {
  const b = bbox(points);
  const step = Math.max(0.1, Math.min(b.maxX - b.minX, b.maxZ - b.minZ) / 12);
  let best = null;
  let bestD = -1;
  for (let x = b.minX + step / 2; x < b.maxX; x += step) {
    for (let z = b.minZ + step / 2; z < b.maxZ; z += step) {
      if (!pointInLoops([points], x, z)) continue;
      let dmin = Infinity;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        dmin = Math.min(dmin, distToSeg([x, z], points[j], points[i]));
      }
      if (dmin > bestD) {
        bestD = dmin;
        best = [x, z];
      }
    }
  }
  return best || [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
}

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}
