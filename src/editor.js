import * as THREE from 'three';
import { wallInfo, rectOf, slabTop, elev, floorY, skylightRect } from './build.js';
import { bboxOf, rectToPoly } from './poly.js';
import {
  rebuildFoundations,
  moveVertex,
  moveEdge,
  translateFoundation,
  endpointsAt,
  setEndpoints,
  fixWalls,
  anchorOpenings,
  reprojectOpenings,
  tLine,
  projectOnLine,
  setRect,
  foundationMargin,
  growFoundations,
} from './ops.js';
import { fmt } from './tools.js';
import { place } from './furniture.js';

// Edición directa del elemento seleccionado:
//  - Base, suelo y tejado: tiradores en esquinas (cuadrados) y lados (círculos).
//  - Pared: tiradores en los extremos. Las paredes conectadas se estiran con ella.
//  - Arrastrar el propio elemento lo mueve (escaleras, claraboyas, puertas y
//    ventanas también; estas últimas se deslizan a lo largo de su pared).

const outerMat = new THREE.MeshBasicMaterial({ color: '#2f6fed', depthTest: false, transparent: true });
const innerMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.SphereGeometry(0.5, 16, 12);

const DRAGGABLE = ['foundation', 'wall', 'slab', 'roof', 'stairs', 'skylight', 'opening', 'furniture', 'railing'];
const COLLECTION = { slab: 'slabs', roof: 'roofs', stairs: 'stairs', skylight: 'skylights', opening: 'openings', furniture: 'furniture', railing: 'railings' };

