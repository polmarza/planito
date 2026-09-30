// Vista interior en primera persona: andar por la casa.
//  - WASD / flechas para moverse, arrastrar para mirar, Shift para correr.
//  - No se atraviesan paredes (salvo por las puertas) ni muebles.
//  - Las escaleras se suben andando: la altura sigue los peldaños y al llegar
//    arriba se cambia de planta.
import * as THREE from 'three';
import { floorY, elev, wallInfo, stairsRect, rectOf, inRect, slabHoles, stairsRailSpecs, stairsToWorld } from './build.js';
import { findRooms, distToSeg, bbox } from './rooms.js';
import { CATALOG, footprint } from './furniture.js';

const EYE = 1.65;
const RADIUS = 0.25;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];

export class WalkController {
  constructor({ camera, store, canvas, onExit }) {
    this.camera = camera;
    this.store = store;
    this.onExit = onExit;
    this.active = false;
    this.keys = new Set();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.level = 0;
    this.y = 0;

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.active) drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active || !drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.004;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') return this.onExit();
      if (MOVE_KEYS.includes(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Entra en la estancia más grande de la planta indicada (o en el centro de la casa). */
  enter(level) {
    const d = this.store.data;
    let start = null;
    for (const l of [level, 0]) {
      const rooms = findRooms(d, l).sort((a, b) => b.area - a.area);
      if (rooms.length) {
        start = rooms[0].label;
        this.level = l;
        break;
      }
    }
    if (!start) {
      const pts = [...d.foundations.flatMap((f) => f.points), ...d.walls.flatMap((w) => [w.a, w.b])];
      const b = pts.length ? bbox(pts) : { minX: 0, maxX: 0, minZ: 3, maxZ: 3 };
      start = [(b.minX + b.maxX) / 2, b.maxZ + 3];
      this.level = 0;
    }
    this.pos.set(start[0], 0, start[1]);
    this.yaw = 0;
    this.pitch = -0.05;
    this.y = this.ground(this.pos.x, this.pos.z).y;
    this.fov = this.camera.fov;
    this.camera.fov = 70;
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    this.active = true;
    this.apply();
  }

  exit() {
    this.active = false;
    this.keys.clear();
    this.camera.fov = this.fov;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
  }

  /** Altura del suelo en (x, z) y planta en la que se está (las escaleras suben). */
  ground(x, z) {
    const d = this.store.data;
    for (const st of d.stairs) {
      if (st.level !== this.level && st.level !== this.level - 1) continue;
      if (!inRect(stairsRect(st), x, z, 0.02)) continue;
      const dir = [[1, 0], [0, -1], [-1, 0], [0, 1]][st.rot];
      const bottom = [st.x - (dir[0] * st.length) / 2, st.z - (dir[1] * st.length) / 2];
      const t = Math.max(0, Math.min(1, ((x - bottom[0]) * dir[0] + (z - bottom[1]) * dir[1]) / st.length));
      const y0 = floorY(d, st.level, st.x, st.z);
      const y1 = elev(d.settings, st.level + 1);
      return { y: y0 + (y1 - y0) * t, level: t > 0.5 ? st.level + 1 : st.level };
    }
    // sin forjado debajo (borde de terraza, hueco...): se baja a la planta inferior
    let level = this.level;
    const onSlab = (l) =>
      d.slabs.some((s) => s.level === l && inRect(rectOf(s), x, z) && !slabHoles(d, s).some((h) => inRect(h, x, z)));
    while (level > 0 && !onSlab(level)) level--;
    return { y: floorY(d, level, x, z), level };
  }

  /** Obstáculos de la planta actual: tramos de pared (sin las puertas) y bordes de muebles. */
  obstacles() {
    const d = this.store.data;
    const segs = [];
    for (const w of d.walls) {
      if (w.level !== this.level) continue;
      const { len, dir } = wallInfo(d, w);
      const gaps = d.openings
        .filter((o) => o.wallId === w.id && o.kind === 'door')
        .map((o) => [o.pos - o.width / 2 + 0.05, o.pos + o.width / 2 - 0.05])
        .sort((a, b) => a[0] - b[0]);
      let t0 = 0;
      for (const [g0, g1] of [...gaps, [len, len]]) {
        if (g0 > t0) segs.push({ a: [w.a[0] + dir[0] * t0, w.a[1] + dir[1] * t0], b: [w.a[0] + dir[0] * g0, w.a[1] + dir[1] * g0], r: w.thickness / 2 });
        t0 = Math.max(t0, g1);
      }
    }
    for (const r of d.railings || []) if (r.level === this.level) segs.push({ a: r.a, b: r.b, r: 0.03 });
    // barandillas de las escaleras (lados) y del hueco en la planta de arriba
    for (const st of d.stairs) {
      for (const r of stairsRailSpecs(st)) {
        const ok = r.upper ? this.level === st.level + 1 : this.level === st.level || this.level === st.level + 1;
        if (!ok) continue;
        const a = r.across ? stairsToWorld(st, r.x, r.x0) : stairsToWorld(st, r.x0, r.z);
        const b = r.across ? stairsToWorld(st, r.x, r.x1) : stairsToWorld(st, r.x1, r.z);
        segs.push({ a, b, r: 0.03 });
      }
    }
    for (const f of d.furniture) {
      const def = CATALOG[f.type];
      if (!def || f.level !== this.level || def.layer !== 'floor') continue;
      const fp = footprint(f);
      for (let i = 0; i < 4; i++) segs.push({ a: fp[i], b: fp[(i + 1) % 4], r: 0 });
    }
    return segs;
  }

  update(dt) {
    if (!this.active) return;
    const k = this.keys;
    let fwd = 0;
    let side = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fwd += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('KeyD')) side += 1;
    if (k.has('KeyA')) side -= 1;
    // las flechas laterales giran la vista
    if (k.has('ArrowLeft')) this.yaw += dt * 1.8;
    if (k.has('ArrowRight')) this.yaw -= dt * 1.8;

    if (fwd || side) {
      const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 4.5 : 2.2;
      const f = [-Math.sin(this.yaw), -Math.cos(this.yaw)];
      const r = [Math.cos(this.yaw), -Math.sin(this.yaw)];
      let mx = f[0] * fwd + r[0] * side;
      let mz = f[1] * fwd + r[1] * side;
      const l = Math.hypot(mx, mz);
      const step = speed * Math.min(dt, 0.1);
      // en pasos cortos, para no "saltarse" una pared si un fotograma tarda
      const n = Math.max(1, Math.ceil(step / 0.08));
      mx = ((mx / l) * step) / n;
      mz = ((mz / l) * step) / n;
      const p = [this.pos.x, this.pos.z];
      const segs = this.obstacles();
      for (let k = 0; k < n; k++) {
        p[0] += mx;
        p[1] += mz;
        // empujar fuera de paredes y muebles
        for (let it = 0; it < 2; it++) {
          for (const s of segs) {
            const min = RADIUS + s.r;
            if (distToSeg(p, s.a, s.b) >= min) continue;
            const c = closest(p, s.a, s.b);
            let nx = p[0] - c[0];
            let nz = p[1] - c[1];
            const nl = Math.hypot(nx, nz) || 1;
            nx /= nl;
            nz /= nl;
            p[0] = c[0] + nx * min;
            p[1] = c[1] + nz * min;
          }
        }
      }
      const { lotW, lotD } = this.store.data.settings;
      p[0] = Math.max(-lotW / 2, Math.min(lotW / 2, p[0]));
      p[1] = Math.max(-lotD / 2, Math.min(lotD / 2, p[1]));
      this.pos.x = p[0];
      this.pos.z = p[1];
    }
    const g = this.ground(this.pos.x, this.pos.z);
    this.level = g.level;
    // la altura se suaviza (subir un escalón o la base no da saltos bruscos)
    this.y += (g.y - this.y) * Math.min(1, dt * 12);
    this.apply();
  }

  apply() {
    this.camera.position.set(this.pos.x, this.y + EYE, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}

function closest(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dz * t];
}
