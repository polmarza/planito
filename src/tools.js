import * as THREE from 'three';
import { uid } from './state.js';
import {
  MAT,
  rectOf,
  inRect,
  elev,
  wallInfo,
  stairsRect,
  skylightRect,
  slabTop,
  slabHoles,
  wallGeometry,
} from './build.js';
import { rebuildFoundations, fixWalls, foundationMargin, growFoundations } from './ops.js';
import { rectToPoly } from './poly.js';

// Iconos minimalistas (trazos SVG de 24x24)
const I = {
  select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  foundation: '<path d="M3 15l9-4 9 4-9 4z"/><path d="M3 15v3l9 4 9-4v-3"/>',
  wall: '<path d="M4 20V8l8-4 8 4v12"/><path d="M4 12h16"/>',
  room: '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="7" y="7" width="10" height="10"/>',
  slab: '<path d="M3 10l9-5 9 5-9 5z"/><path d="M3 10v2l9 5 9-5v-2"/>',
  roof: '<path d="M2 13L12 5l10 8"/><path d="M5 11v8h14v-8"/>',
  door: '<rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="15" cy="12" r="0.8"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 5v14M4 12h16"/>',
  bigwindow: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18"/>',
  garage: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-9h10v9M7 15h10M7 18h10"/>',
  stairs: '<path d="M3 20h5v-4h4v-4h4V8h5"/>',
  railing: '<path d="M3 8h18M4 8v12M20 8v12M12 8v12M3 18h18"/>',
  skylight: '<path d="M3 16l9-5 9 5-9 5z"/><path d="M9 15.5l3-1.7 3 1.7-3 1.7z"/><path d="M12 3v5M8 5l1.5 2.5M16 5l-1.5 2.5"/>',
  erase: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  paint: '<path d="M4 4h13v5H4z"/><path d="M17 6.5h2.5V12H11v3"/><rect x="9.5" y="15" width="3" height="6" rx="1"/>',
};

export const TOOLS = [
  { id: 'select', label: 'Seleccionar', key: 'V', icon: I.select },
  'sep',
  { id: 'foundation', label: 'Base', key: 'B', icon: I.foundation },
  { id: 'wall', label: 'Pared', key: 'W', icon: I.wall },
  { id: 'room', label: 'Habitación', key: 'M', icon: I.room },
  { id: 'slab', label: 'Suelo / techo', key: 'F', icon: I.slab },
  { id: 'roof', label: 'Tejado', key: 'T', icon: I.roof },
  'sep',
  { id: 'door', label: 'Puerta', key: 'D', icon: I.door },
  { id: 'window', label: 'Ventana', key: 'N', icon: I.window },
  // variantes: no tienen icono propio arriba; se eligen en el panel de opciones
  { id: 'bigwindow', label: 'Ventanal', key: 'G', icon: I.bigwindow, variantOf: 'window' },
  { id: 'garage', label: 'Puerta garaje', key: 'J', icon: I.garage, variantOf: 'door' },
  { id: 'stairs', label: 'Escalera', key: 'S', icon: I.stairs },
  { id: 'railing', label: 'Barandilla', key: 'A', icon: I.railing },
  { id: 'skylight', label: 'Claraboya', key: 'K', icon: I.skylight },
  'sep',
  { id: 'erase', label: 'Borrar', key: 'X', icon: I.erase },
];

const NAV = '<kbd>Botón dcho.</kbd> rotar · <kbd>Flechas</kbd> o <kbd>Shift+arrastrar</kbd> desplazar · <kbd>Rueda</kbd> zoom';