export class Editor {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    app.scene.add(this.group);
    this.op = null;
  }

  get store() {
    return this.app.store;
  }

  /** Vuelve a colocar los tiradores según la selección actual. */
  refresh(selection) {
    this.group.clear();
    if (!selection) return;
    const d = this.store.data;
    const e = this.store.find(selection.kind, selection.id);
    if (!e) return;
    if (selection.kind === 'foundation') this.polyHandles(e.points, d.settings.baseHeight);
    if (selection.kind === 'slab') this.polyHandles(rectToPoly(rectOf(e)), slabTop(d, e));
    if (selection.kind === 'roof') this.polyHandles(rectToPoly(rectOf(e)), elev(d.settings, e.level));
    if (selection.kind === 'railing') {
      const y = floorY(d, e.level, (e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2);
      this.add('end', 'a', e.a[0], y, e.a[1], sphereGeo, 1.1);
      this.add('end', 'b', e.b[0], y, e.b[1], sphereGeo, 1.1);
    }
    if (selection.kind === 'wall') {
      const y = wallInfo(d, e).bottom;
      this.add('end', 'a', e.a[0], y, e.a[1], sphereGeo, 1.1);
      this.add('end', 'b', e.b[0], y, e.b[1], sphereGeo, 1.1);
    }
  }

  polyHandles(points, y) {
    const n = points.length;
    points.forEach(([x, z], i) => {
      this.add('vertex', i, x, y, z, boxGeo);
      const [nx, nz] = points[(i + 1) % n];
      this.add('edge', i, (x + nx) / 2, y, (z + nz) / 2, sphereGeo, 0.8);
    });
  }

  add(type, index, x, y, z, geo, size = 1) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(geo, outerMat);
    const inner = new THREE.Mesh(geo, innerMat);
    outer.renderOrder = 20;
    inner.renderOrder = 21;
    inner.scale.setScalar(0.55);
    g.add(outer, inner);
    g.position.set(x, y, z);
    g.userData = { handle: type, index, size };
    this.group.add(g);
  }

  /** Tamaño constante en pantalla. */
  updateScale(camera) {
    for (const h of this.group.children) {
      h.scale.setScalar(camera.position.distanceTo(h.position) * 0.016 * h.userData.size);
    }
  }

  pickHandle(e) {
    if (!this.group.children.length) return null;
    this.group.updateMatrixWorld(true);
    const ray = this.app.rayFrom(e);
    const hits = ray.intersectObjects(this.group.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.handle) o = o.parent;
      if (o) return { type: o.userData.handle, index: o.userData.index };
    }
    return null;
  }

  /** ¿El puntero está sobre algo que se puede arrastrar? (para el cursor) */
  canDrag(e, sel) {
    if (!sel || !DRAGGABLE.includes(sel.kind)) return false;
    if (this.pickHandle(e)) return true;
    const hit = this.app.pickKind(e);
    return !!hit && hit.kind === sel.kind && hit.id === sel.id;
  }

  /** Empieza un arrastre si el clic cae sobre un tirador o sobre el elemento seleccionado. */
  tryStart(e, sel) {
    if (!sel || !DRAGGABLE.includes(sel.kind)) return false;
    const d = this.store.data;
    const el = this.store.find(sel.kind, sel.id);
    if (!el) return false;
    const h = this.pickHandle(e);
    let op = null;
    if (h) op = { kind: sel.kind, id: sel.id, type: h.type, index: h.index };
    else {
      const hit = this.app.pickKind(e);
      if (hit && hit.kind === sel.kind && hit.id === sel.id) op = { kind: sel.kind, id: sel.id, type: 'move' };
    }
    if (!op) return false;

    switch (op.kind) {
      case 'foundation':
        op.y = d.settings.baseHeight;
        break;
      case 'slab':
        op.y = slabTop(d, el);
        break;
      case 'roof':
        op.y = elev(d.settings, el.level);
        break;
      case 'stairs':
        op.y = floorY(d, el.level, el.x, el.z);
        break;
      case 'railing':
        op.y = floorY(d, el.level, (el.a[0] + el.b[0]) / 2, (el.a[1] + el.b[1]) / 2);
        op.a0 = [...el.a];
        op.b0 = [...el.b];
        break;
      case 'furniture':
        op.y = floorY(d, el.level, el.x, el.z);
        op.f0 = { x: el.x, z: el.z };
        op.last = null;
        break;
      case 'skylight': {
        const slab = d.slabs.find((s) => s.id === el.slabId);
        op.y = slabTop(d, slab);
        op.slab = rectOf(slab);
        break;
      }
      case 'opening': {
        const w = d.walls.find((x) => x.id === el.wallId);
        const info = wallInfo(d, w);
        op.y = info.bottom + el.sill + el.height / 2;
        op.wall = { a: w.a, dir: info.dir, len: info.len };
        op.others = d.openings.filter((o) => o.wallId === w.id && o.id !== el.id);
        op.lastPos = el.pos;
        break;
      }
      case 'wall': {
        op.y = wallInfo(d, el).bottom;
        op.level = el.level;
        op.a0 = [...el.a];
        op.b0 = [...el.b];
        op.refsA = endpointsAt(d, el.level, el.a);
        op.refsB = endpointsAt(d, el.level, el.b);
        if (el.level === 0) op.margin = foundationMargin(d);
        if (op.type === 'move') {
          // Mover una pared = desplazarla en perpendicular (agrandar/encoger la habitación).
          // Las paredes que llegan en ángulo se estiran con ella; los tramos que siguen
          // en la misma línea se quedan quietos (y se cierra el escalón con una pared nueva).
          const len = Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]);
          const u = [(el.b[0] - el.a[0]) / len, (el.b[1] - el.a[1]) / len];
          op.normal = [-u[1], u[0]];
          op.thickness = el.thickness;
          const split = (refs, pt) => {
            const follow = [];
            let stays = false;
            for (const r of refs) {
              if (r.id === el.id) {
                follow.push(r);
                continue;
              }
              const w = d.walls.find((x) => x.id === r.id);
              const q = r.end === 'a' ? w.b : w.a;
              const l = Math.hypot(q[0] - pt[0], q[1] - pt[1]) || 1;
              const cross = u[0] * ((q[1] - pt[1]) / l) - u[1] * ((q[0] - pt[0]) / l);
              if (Math.abs(cross) < 1e-3) stays = true;
              else follow.push(r);
            }
            return { follow, stays };
          };
          const A = split(op.refsA, el.a);
          const B = split(op.refsB, el.b);
          op.refsA = A.follow;
          op.refsB = B.follow;
          op.stayA = A.stays;
          op.stayB = B.stays;
        } else {
          // un extremo en mitad de una pared recta (unión en T) se desliza por ella
          op.lineA = tLine(d, el.level, el.a, el.id);
          op.lineB = tLine(d, el.level, el.b, el.id);
        }
        // los huecos se quedan en su sitio al estirar (salvo los de la pared que se mueve entera)
        const ids = [...op.refsA, ...op.refsB].map((r) => r.id).filter((id) => op.type !== 'move' || id !== op.id);
        op.anchors = anchorOpenings(d, ids);
        break;
      }
    }
    op.start = this.app.rayPlane(e, op.y);
    if (!op.start) return false;
    this.op = op;
    this.store.startGesture();
    return true;
  }

  drag(e) {
    const op = this.op;
    if (!op) return;
    const p = this.app.rayPlane(e, op.y);
    if (!p) return;
    const s = this.app.view.snap;
    const snap = (v) => Math.round(v / s) * s;
    const dx = snap(p.x - op.start.x);
    const dz = snap(p.z - op.start.z);
    let label = '';

    this.store.updateGesture((d) => {
      const col = COLLECTION[op.kind];
      const el = col ? d[col].find((x) => x.id === op.id) : null;
      switch (op.kind) {
        case 'foundation': {
          const f = d.foundations.find((x) => x.id === op.id);
          if (op.type === 'move') translateFoundation(f, dx, dz);
          if (op.type === 'vertex') moveVertex(f.points, op.index, snap(p.x), snap(p.z));
          if (op.type === 'edge') moveEdge(f.points, op.index, snap(p.x), snap(p.z));
          const b = bboxOf(f.points);
          label = `${fmt(b.maxX - b.minX)} × ${fmt(b.maxZ - b.minZ)} m`;
          break;
        }
        case 'slab':
        case 'roof': {
          if (op.type === 'move') {
            el.x0 += dx;
            el.x1 += dx;
            el.z0 += dz;
            el.z1 += dz;
            // las claraboyas viajan con su losa
            if (op.kind === 'slab') for (const k of d.skylights) if (k.slabId === el.id) (k.x += dx), (k.z += dz);
          } else {
            const pts = rectToPoly(rectOf(el));
            if (op.type === 'vertex') moveVertex(pts, op.index, snap(p.x), snap(p.z));
            if (op.type === 'edge') moveEdge(pts, op.index, snap(p.x), snap(p.z));
            setRect(el, bboxOf(pts));
          }
          const r = rectOf(el);
          label = `${fmt(r.maxX - r.minX)} × ${fmt(r.maxZ - r.minZ)} m`;
          break;
        }
        case 'stairs':
          el.x += dx;
          el.z += dz;
          break;
        case 'railing': {
          if (op.type === 'move') {
            el.a = [op.a0[0] + dx, op.a0[1] + dz];
            el.b = [op.b0[0] + dx, op.b0[1] + dz];
          } else {
            el[op.index] = [snap(p.x), snap(p.z)];
          }
          label = `${fmt(Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]))} m`;
          break;
        }
        case 'furniture': {
          // se recalcula la colocación (imán a paredes y a muebles vecinos)
          const target = { x: op.f0.x + (p.x - op.start.x), z: op.f0.z + (p.z - op.start.z) };
          const pl = place(d, el.type, el.level, target, el.rot, el.id);
          if (pl.ok) op.last = pl;
          if (op.last) {
            el.x = op.last.x;
            el.z = op.last.z;
            el.rot = op.last.rot;
          }
          label = pl.ok ? '' : 'Choca con otro mueble';
          break;
        }
        case 'skylight': {
          const R = op.slab;
          el.x = Math.max(R.minX + el.w / 2 + 0.1, Math.min(R.maxX - el.w / 2 - 0.1, el.x + dx));
          el.z = Math.max(R.minZ + el.d / 2 + 0.1, Math.min(R.maxZ - el.d / 2 - 0.1, el.z + dz));
          break;
        }
        case 'opening': {
          const W = op.wall;
          let pos = (p.x - W.a[0]) * W.dir[0] + (p.z - W.a[1]) * W.dir[1];
          pos = Math.round(pos / 0.05) * 0.05;
          pos = Math.max(el.width / 2 + 0.05, Math.min(W.len - el.width / 2 - 0.05, pos));
          const free = op.others.every((o) => Math.abs(o.pos - pos) >= (o.width + el.width) / 2 + 0.05);
          if (free) op.lastPos = pos;
          el.pos = op.lastPos;
          label = `${fmt(el.pos - el.width / 2)} m · ${fmt(W.len - el.pos - el.width / 2)} m`;
          break;
        }
        case 'wall': {
          const fitA = (q) => (op.lineA ? projectOnLine(op.lineA, q) : q);
          const fitB = (q) => (op.lineB ? projectOnLine(op.lineB, q) : q);
          if (op.type === 'move') {
            const n = op.normal;
            const t = snap((p.x - op.start.x) * n[0] + (p.z - op.start.z) * n[1]);
            const na = [op.a0[0] + n[0] * t, op.a0[1] + n[1] * t];
            const nb = [op.b0[0] + n[0] * t, op.b0[1] + n[1] * t];
            setEndpoints(d, op.refsA, na);
            setEndpoints(d, op.refsB, nb);
            // escalón con el tramo vecino que se queda quieto: se cierra con una pared nueva
            if (Math.abs(t) > 1e-6) {
              const mk = (from, to) =>
                d.walls.push({ id: Math.random().toString(36).slice(2, 10), level: op.level, a: [...from], b: to, thickness: op.thickness });
              if (op.stayA) mk(op.a0, na);
              if (op.stayB) mk(op.b0, nb);
            }
            reprojectOpenings(d, op.anchors);
            label = `${t >= 0 ? '+' : '−'}${fmt(Math.abs(t))} m`;
            break;
          } else {
            const refs = op.index === 'a' ? op.refsA : op.refsB;
            let target = this.magnet(d, op, refs, p, snap);
            if (e.shiftKey) {
              // Shift: estirar sin cambiar la dirección de la pared
              const [ax, az] = op.a0;
              const len = Math.hypot(op.b0[0] - ax, op.b0[1] - az) || 1;
              const ux = (op.b0[0] - ax) / len;
              const uz = (op.b0[1] - az) / len;
              const t = snap((p.x - ax) * ux + (p.z - az) * uz);
              target = [ax + ux * t, az + uz * t];
            }
            setEndpoints(d, refs, op.index === 'a' ? fitA(target) : fitB(target));
          }
          reprojectOpenings(d, op.anchors);
          const w = d.walls.find((x) => x.id === op.id);
          label = `${fmt(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]))} m`;
          break;
        }
      }
    });
    this.app.setMeasure(e, label);
  }

  /** Ajuste a la cuadrícula, con imán a los extremos de otras paredes. */
  magnet(d, op, refs, p, snap) {
    let best = 0.35;
    let out = [snap(p.x), snap(p.z)];
    const moving = new Set(refs.map((r) => r.id + r.end));
    for (const w of d.walls) {
      if (w.level !== op.level) continue;
      for (const end of ['a', 'b']) {
        if (moving.has(w.id + end)) continue;
        const q = w[end];
        const dist = Math.hypot(q[0] - p.x, q[1] - p.z);
        if (dist < best) {
          best = dist;
          out = [q[0], q[1]];
        }
      }
    }
    return out;
  }

  end() {
    const op = this.op;
    if (!op) return;
    this.op = null;
    this.app.setMeasure(null);
    this.store.endGesture((d) => {
      if (op.kind === 'foundation') rebuildFoundations(d, op.id);
      if (op.kind === 'wall') {
        fixWalls(d);
        if (op.level === 0) growFoundations(d, op.margin); // la base crece si la habitación sale de ella
      }
      if (op.kind === 'slab') {
        // las claraboyas que se han quedado fuera de la losa desaparecen
        const slab = d.slabs.find((x) => x.id === op.id);
        const r = rectOf(slab);
        d.skylights = d.skylights.filter((k) => {
          if (k.slabId !== slab.id) return true;
          const q = skylightRect(k);
          return q.minX >= r.minX + 0.05 && q.maxX <= r.maxX - 0.05 && q.minZ >= r.minZ + 0.05 && q.maxZ <= r.maxZ - 0.05;
        });
      }
    });
  }
}
