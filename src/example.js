import { emptyProject, uid } from './state.js';
import { fixWalls } from './ops.js';
import { roomAt } from './paint.js';
import { place } from './furniture.js';

// Casa de ejemplo que se carga la primera vez: dos plantas, terraza con
// claraboya, escalera y tejado a dos aguas, ya pintada y amueblada.
export function exampleProject() {
  const d = emptyProject();
  const t = d.settings.wallThickness;

  d.settings.lotW = 30;
  d.settings.lotD = 30;
  d.foundations.push({
    id: uid(),
    points: [
      [-0.5, -0.5],
      [10.5, -0.5],
      [10.5, 8.5],
      [-0.5, 8.5],
    ],
    holes: [],
  });

  const room = (level, x0, z0, x1, z1) => {
    const pts = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    return pts.map((p, i) => {
      const w = { id: uid(), level, a: [...p], b: [...pts[(i + 1) % 4]], thickness: t };
      d.walls.push(w);
      return w;
    });
  };
  const hole = (wall, kind, pos, width, height, sill) =>
    d.openings.push({ id: uid(), wallId: wall.id, kind, pos, width, height, sill });

  // Planta 0
  const [back, right, front, left] = room(0, 0, 0, 10, 8);
  const inner = { id: uid(), level: 0, a: [6, 0], b: [6, 8], thickness: 0.15 };
  d.walls.push(inner);
  hole(front, 'door', 7, 1.0, 2.2, 0);
  hole(front, 'window', 2, 1.2, 1.2, 0.9);
  hole(back, 'window', 8, 1.2, 1.2, 0.9);
  hole(right, 'window', 4, 2.0, 2.2, 0);
  hole(left, 'window', 4, 1.2, 1.2, 0.9);
  hole(inner, 'door', 5, 0.9, 2.1, 0);
  d.stairs.push({ id: uid(), level: 0, x: 3, z: 1, rot: 0, width: 1, length: 4 });

  // Planta 1: forjado completo; la parte derecha queda como terraza
  const slab = { id: uid(), level: 1, x0: -0.1, z0: -0.1, x1: 10.1, z1: 8.1 };
  d.slabs.push(slab);
  d.skylights.push({ id: uid(), slabId: slab.id, x: 8, z: 4, w: 1.5, d: 1.5 });
  const [b1, r1, f1, l1] = room(1, 0, 0, 6, 8);
  hole(r1, 'window', 4, 2.0, 2.2, 0);
  hole(b1, 'window', 3, 1.2, 1.2, 0.9);
  hole(f1, 'window', 3, 1.2, 1.2, 0.9);
  hole(l1, 'window', 4, 1.2, 1.2, 0.9);

  // Tejado sobre la planta 1
  d.roofs.push({ id: uid(), level: 2, x0: 0, z0: 0, x1: 6, z1: 8, pitch: 30, overhang: 0.4, ridge: 'z' });

  // centrar la casa en el solar
  const dx = -5;
  const dz = -4;
  for (const f of d.foundations) for (const p of f.points) (p[0] += dx), (p[1] += dz);
  for (const w of d.walls) {
    w.a = [w.a[0] + dx, w.a[1] + dz];
    w.b = [w.b[0] + dx, w.b[1] + dz];
  }
  for (const r of [...d.slabs, ...d.roofs]) (r.x0 += dx), (r.x1 += dx), (r.z0 += dz), (r.z1 += dz);
  for (const o of [...d.stairs, ...d.skylights]) (o.x += dx), (o.z += dz);
  fixWalls(d); // la pared interior parte en dos las fachadas que toca
  decorate(d);
  return d;
}

/** Pintura y muebles (coordenadas ya centradas en el solar). */
function decorate(d) {
  // --- pintura
  const paintRoom = (level, x, z, wall, floor, finish) => {
    const room = roomAt(d, level, x, z);
    if (!room) return;
    if (wall) {
      for (const f of room.walls) {
        const w = d.walls.find((e) => e.id === f.id);
        w.colors = { ...(w.colors || {}), [f.side]: wall };
      }
    }
    d.floorPaint.push({ id: uid(), level, x, z, color: floor, finish });
  };
  paintRoom(0, -3, 1, null, '#d8d2c8', 'tile'); // cocina-comedor
  paintRoom(0, 3, 0, '#b7c4ae', '#b58a5c', 'wood'); // salón
  paintRoom(1, -2, 1, '#aebfcc', '#d9b88a', 'wood'); // dormitorio
  for (const r of d.roofs) Object.assign(r, { color: '#b4664a', finish: 'tiles' });
  Object.assign(d.stairs[0], { type: 'open', color: '#222325', treadColor: '#b58a5c', holeRail: true });

  // barandilla de la terraza
  const rail = (a, b) => d.railings.push({ id: uid(), level: 1, a, b, height: 1, style: 'glass', color: '#1c1d1f' });
  rail([1, -4], [5, -4]);
  rail([5, -4], [5, 4]);
  rail([5, 4], [1, 4]);

  // --- muebles: los de pared se pegan solos a la pared más cercana
  const put = (type, level, x, z, rot = 0) => {
    const p = place(d, type, level, { x, z }, rot);
    d.furniture.push({ id: uid(), type, level, x: p.x, z: p.z, rot: p.rot });
  };
  // cocina en la pared izquierda
  [['kcolumn', -1.9], ['fridge', -1.3], ['kbase', -0.7], ['ksink', 0], ['kbase', 0.7], ['kstove', 1.3], ['kbase', 1.9]].forEach(([t, z]) => put(t, 0, -4.6, z));
  put('kwall', 0, -4.6, 0.7);
  put('hood', 0, -4.6, 1.3);
  put('kwall', 0, -4.6, 1.9);
  // comedor
  put('dtable', 0, -2, 0.6);
  [[-2.4, 0.05, 0], [-1.6, 0.05, 0], [-2.4, 1.15, 180], [-1.6, 1.15, 180]].forEach(([x, z, r]) => put('chair', 0, x, z, r));
  put('plant', 0, 0.55, 3.5);
  // salón
  put('sofa', 0, 3, -3.5);
  put('rug', 0, 3, -1.8);
  put('coffee', 0, 3, -2.3);
  put('armchair', 0, 4.3, -1.2, 270);
  put('tv', 0, 3, 3.6);
  put('shelf', 0, 1.3, -1.8);
  put('lamp', 0, 1.5, -3.5);
  put('plant', 0, 4.5, 3.5);
  // dormitorio
  put('bed2', 1, -4.4, 1);
  put('nightstand', 1, -4.6, -0.1);
  put('nightstand', 1, -4.6, 2.1);
  put('rug', 1, -2.6, 1, 90);
  put('wardrobe', 1, -0.8, 3.6);
  put('desk', 1, -3.2, 3.6);
  put('chair', 1, -3.2, 3.05, 180);
  put('plant', 1, 0.5, -1.5);
  // terraza
  put('rtable', 1, 3.4, 2.4);
  [[2.55, 2.4, 90], [4.25, 2.4, 270], [3.4, 1.55, 0]].forEach(([x, z, r]) => put('chair', 1, x, z, r));
  put('plant', 1, 4.5, -3.5);
  put('plant', 1, 1.5, -3.5);
}