export const HINTS = {
  select: 'Clic para seleccionar · Arrastra los tiradores o el elemento para modificarlo · <kbd>Arrastrar</kbd> en vacío rota · <kbd>Supr</kbd> borrar',
  foundation: 'Arrastra para dibujar la base (si toca otra, se suman) · ' + NAV,
  wall: 'Clic para empezar, clic para cada tramo · <kbd>Shift</kbd> recto · <kbd>Esc</kbd>/doble clic termina · ' + NAV,
  room: 'Arrastra para crear una habitación de 4 paredes · ' + NAV,
  slab: 'Arrastra para crear un suelo (en planta 1+ hace de techo de la planta de abajo) · ' + NAV,
  roof: 'Arrastra sobre las paredes para crear un tejado a dos aguas · ' + NAV,
  door: 'Pasa sobre una pared y haz clic para colocar la puerta · ' + NAV,
  window: 'Pasa sobre una pared y haz clic para colocar la ventana · ' + NAV,
  bigwindow: 'Pasa sobre una pared y haz clic para colocar el ventanal · ' + NAV,
  garage: 'Pasa sobre una pared y haz clic para colocar la puerta de garaje · ' + NAV,
  railing: 'Clic para empezar, clic para cada tramo · <kbd>Shift</kbd> recto · <kbd>Esc</kbd>/doble clic termina · altura y estilo en el panel · ' + NAV,
  stairs: 'Clic para colocar la escalera (sube a la planta siguiente) · <kbd>R</kbd> girar · ' + NAV,
  skylight: 'Clic sobre un suelo/techo de esta planta para abrir una claraboya · ' + NAV,
  erase: 'Clic sobre un elemento para borrarlo · ' + NAV,
  brush: 'Pincel: clic en una cara de pared para pintarla · <kbd>Shift</kbd>+clic toda la estancia · <kbd>Esc</kbd> terminar · ' + NAV,
  zone: 'Arrastra un rectángulo sobre el suelo para pintar esa zona · <kbd>Esc</kbd> terminar · ' + NAV,
};

/** Tipos de puerta y ventana (se eligen en la barra de catálogo). */
export const OPENING_PRESETS = {
  door: { kind: 'door', width: 0.9, height: 2.1, sill: 0 },
  door2: { kind: 'door', width: 1.6, height: 2.1, sill: 0, leaves: 2 },
  garage: { kind: 'garage', width: 2.5, height: 2.2, sill: 0 },
  window: { kind: 'window', width: 1.2, height: 1.2, sill: 0.9 },
  small: { kind: 'window', width: 0.6, height: 0.6, sill: 1.4 },
  tall: { kind: 'window', width: 0.6, height: 1.8, sill: 0.4 },
  strip: { kind: 'window', width: 2.0, height: 0.6, sill: 1.5 },
  balcony: { kind: 'window', width: 0.9, height: 2.2, sill: 0 },
  bigwindow: { kind: 'window', width: 2.0, height: 2.2, sill: 0 },
};
const isOpeningTool = (t) => t === 'door' || t === 'window';

const ghostMat = new THREE.MeshBasicMaterial({ color: '#2f6fed', transparent: true, opacity: 0.35, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: '#d9463b', transparent: true, opacity: 0.35, depthWrite: false });

/**
 * Controlador de herramientas: traduce ratón/teclado en cambios del modelo.
 * `app` expone: store, view, raycaster helpers, scene, setMeasure(), setStatus().
 */
