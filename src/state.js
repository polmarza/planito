// Modelo de datos del proyecto + historial (deshacer/rehacer) + autoguardado.
//
// Todas las medidas están en metros. El plano del suelo es XZ y la Y es la altura.
//   foundations: { id, points:[[x,z]...], holes:[[[x,z]...]] } (bases, planta 0; se fusionan al solaparse)
//   slabs:       { id, level, x0, z0, x1, z1 }                (suelos / techos planos)
//   walls:       { id, level, a:[x,z], b:[x,z], thickness }
//   openings:    { id, wallId, kind:'door'|'window', pos, width, height, sill }
//                pos = distancia desde el extremo `a` de la pared hasta el centro del hueco
//   stairs:      { id, level, x, z, rot, width, length }       (suben de `level` a `level+1`)
//   roofs:       { id, level, x0, z0, x1, z1, pitch, overhang, ridge:'x'|'z' }
//   skylights:   { id, slabId, x, z, w, d }                     (claraboyas, hueco en una losa)
//   walls[].colors: { L?: '#hex', R?: '#hex' }   pintura de cada cara (L = izquierda de a→b)
//   floorPaint:  { id, level, x, z, color, finish }             (suelo de la estancia que contiene x,z)
//   floorCells:  { 'nivel:i:j': { color, finish } }             (suelo pintado a pincel, celdas de 0,5 m)
//   ceilingPaint:{ id, level, x, z, color }                     (techo de la estancia que contiene x,z)
//   roofs[].color / roofs[].finish                              (pintura del tejado)
//   furniture:   { id, type, level, x, z, rot, color, accent }  (muebles; rot en grados)
//   walls[].height / style ('solid'|'slats') / slatColor, slatWidth, slatGap, slatDir ('v'|'h')
//   railings:    { id, level, a:[x,z], b:[x,z], height, style:'glass'|'bars', color }

const STORAGE_KEY = 'build3d:project';

export const DEFAULT_SETTINGS = {
  baseHeight: 0.5, // altura de la base (planta 0 sobre la base)
  levelHeight: 3.0, // de suelo a suelo
  wallThickness: 0.2,
  slabThickness: 0.2,
  lotW: 40, // tamaño del solar (cuadrícula), centrado en el origen
  lotD: 40,
};

export function emptyProject() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    foundations: [],
    slabs: [],
    walls: [],
    openings: [],
    stairs: [],
    roofs: [],
    skylights: [],
    floorPaint: [],
    ceilingPaint: [],
    floorCells: {},
    furniture: [],
    railings: [],
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

function normalize(data) {
  const base = emptyProject();
  const out = { ...base, ...data, settings: { ...base.settings, ...(data?.settings || {}) } };
  for (const k of ['foundations', 'slabs', 'walls', 'openings', 'stairs', 'roofs', 'skylights', 'floorPaint', 'ceilingPaint', 'furniture', 'railings']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!out.floorCells || typeof out.floorCells !== 'object') out.floorCells = {};
  // formato antiguo: bases rectangulares
  out.foundations = out.foundations.map((f) =>
    f.points
      ? { holes: [], ...f }
      : {
          id: f.id,
          points: [
            [Math.min(f.x0, f.x1), Math.min(f.z0, f.z1)],
            [Math.max(f.x0, f.x1), Math.min(f.z0, f.z1)],
            [Math.max(f.x0, f.x1), Math.max(f.z0, f.z1)],
            [Math.min(f.x0, f.x1), Math.max(f.z0, f.z1)],
          ],
          holes: [],
        },
  );
  return out;
}

export class Store {
  constructor() {
    const saved = this.load();
    this.fresh = !saved; // primera visita
    this.data = saved || emptyProject();
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.lastKey = null;
    this.lastTime = 0;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  /**
   * Aplica un cambio. `key` agrupa cambios seguidos (p. ej. arrastrar un slider)
   * en un único paso de deshacer.
   */
  commit(mutator, key = null) {
    const now = performance.now();
    const coalesce = key && key === this.lastKey && now - this.lastTime < 1200;
    if (!coalesce) {
      this.undoStack.push(JSON.stringify(this.data));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastKey = key;
    this.lastTime = now;
    mutator(this.data);
    this.save();
    this.emit();
  }

  /**
   * Gestos de arrastre: cada movimiento se aplica sobre una copia del estado
   * inicial (sin ensuciar el historial) y al soltar queda un único paso de deshacer.
   */
  startGesture() {
    this.gestureBase = JSON.stringify(this.data);
  }

  updateGesture(mutator) {
    if (!this.gestureBase) return;
    this.data = JSON.parse(this.gestureBase);
    mutator(this.data);
    this.emit();
  }

  endGesture(finalize = null) {
    if (!this.gestureBase) return;
    const base = this.gestureBase;
    this.gestureBase = null;
    if (finalize) finalize(this.data);
    if (JSON.stringify(this.data) !== base) {
      this.undoStack.push(base);
      this.redoStack = [];
      this.lastKey = null;
      this.save();
    }
    this.emit();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this.undoStack.pop());
    this.lastKey = null;
    this.save();
    this.emit();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.data));
    this.data = JSON.parse(this.redoStack.pop());
    this.lastKey = null;
    this.save();
    this.emit();
  }

  replace(data) {
    this.commit((d) => {
      Object.keys(d).forEach((k) => delete d[k]);
      Object.assign(d, normalize(data));
    });
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* sin almacenamiento disponible: no pasa nada */
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  /** Busca un elemento por tipo e id. */
  find(type, id) {
    const list = this.data[collectionOf(type)];
    return list ? list.find((e) => e.id === id) : null;
  }

  /** Elimina un elemento y todo lo que depende de él. */
  remove(type, id) {
    this.commit((d) => {
      const col = collectionOf(type);
      d[col] = d[col].filter((e) => e.id !== id);
      if (type === 'wall') d.openings = d.openings.filter((o) => o.wallId !== id);
      if (type === 'slab') d.skylights = d.skylights.filter((s) => s.slabId !== id);
    });
  }
}

export function collectionOf(type) {
  return {
    foundation: 'foundations',
    slab: 'slabs',
    wall: 'walls',
    opening: 'openings',
    stairs: 'stairs',
    roof: 'roofs',
    skylight: 'skylights',
    furniture: 'furniture',
    railing: 'railings',
  }[type];
}