export class ToolController {
  constructor(app) {
    this.app = app;
    this.tool = 'select';
    this.ghost = new THREE.Group();
    this.ghost.renderOrder = 5;
    app.scene.add(this.ghost);
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.13, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#2f6fed', depthTest: false, transparent: true }),
    );
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    app.scene.add(this.cursor);
    this.reset();
    this.stairsRot = 0;
  }

  get store() {
    return this.app.store;
  }
  get data() {
    return this.app.store.data;
  }
  get level() {
    return this.app.view.level;
  }
  get snap() {
    return this.app.view.snap;
  }

  setTool(id) {
    this.tool = id;
    this.reset();
    this.cursor.visible = false;
  }

  reset() {
    this.start = null; // punto inicial (rectángulos y paredes)
    this.chainStart = null;
    this.hover = null; // resultado de validación de la previsualización
    this.clearGhost();
    this.app.setMeasure?.(null);
  }

  clearGhost() {
    for (const c of [...this.ghost.children]) {
      c.geometry?.dispose();
      this.ghost.remove(c);
    }
  }

  addGhost(geo, ok = true) {
    const m = new THREE.Mesh(geo, ok ? ghostMat : badMat);
    m.renderOrder = 5;
    this.ghost.add(m);
    return m;
  }

  snapV(v) {
    const s = this.snap;
    return Math.round(v / s) * s;
  }

  /** Punto del plano de trabajo bajo el ratón, ajustado a la cuadrícula. */
  snappedPoint(e, { endpoints = false } = {}) {
    const hit = this.app.pickPlane(e);
    if (!hit) return null;
    let x = this.snapV(hit.x);
    let z = this.snapV(hit.z);
    if (endpoints) {
      // imán a extremos de paredes existentes
      let best = 0.35;
      for (const w of this.data.walls) {
        if (w.level !== this.level) continue;
        for (const p of [w.a, w.b]) {
          const dd = Math.hypot(p[0] - hit.x, p[1] - hit.z);
          if (dd < best) {
            best = dd;
            x = p[0];
            z = p[1];
          }
        }
      }
    }
    return { x, z, y: hit.y };
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------
  onMove(e) {
    const t = this.tool;
    this.clearGhost();
    this.cursor.visible = false;
    this.app.setMeasure(null);

    if (t === 'select' || t === 'erase') {
      this.app.hoverPick(e, t === 'erase' ? 'delete' : 'hover');
      return;
    }
    if (t === 'wall' || t === 'railing') return this.moveWall(e);
    if (['foundation', 'room', 'slab', 'roof'].includes(t)) return this.moveRect(e);
    if (isOpeningTool(t)) return this.moveOpening(e);
    if (t === 'stairs') return this.moveStairs(e);
    if (t === 'skylight') return this.moveSkylight(e);
  }

  onDown(e) {
    const t = this.tool;
    if (t === 'wall' || t === 'railing') return this.downWall(e);
    if (['foundation', 'room', 'slab', 'roof'].includes(t)) {
      if (!this.start) {
        const p = this.snappedPoint(e, { endpoints: t === 'room' });
        if (p) this.start = p;
      }
      return;
    }
    if (isOpeningTool(t)) return this.commitOpening();
    if (t === 'stairs') return this.commitStairs();
    if (t === 'skylight') return this.commitSkylight();
  }

  onUp(e) {
    const t = this.tool;
    if (['foundation', 'room', 'slab', 'roof'].includes(t) && this.start) {
      const p = this.snappedPoint(e, { endpoints: t === 'room' });
      if (p && Math.abs(p.x - this.start.x) > 1e-6 && Math.abs(p.z - this.start.z) > 1e-6) {
        this.commitRect(this.start, p);
        this.start = null;
        this.onMove(e);
      }
      // si no hubo arrastre, se queda esperando un segundo clic
    }
  }

  onDblClick() {
    if (this.tool === 'wall' || this.tool === 'railing') this.reset();
  }

  /** Propiedades de las paredes nuevas (altura y tipo elegidos en el panel). */
  newWallProps() {
    const ws = this.app.view.wallStyle;
    const out = {};
    if (ws.height) out.height = ws.height;
    if (ws.style === 'slats') Object.assign(out, { style: 'slats', slatColor: ws.slatColor, slatWidth: ws.slatWidth, slatGap: ws.slatGap, slatDir: ws.slatDir });
    return out;
  }

  onKey(e) {
    if (e.key === 'Escape') {
      this.reset();
      return true;
    }
    if (e.key === 'Enter' && (this.tool === 'wall' || this.tool === 'railing')) {
      this.reset();
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && this.tool === 'stairs') {
      this.stairsRot = (this.stairsRot + 1) % 4;
      if (this.lastEvent) this.onMove(this.lastEvent);
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Paredes
  // -------------------------------------------------------------------------
  wallEnd(e) {
    const p = this.snappedPoint(e, { endpoints: true });
    if (!p || !this.start) return p;
    if (e.shiftKey) {
      const dx = Math.abs(p.x - this.start.x);
      const dz = Math.abs(p.z - this.start.z);
      if (dx > dz) p.z = this.start.z;
      else p.x = this.start.x;
    }
    return p;
  }

  moveWall(e) {
    const p = this.wallEnd(e);
    if (!p) return;
    this.cursor.visible = true;
    this.cursor.position.set(p.x, this.app.planeY(p.x, p.z) + 0.01, p.z);
    if (!this.start) return;
    const len = Math.hypot(p.x - this.start.x, p.z - this.start.z);
    if (len < 1e-6) return;
    const railing = this.tool === 'railing';
    const w = {
      a: [this.start.x, this.start.z],
      b: [p.x, p.z],
      level: this.level,
      thickness: railing ? 0.06 : this.data.settings.wallThickness,
      ...(railing ? { height: this.app.view.railStyle.height } : this.newWallProps()),
    };
    const info = wallInfo(this.data, w);
    const geo = wallGeometry(info.len, info.height, w.thickness, [], w.thickness / 2, w.thickness / 2);
    const m = this.addGhost(geo);
    m.position.set(w.a[0], info.bottom, w.a[1]);
    m.rotation.y = info.angle;
    this.app.setMeasure(e, `${fmt(len)} m`);
  }

  downWall(e) {
    const p = this.wallEnd(e);
    if (!p) return;
    if (!this.start) {
      this.start = p;
      this.chainStart = p;
      return;
    }
    if (Math.hypot(p.x - this.start.x, p.z - this.start.z) < 1e-6) return;
    const a = [this.start.x, this.start.z];
    const b = [p.x, p.z];
    const lvl = this.level;
    if (this.tool === 'railing') {
      this.store.commit((d) => d.railings.push({ id: uid(), level: lvl, a, b, ...this.app.view.railStyle }));
    } else {
      const props = this.newWallProps();
      this.store.commit((d) => {
        const margin = lvl === 0 ? foundationMargin(d) : 0;
        d.walls.push({ id: uid(), level: lvl, a, b, thickness: d.settings.wallThickness, ...props });
        fixWalls(d); // corta en cruces y uniones: cada tramo queda independiente
        if (lvl === 0) growFoundations(d, margin);
      });
    }
    // cerrar el contorno termina la cadena
    if (this.chainStart && Math.hypot(p.x - this.chainStart.x, p.z - this.chainStart.z) < 1e-6) {
      this.reset();
    } else {
      this.start = p;
    }
  }

  // -------------------------------------------------------------------------
  // Rectángulos: base, habitación, suelo, tejado
  // -------------------------------------------------------------------------
  moveRect(e) {
    const p = this.snappedPoint(e, { endpoints: this.tool === 'room' });
    if (!p) return;
    this.cursor.visible = true;
    this.cursor.position.set(p.x, this.app.planeY(p.x, p.z) + 0.01, p.z);
    if (!this.start) return;
    const r = rectOf({ x0: this.start.x, z0: this.start.z, x1: p.x, z1: p.z });
    const w = r.maxX - r.minX;
    const dpt = r.maxZ - r.minZ;
    if (w < 1e-6 || dpt < 1e-6) return;
    const s = this.data.settings;
    let y0 = 0;
    let h = 0.05;
    if (this.tool === 'foundation') h = Math.max(0.05, s.baseHeight);
    if (this.tool === 'slab') {
      const top = this.level > 0 ? elev(s, this.level) : 0.06;
      h = Math.min(s.slabThickness, top);
      y0 = top - h;
    }
    if (this.tool === 'room' || this.tool === 'roof') {
      y0 = this.app.planeY((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2);
      h = this.tool === 'room' ? s.levelHeight : 0.1;
    }
    if (this.tool === 'room') {
      const t = s.wallThickness;
      const segs = [
        [r.minX, r.minZ, r.maxX, r.minZ],
        [r.maxX, r.minZ, r.maxX, r.maxZ],
        [r.maxX, r.maxZ, r.minX, r.maxZ],
        [r.minX, r.maxZ, r.minX, r.minZ],
      ];
      for (const [ax, az, bx, bz] of segs) {
        const len = Math.hypot(bx - ax, bz - az);
        const m = this.addGhost(wallGeometry(len, h, t, [], t / 2, t / 2));
        m.position.set(ax, y0, az);
        m.rotation.y = -Math.atan2(bz - az, bx - ax);
      }
    } else {
      const m = this.addGhost(new THREE.BoxGeometry(w, h, dpt));
      m.position.set((r.minX + r.maxX) / 2, y0 + h / 2, (r.minZ + r.maxZ) / 2);
    }
    this.app.setMeasure(e, `${fmt(w)} × ${fmt(dpt)} m`);
  }

  commitRect(a, b) {
    const t = this.tool;
    const rect = { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
    const lvl = this.level;
    this.store.commit((d) => {
      if (t === 'foundation') {
        const r = rectOf(rect);
        d.foundations.push({ id: uid(), points: rectToPoly(r), holes: [] });
        rebuildFoundations(d); // si se solapa con otra base, se suman
      }
      if (t === 'slab') d.slabs.push({ id: uid(), level: lvl, ...rect });
      if (t === 'roof') {
        const ridge = rect.x1 - rect.x0 >= rect.z1 - rect.z0 ? 'x' : 'z';
        d.roofs.push({ id: uid(), level: lvl, ...rect, pitch: this.app.view.roofStyle.pitch, overhang: 0.4, ridge });
      }
      if (t === 'room') {
        const margin = lvl === 0 ? foundationMargin(d) : 0;
        const { x0, z0, x1, z1 } = rect;
        const th = d.settings.wallThickness;
        const props = {}; // la habitación siempre con paredes completas
        const pts = [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ];
        for (let i = 0; i < 4; i++) {
          d.walls.push({ id: uid(), level: lvl, a: [...pts[i]], b: [...pts[(i + 1) % 4]], thickness: th, ...props });
        }
        fixWalls(d);
        if (lvl === 0) growFoundations(d, margin);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Puertas y ventanas
  // -------------------------------------------------------------------------
  moveOpening(e) {
    this.hover = null;
    const hit = this.app.pickKind(e, ['wall', 'opening'], (ud) => ud.level === this.level);
    if (!hit) return;
    const w = this.data.walls.find((x) => x.id === hit.wallId);
    if (!w) return;
    if (w.style === 'slats') return this.app.setMeasure(e, 'Las paredes de listones no admiten huecos');
    const preset = this.app.view.opening[this.tool];
    const info = wallInfo(this.data, w);
    const width = Math.min(preset.width, info.len - 0.1);
    const height = Math.min(preset.height, info.height - preset.sill - 0.1);
    if (width < 0.3 || height < 0.3) return;
    // posición a lo largo de la pared
    const rel = (hit.point.x - w.a[0]) * info.dir[0] + (hit.point.z - w.a[1]) * info.dir[1];
    let pos = Math.round(rel / 0.05) * 0.05;
    pos = Math.max(width / 2 + 0.05, Math.min(info.len - width / 2 - 0.05, pos));
    const others = this.data.openings.filter((o) => o.wallId === w.id);
    const ok = others.every((o) => Math.abs(o.pos - pos) >= (o.width + width) / 2 + 0.05);
    const o = { ...preset, width, height, pos, wallId: w.id };
    this.hover = ok ? o : null;

    const m = this.addGhost(new THREE.BoxGeometry(width, height, w.thickness + 0.06), ok);
    const g = new THREE.Object3D();
    g.position.set(w.a[0], info.bottom, w.a[1]);
    g.rotation.y = info.angle;
    g.updateMatrixWorld();
    m.position.copy(g.localToWorld(new THREE.Vector3(pos, preset.sill + height / 2, 0)));
    m.rotation.y = info.angle;
    this.app.setMeasure(e, `${fmt(width)} × ${fmt(height)} m`);
  }

  commitOpening() {
    const o = this.hover;
    if (!o) return;
    this.store.commit((d) => {
      d.openings.push({ id: uid(), ...o });
    });
    this.hover = null;
    if (this.lastEvent) this.onMove(this.lastEvent);
  }

  // -------------------------------------------------------------------------
  // Escaleras
  // -------------------------------------------------------------------------
  moveStairs(e) {
    this.hover = null;
    const hit = this.app.pickPlane(e);
    if (!hit) return;
    const st = { level: this.level, rot: this.stairsRot, width: 1.0, length: 4.0, x: 0, z: 0 };
    const along = st.rot % 2 === 0;
    const hx = (along ? st.length : st.width) / 2;
    const hz = (along ? st.width : st.length) / 2;
    st.x = this.snapV(hit.x - hx) + hx;
    st.z = this.snapV(hit.z - hz) + hz;
    this.hover = st;
    const bottom = this.app.planeY(st.x, st.z);
    const H = elev(this.data.settings, st.level + 1) - bottom;
    const r = stairsRect(st);
    const m = this.addGhost(new THREE.BoxGeometry(r.maxX - r.minX, H, r.maxZ - r.minZ));
    m.position.set(st.x, bottom + H / 2, st.z);
    // flecha que indica hacia dónde sube
    const dirX = [1, 0, -1, 0][st.rot];
    const dirZ = [0, -1, 0, 1][st.rot];
    const arrow = this.addGhost(new THREE.ConeGeometry(0.3, 0.6, 3).rotateX(Math.PI / 2));
    arrow.position.set(st.x + dirX * (st.length / 2 + 0.5), bottom + 0.1, st.z + dirZ * (st.length / 2 + 0.5));
    arrow.lookAt(arrow.position.x + dirX, arrow.position.y, arrow.position.z + dirZ);
    this.app.setMeasure(e, `sube ↗ · R girar`);
  }

  commitStairs() {
    const st = this.hover;
    if (!st) return;
    this.store.commit((d) => d.stairs.push({ id: uid(), ...st, ...this.app.view.stairStyle }));
  }

  // -------------------------------------------------------------------------
  // Claraboyas
  // -------------------------------------------------------------------------
  moveSkylight(e) {
    this.hover = null;
    const hit = this.app.pickKind(e, ['slab', 'skylight'], (ud) => ud.level === this.level);
    if (!hit || hit.kind !== 'slab') {
      this.app.setMeasure(e, this.level === 0 ? 'Sube a una planta con techo (▲)' : 'Pasa sobre un suelo/techo');
      return;
    }
    const slab = this.data.slabs.find((s) => s.id === hit.id);
    const { w, d: dd } = this.app.view.skylightSize;
    const sk = {
      slabId: slab.id,
      w,
      d: dd,
      x: this.snapV(hit.point.x - w / 2) + w / 2,
      z: this.snapV(hit.point.z - dd / 2) + dd / 2,
    };
    const r = rectOf(slab);
    const sr = skylightRect(sk);
    const inside = inRect(r, sr.minX, sr.minZ, -0.1) && inRect(r, sr.maxX, sr.maxZ, -0.1);
    const free = slabHoles(this.data, slab).every(
      (h) => !(h.minX < sr.maxX && h.maxX > sr.minX && h.minZ < sr.maxZ && h.maxZ > sr.minZ),
    );
    const ok = inside && free;
    this.hover = ok ? sk : null;
    const top = slabTop(this.data, slab);
    const m = this.addGhost(new THREE.BoxGeometry(w, 0.4, dd), ok);
    m.position.set(sk.x, top, sk.z);
    this.app.setMeasure(e, `${fmt(w)} × ${fmt(dd)} m`);
  }

  commitSkylight() {
    const sk = this.hover;
    if (!sk) return;
    this.store.commit((d) => d.skylights.push({ id: uid(), ...sk }));
    this.hover = null;
    if (this.lastEvent) this.onMove(this.lastEvent);
  }
}

export const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('es-ES');

