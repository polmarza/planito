import { rectOf, STAIRS_DEFAULTS, WALL_DEFAULT } from './build.js';
import {
  WALL_COLORS,
  FLOOR_COLORS,
  FINISHES,
  ROOF_COLORS,
  ROOF_FINISHES,
  finishSwatch,
  applyPaint,
  roomOfFace,
  roomAt,
  facadeFaces,
  CELL,
} from './paint.js';
import { pointInLoops } from './poly.js';
import { bboxOf } from './poly.js';
import { stretchFoundation, rebuildFoundations, endpointsAt, setEndpoints, fixWalls, anchorOpenings, reprojectOpenings, setRect } from './ops.js';
import { collectionOf as collection } from './state.js';
import { CATALOG, FURN_COLORS } from './furniture.js';

const NAMES = {
  foundation: 'Base',
  wall: 'Pared',
  opening: 'Hueco',
  slab: 'Suelo / techo',
  stairs: 'Escalera',
  roof: 'Tejado a dos aguas',
  skylight: 'Claraboya',
  railing: 'Barandilla',
};

// ---------------------------------------------------------------------------
// Altura y tipo de pared, barandillas (compartido entre la herramienta y la selección)
// ---------------------------------------------------------------------------
export const WALL_PRESETS = [
  [null, 'Completa'],
  [1.1, 'Media altura'],
  [0.5, 'Baja'],
];
const SLAT_COLORS = [
  ['Roble', '#b58a5c'],
  ['Nogal', '#6f4a2f'],
  ['Pino', '#d9b88a'],
  ['Blanco', '#f2f1ee'],
  ['Gris', '#8a8f96'],
  ['Grafito', '#46484c'],
  ['Negro', '#222325'],
  ['Salvia', '#9fb09a'],
  ['Terracota', '#b86a4b'],
  ['Azul', '#4d6a8a'],
];
const STAIR_COLORS = [
  ['Piedra', '#d9d1c3'],
  ['Blanco', '#f2f1ee'],
  ['Hormigón', '#a9a59e'],
  ['Roble', '#b58a5c'],
  ['Nogal', '#6f4a2f'],
  ['Pino', '#d9b88a'],
  ['Gris', '#8a8f96'],
  ['Grafito', '#46484c'],
  ['Negro', '#222325'],
  ['Terracota', '#b86a4b'],
];
const RAIL_COLORS = [
  ['Negro', '#1c1d1f'],
  ['Grafito', '#46484c'],
  ['Acero', '#b9bdc1'],
  ['Blanco', '#f2f1ee'],
  ['Roble', '#b58a5c'],
];

function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' });
  for (const [v, label] of options) el.append(h('button', { class: v === value ? 'active' : '', onclick: () => onPick(v) }, label));
  return el;
}

function swatches(colors, value, onPick) {
  const pal = h('div', { class: 'palette' });
  for (const [name, hex] of colors) {
    const b = h('button', { class: 'swatch' + (hex === value ? ' active' : ''), title: name, onclick: () => onPick(hex) });
    b.style.background = hex;
    pal.append(b);
  }
  const custom = h('input', { type: 'color', value, title: 'Otro color' });
  custom.addEventListener('change', () => onPick(custom.value));
  pal.append(h('label', { class: 'swatch custom', title: 'Otro color' }, custom));
  return pal;
}

/**
 * Editor de altura + tipo de pared. `o` = { height, style, slatColor, slatWidth, slatGap, slatDir },
 * `patch(obj)` aplica cambios, `full` = altura hasta el techo (para el campo a medida).
 */
function wallStyleEditor(o, full, patch) {
  const box = h('div', {});
  const preset = WALL_PRESETS.find(([v]) => v === (o.height ?? null)) ? o.height ?? null : 'custom';
  box.append(
    h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Altura'), seg([...WALL_PRESETS, ['custom', 'A medida']], preset, (v) => patch({ height: v === 'custom' ? Math.round(Math.min(full, 2) * 100) / 100 : v }))),
  );
  if (preset === 'custom') {
    box.append(numberRow('Altura (m)', o.height ?? full, { min: 0.1, max: full, step: 0.05 }, (v) => patch({ height: v }, 'h')));
  }
  box.append(h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Tipo'), seg([['solid', 'Sólida'], ['slats', 'Listones']], o.style || 'solid', (v) => patch({ style: v }))));
  if (o.style === 'slats') {
    box.append(
      h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Listones'), seg([['v', 'Verticales'], ['h', 'Horizontales']], o.slatDir || 'v', (v) => patch({ slatDir: v }))),
      numberRow('Ancho listón (m)', o.slatWidth ?? 0.05, { min: 0.01, max: 0.3, step: 0.01 }, (v) => patch({ slatWidth: v }, 'sw')),
      numberRow('Separación (m)', o.slatGap ?? 0.05, { min: 0.005, max: 0.5, step: 0.01 }, (v) => patch({ slatGap: v }, 'sg')),
      h('div', { class: 'row' }, h('label', {}, 'Color de los listones')),
      swatches(SLAT_COLORS, o.slatColor || '#b58a5c', (v) => patch({ slatColor: v })),
    );
  }
  return box;
}

function railingEditor(o, patch) {
  return h(
    'div',
    {},
    numberRow('Altura (m)', o.height ?? 1, { min: 0.3, max: 2, step: 0.05 }, (v) => patch({ height: v }, 'h')),
    h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Tipo'), seg([['glass', 'Cristal'], ['bars', 'Barrotes']], o.style || 'glass', (v) => patch({ style: v }))),
    h('div', { class: 'row' }, h('label', {}, 'Color de los perfiles')),
    swatches(RAIL_COLORS, o.color || '#1c1d1f', (v) => patch({ color: v })),
  );
}

/** Panel derecho mientras se ve el plano. */
export function renderPlanPanel(el, plan, onClose) {
  el.innerHTML = '';
  const check = (label, key) => {
    const c = h('input', { type: 'checkbox' });
    c.checked = plan[key];
    c.addEventListener('change', () => {
      plan[key] = c.checked;
      plan.render();
    });
    return h('label', { class: 'check' }, c, label);
  };
  el.append(
    h('h3', {}, `Plano · planta ${plan.level}`),
    check('Cotas', 'showDims'),
    h('div', { class: 'actions' }, h('button', { onclick: () => plan.fit() }, 'Encuadrar')),
    h('div', { class: 'actions' }, h('button', { onclick: () => plan.download() }, 'Descargar SVG'), h('button', { onclick: () => window.print() }, 'Imprimir')),
    h('p', {}, 'Rueda para acercar, arrastrar para desplazar. Cambia de planta con la barra de abajo.'),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: onClose }, 'Volver al 3D (Esc)')),
  );
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

/** Fila con un campo numérico (y opcionalmente un slider enlazado). */
function numberRow(label, value, { min, max, step = 0.05, slider = false }, onChange) {
  const round = (v) => Math.round(v * 1000) / 1000;
  const input = h('input', { type: 'number', min, max, step, value: round(value) });
  let range = null;
  const apply = (raw, from) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const c = Math.max(min, Math.min(max, v));
    if (from !== input) input.value = round(c);
    if (range && from !== range) range.value = c;
    onChange(c);
  };
  input.addEventListener('input', () => apply(input.value, input));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  const row = h('div', { class: 'row' }, h('label', {}, label), input);
  if (!slider) return row;
  range = h('input', { type: 'range', min, max, step, value });
  range.addEventListener('input', () => apply(range.value, range));
  range.addEventListener('change', () => range.blur());
  return h('div', {}, row, range);
}

const infoRow = (label, value) => h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'val' }, value));

/** Paleta de colores de mueble + selector libre. */
function colorPicker(label, value, onPick) {
  const pal = h('div', { class: 'palette' });
  for (const [name, hex] of FURN_COLORS) {
    const b = h('button', { class: 'swatch' + (hex === value ? ' active' : ''), title: name, onclick: () => onPick(hex, true) });
    b.style.background = hex;
    pal.append(b);
  }
  const custom = h('input', { type: 'color', value, title: 'Otro color' });
  custom.addEventListener('input', () => onPick(custom.value, false));
  custom.addEventListener('change', () => onPick(custom.value, true));
  pal.append(h('label', { class: 'swatch custom', title: 'Otro color' }, custom));
  return h('div', { class: 'color-block' }, h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'dot', style: `background:${value}` })), pal);
}

export function renderPanel(el, { store, selection, select, fmt, wallInfo, view, duplicate, rotateFurniture, startBrush }) {
  el.innerHTML = '';
  const d = store.data;
  const s = d.settings;

  const set = (field, fn) => (v) => store.commit((dd) => fn(dd, v), `${selection?.id || 'project'}:${field}`);

  // ---- modo Amueblar
  if (view?.mode === 'furnish' && selection?.kind === 'furniture') {
    const f = store.find('furniture', selection.id);
    if (!f) return;
    const def = CATALOG[f.type];
    const paint = (key) => (hex) => store.commit((dd) => (dd.furniture.find((x) => x.id === f.id)[key] = hex), `${f.id}:${key}`);
    el.append(
      h('h3', {}, `${def.name} · planta ${f.level}`),
      infoRow('Medidas', `${fmt(def.w)} × ${fmt(def.d)} × ${fmt(def.h)} m`),
      colorPicker(def.colorName, f.color || def.color, paint('color')),
      colorPicker(def.accentName, f.accent || def.accent, paint('accent')),
      h(
        'div',
        { class: 'actions' },
        h('button', { onclick: () => rotateFurniture(-90) }, '↺ Girar'),
        h('button', { onclick: () => rotateFurniture(90) }, 'Girar ↻'),
        h('button', { onclick: () => duplicate() }, 'Duplicar'),
      ),
      h('p', {}, def.wall ? 'Arrástralo para moverlo: se pega a la pared más cercana y se alinea con los muebles vecinos.' : 'Arrástralo para moverlo · R para girarlo (Shift+R, 45°).'),
      h(
        'div',
        { class: 'actions' },
        h('button', { onclick: () => select(null) }, 'Cerrar'),
        h('button', { class: 'danger', onclick: () => { store.remove('furniture', f.id); select(null); } }, 'Eliminar'),
      ),
    );
    return;
  }
  // sin selección, el panel no se muestra (los ajustes del proyecto están en ⚙ → Proyecto)
  if (!selection) return;

  if (selection.kind === 'room') return roomPanel(el, { store, selection, select, fmt, startBrush });

  const e = store.find(selection.kind, selection.id);
  if (!e) return;
  const upd = (field, fn) => set(field, (dd, v) => fn(dd[collection(selection.kind)].find((x) => x.id === e.id), v, dd));

  el.append(h('h3', {}, NAMES[selection.kind] + (e.level !== undefined ? ` · planta ${e.level}` : '')));

  switch (selection.kind) {
    case 'foundation': {
      const b = bboxOf(e.points);
      const rect = e.points.length === 4 && !e.holes?.length;
      const resize = (axis) =>
        upd(axis, (f, v, dd) => {
          stretchFoundation(f, axis, v);
          rebuildFoundations(dd, f.id);
        });
      el.append(
        numberRow(rect ? 'Ancho' : 'Ancho total', b.maxX - b.minX, { min: 0.5, max: s.lotW, step: 0.25 }, resize('x')),
        numberRow(rect ? 'Largo' : 'Largo total', b.maxZ - b.minZ, { min: 0.5, max: s.lotD, step: 0.25 }, resize('z')),
        numberRow('Elevar base', s.baseHeight, { min: 0, max: 2, step: 0.05, slider: true }, set('base', (dd, v) => (dd.settings.baseHeight = v))),
        h('p', {}, 'Arrastra las esquinas o los lados para cambiar la forma, o la base para moverla. La altura es común a todas las bases.'),
      );
      break;
    }
    case 'wall': {
      const info = wallInfo(d, e);
      el.append(
        numberRow('Longitud', info.len, { min: 0.2, max: 100, step: 0.05 }, upd('len', (w, v, dd) => {
          // el extremo final se desplaza y arrastra las paredes conectadas a él
          const refs = endpointsAt(dd, w.level, w.b);
          const anchors = anchorOpenings(dd, refs.map((r) => r.id).filter((id) => id !== w.id));
          setEndpoints(dd, refs, [w.a[0] + info.dir[0] * v, w.a[1] + info.dir[1] * v]);
          reprojectOpenings(dd, anchors);
          fixWalls(dd);
        })),
        numberRow('Grosor', e.thickness, { min: 0.05, max: 0.8, step: 0.01 }, upd('t', (w, v) => (w.thickness = v))),
        wallStyleEditor(e, info.full, (p, key) =>
          store.commit((dd) => {
            const w = dd.walls.find((x) => x.id === e.id);
            for (const [k, v] of Object.entries(p)) {
              if (v === null || v === 'solid') delete w[k];
              else w[k] = v;
            }
            if (p.style === 'slats') {
              // una celosía no lleva huecos
              dd.openings = dd.openings.filter((o) => o.wallId !== w.id);
              w.slatColor ??= '#b58a5c';
            }
          }, key ? `${e.id}:${key}` : null),
        ),
        h('p', {}, e.style === 'slats' ? 'Las paredes de listones no admiten puertas ni ventanas.' : 'Arrastra los extremos para estirarla o la pared para moverla.'),
      );
      if (e.style !== 'slats') el.append(wallPaintSection({ store, selection, select, e, startBrush }));
      break;
    }
    case 'railing': {
      el.append(
        infoRow('Longitud', `${fmt(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]))} m`),
        railingEditor(e, (p, key) => store.commit((dd) => Object.assign(dd.railings.find((x) => x.id === e.id), p), key ? `${e.id}:${key}` : null)),
        h('p', {}, 'Arrastra los extremos para estirarla o la barandilla para moverla.'),
      );
      break;
    }
    case 'opening': {
      const w = d.walls.find((x) => x.id === e.wallId);
      const info = w ? wallInfo(d, w) : { len: 10, height: 3 };
      el.firstChild.textContent = { door: 'Puerta', garage: 'Puerta de garaje', window: 'Ventana' }[e.kind];
      el.append(
        numberRow('Ancho', e.width, { min: 0.3, max: info.len, step: 0.05 }, upd('w', (o, v) => (o.width = v))),
        numberRow('Alto', e.height, { min: 0.3, max: info.height, step: 0.05 }, upd('h', (o, v) => (o.height = v))),
      );
      if (e.kind === 'window') {
        el.append(numberRow('Antepecho', e.sill, { min: 0, max: info.height - 0.3, step: 0.05 }, upd('s', (o, v) => (o.sill = v))));
      }
      el.append(
        numberRow('Posición', e.pos, { min: e.width / 2, max: info.len - e.width / 2, step: 0.05 }, upd('p', (o, v) => (o.pos = v))),
      );
      if (e.kind === 'door') {
        const right = e.hinge === 'right';
        el.append(
          numberRow('Mostrar abierta (°)', e.open || 0, { min: 0, max: 90, step: 5, slider: true }, upd('open', (o, v) => (o.open = v))),
          h(
            'div',
            { class: 'actions stack' },
            h('button', { onclick: () => upd('hinge', (o) => (o.hinge = right ? 'left' : 'right'))() }, 'Cambiar lado del tirador'),
            h('button', { onclick: () => upd('swing', (o) => (o.swing = o.swing === -1 ? 1 : -1))() }, 'Abrir hacia el otro lado'),
          ),
        );
      }
      el.append(h('p', {}, 'Arrastra el hueco para moverlo a lo largo de la pared.'));
      break;
    }
    case 'slab':
    case 'roof': {
      const r = rectOf(e);
      const size = (axis) =>
        upd(axis, (x, v) => {
          const q = rectOf(x);
          if (axis === 'x') setRect(x, { ...q, maxX: q.minX + v });
          else setRect(x, { ...q, maxZ: q.minZ + v });
        });
      el.append(
        numberRow('Ancho', r.maxX - r.minX, { min: 0.5, max: s.lotW, step: 0.25 }, size('x')),
        numberRow('Largo', r.maxZ - r.minZ, { min: 0.5, max: s.lotD, step: 0.25 }, size('z')),
      );
      if (selection.kind === 'roof') {
        el.append(
          numberRow('Pendiente (°)', e.pitch, { min: 0, max: 60, step: 1, slider: true }, upd('pitch', (x, v) => (x.pitch = v))),
          numberRow('Alero', e.overhang, { min: 0, max: 1.5, step: 0.05 }, upd('ov', (x, v) => (x.overhang = v))),
          h('div', { class: 'actions' }, h('button', { onclick: () => upd('ridge', (x) => (x.ridge = x.ridge === 'x' ? 'z' : 'x'))() }, 'Girar cumbrera')),
          sectionTitle('Acabado'),
          finishPicker(ROOF_FINISHES, e.finish || 'plain', e.color || '#b4664a', (f) =>
            store.commit((dd) => applyPaint(dd, { kind: 'roof', id: e.id }, { color: e.color || '#b4664a', finish: f })),
          ),
          paintPalette(ROOF_COLORS, e.color || '#b4664a', (hex, key) =>
            store.commit((dd) => applyPaint(dd, { kind: 'roof', id: e.id }, { color: hex, finish: e.finish || 'plain' }), key),
          ),
        );
      } else {
        const n = d.skylights.filter((k) => k.slabId === e.id).length;
        el.append(infoRow('Claraboyas', String(n)));
      }
      el.append(h('p', {}, 'Arrastra las esquinas o los lados para redimensionar, o el elemento para moverlo.'));
      break;
    }
    case 'stairs': {
      const o = { ...STAIRS_DEFAULTS, ...e };
      const patch = (p, key) => store.commit((dd) => Object.assign(dd.stairs.find((x) => x.id === e.id), p), key ? `${e.id}:${key}` : null);
      const check = h('input', { type: 'checkbox' });
      check.checked = !!o.holeRail;
      check.addEventListener('change', () => patch({ holeRail: check.checked }));
      el.append(
        numberRow('Ancho', e.width, { min: 0.6, max: 3, step: 0.05 }, upd('w', (x, v) => (x.width = v))),
        numberRow('Largo', e.length, { min: 2, max: 8, step: 0.25 }, upd('l', (x, v) => (x.length = v))),
        h('div', { class: 'actions' }, h('button', { onclick: () => upd('rot', (x) => (x.rot = (x.rot + 1) % 4))() }, 'Girar 90° (R)')),
        h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Tipo'), seg([['solid', 'Maciza'], ['open', 'Zanca abierta']], o.type, (v) => patch({ type: v }))),
        h('div', { class: 'row' }, h('label', {}, o.type === 'open' ? 'Zancas' : 'Estructura')),
        swatches(STAIR_COLORS, o.color, (v) => patch({ color: v })),
        h('div', { class: 'row' }, h('label', {}, 'Peldaños')),
        swatches(STAIR_COLORS, o.treadColor, (v) => patch({ treadColor: v })),
        h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Barandilla'), seg([['none', 'No'], ['left', 'Izq.'], ['right', 'Dcha.'], ['both', 'Ambas']], o.rail, (v) => patch({ rail: v }))),
      );
      if (o.rail !== 'none' || o.holeRail) {
        el.append(
          h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Estilo'), seg([['glass', 'Cristal'], ['bars', 'Barrotes']], o.railStyle, (v) => patch({ railStyle: v }))),
          numberRow('Altura (m)', o.railHeight, { min: 0.6, max: 1.3, step: 0.05 }, (v) => patch({ railHeight: v }, 'rh')),
          h('div', { class: 'row' }, h('label', {}, 'Color de los perfiles')),
          swatches(RAIL_COLORS, o.railColor, (v) => patch({ railColor: v })),
        );
      }
      el.append(
        h('label', { class: 'check', title: 'Protege el hueco de la escalera en la planta de arriba' }, check, 'Barandilla alrededor del hueco (arriba)'),
        h('p', {}, 'Izquierda y derecha, mirando escalera arriba. Arrastra la escalera para moverla.'),
      );
      break;
    }
    case 'skylight': {
      el.append(
        numberRow('Ancho', e.w, { min: 0.4, max: 6, step: 0.1 }, upd('w', (x, v) => (x.w = v))),
        numberRow('Largo', e.d, { min: 0.4, max: 6, step: 0.1 }, upd('d', (x, v) => (x.d = v))),
        h('p', {}, 'Arrastra la claraboya para moverla dentro de su techo.'),
      );
      break;
    }
  }

  el.append(
    h(
      'div',
      { class: 'actions' },
      h('button', { onclick: () => select(null) }, 'Cerrar'),
      h('button', { class: 'danger', onclick: () => { store.remove(selection.kind, selection.id); select(null); } }, 'Eliminar'),
    ),
  );
}


// ---------------------------------------------------------------------------
// Pintura en los paneles
// ---------------------------------------------------------------------------
const sectionTitle = (text) => h('div', { class: 'section' }, text);

/** Paleta con selector libre. onPick(hex, key) — key agrupa los cambios del selector libre. */
function paintPalette(colors, current, onPick) {
  const pal = h('div', { class: 'palette' });
  for (const [name, hex] of colors) {
    const b = h('button', { class: 'swatch' + (hex === current ? ' active' : ''), title: name, onclick: () => onPick(hex) });
    b.style.background = hex;
    pal.append(b);
  }
  const custom = h('input', { type: 'color', value: current || '#ffffff', title: 'Otro color' });
  custom.addEventListener('input', () => onPick(custom.value, 'custom-color'));
  pal.append(h('label', { class: 'swatch custom', title: 'Otro color' }, custom));
  return pal;
}

function finishPicker(finishes, current, color, onPick) {
  const fin = h('div', { class: 'finishes' });
  for (const [id, label] of finishes) {
    const sw = finishSwatch(id, color);
    const chip = h('span', { class: 'chip' });
    chip.style.background = sw ? `url(${sw}) center/cover` : color;
    fin.append(h('button', { class: current === id ? 'active' : '', onclick: () => onPick(id) }, chip, label));
  }
  return fin;
}

/** Pintura de una pared: la cara pulsada (o la otra), la estancia, la fachada y el pincel. */
function wallPaintSection({ store, selection, select, e, startBrush }) {
  const d = store.data;
  const side = selection.side || 'L';
  const label = (sd) => {
    const r = roomOfFace(d, e.id, sd);
    return r ? r.name : 'Exterior';
  };
  const color = e.colors?.[side] || WALL_DEFAULT;
  const room = roomOfFace(d, e.id, side);
  const paintFaces = (faces, hex, key) => store.commit((dd) => applyPaint(dd, { kind: 'faces', faces }, { color: hex }), key ? `${e.id}:${side}:${key}` : null);
  return h(
    'div',
    {},
    sectionTitle('Pintura'),
    h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Cara'), seg([['L', label('L')], ['R', label('R')]], side, (v) => select({ ...selection, side: v }))),
    paintPalette(WALL_COLORS, color, (hex, key) => paintFaces([{ id: e.id, side }], hex, key)),
    h(
      'div',
      { class: 'actions' },
      room
        ? h('button', { title: 'Todas las caras interiores de ' + room.name, onclick: () => paintFaces(room.walls, color) }, 'Toda la estancia')
        : h('button', { title: 'Todas las caras exteriores', onclick: () => paintFaces(facadeFaces(d), color) }, 'Toda la fachada'),
      h('button', { class: 'brush', onclick: () => startBrush('wall', { wallColor: color }) }, '🖌 Pincel'),
    ),
  );
}

/** Panel de una estancia (al pulsar su suelo): suelo, paredes interiores y techo. */
function roomPanel(el, { store, selection, select, fmt, startBrush }) {
  const d = store.data;
  const room = roomAt(d, selection.level, selection.x, selection.z);
  if (!room) return;
  const seed = d.floorPaint.find((f) => f.level === room.level && pointInLoops([room.points], f.x, f.z));
  const floor = { color: seed?.color || '#b58a5c', finish: seed?.finish || 'wood' };
  const ceil = d.ceilingPaint.find((f) => f.level === room.level && pointInLoops([room.points], f.x, f.z));
  const [lx, lz] = room.label;
  const target = (kind) => ({ kind, level: room.level, x: lx, z: lz, room });
  const paint = (kind, p, key) => store.commit((dd) => applyPaint(dd, target(kind), p), key ? `room:${room.id}:${kind}:${key}` : null);
  const wallColors = room.walls.map((f) => d.walls.find((w) => w.id === f.id)?.colors?.[f.side] || WALL_DEFAULT);
  const wallColor = wallColors.every((c) => c === wallColors[0]) ? wallColors[0] : null;
  const zones = Object.keys(d.floorCells).some((k) => {
    const [l, i, j] = k.split(':').map(Number);
    return l === room.level && pointInLoops([room.points], (i + 0.5) * CELL, (j + 0.5) * CELL);
  });

  el.append(
    h('h3', {}, `${room.name} · planta ${room.level}`),
    h('div', { class: 'row' }, h('label', {}, 'Superficie'), h('span', { class: 'val' }, `${fmt(room.area)} m²`)),
    sectionTitle('Suelo'),
    finishPicker(FINISHES, seed ? floor.finish : null, floor.color, (f) => paint('floor', { color: floor.color, finish: f, clearZones: true })),
    paintPalette(FLOOR_COLORS, seed ? floor.color : null, (hex, key) => paint('floor', { color: hex, finish: floor.finish, clearZones: !key }, key)),
    h(
      'div',
      { class: 'actions' },
      h('button', { title: 'Traza un rectángulo sobre el suelo', onclick: () => startBrush('zone', { floorColor: floor.color, finish: floor.finish }) }, '▭ Pintar una zona'),
      seed || zones ? h('button', { class: 'danger', onclick: () => paint('floor', { erase: true, clearZones: true }) }, 'Quitar') : '',
    ),
    sectionTitle('Paredes'),
    paintPalette(WALL_COLORS, wallColor, (hex, key) => store.commit((dd) => applyPaint(dd, { kind: 'faces', faces: room.walls }, { color: hex }), key ? `room:${room.id}:walls` : null)),
    sectionTitle('Techo'),
    paintPalette(WALL_COLORS, ceil?.color || null, (hex, key) => paint('ceiling', { color: hex }, key)),
    h('p', {}, 'El techo se ve desde dentro (vista interior o render).'),
    h(
      'div',
      { class: 'actions' },
      h('button', { onclick: () => select(selection.base) }, selection.base?.kind === 'foundation' ? 'Editar la base' : 'Editar el forjado'),
      h('button', { onclick: () => select(null) }, 'Cerrar'),
    ),
  );
}

/** Panel del pincel: modo, color (y acabado para zonas) y goma. */
export function renderBrushPanel(el, ctrl, onChange, onExit) {
  el.innerHTML = '';
  const s = ctrl.state;
  const set = (p, rerender = true) => {
    Object.assign(s, p);
    ctrl.hoverKey = '__refresh';
    onChange(rerender);
  };
  const zone = s.mode === 'zone';
  el.append(
    h('h3', {}, '🖌 Pincel'),
    h('div', { class: 'seg-row' }, h('span', { class: 'seg-label' }, 'Pintar'), seg([['wall', 'Paredes'], ['zone', 'Zona de suelo']], s.mode, (v) => set({ mode: v }))),
  );
  if (zone) el.append(finishPicker(FINISHES, s.finish, s.floorColor, (f) => set({ finish: f })));
  const key = zone ? 'floorColor' : 'wallColor';
  el.append(
    paintPalette(zone ? FLOOR_COLORS : WALL_COLORS, s.erase ? null : s[key], (hex, k) => set({ [key]: hex, erase: false }, !k)),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: s.erase ? 'danger active' : '', onclick: () => set({ erase: !s.erase }) }, s.erase ? 'Borrando…' : 'Goma'),
      h('button', { onclick: onExit }, 'Terminar (Esc)'),
    ),
    h(
      'p',
      {},
      zone
        ? 'Arrastra un rectángulo sobre el suelo: al soltar, esa zona se pinta.'
        : 'Clic en cualquier cara de pared, interior o exterior. Si ya estaba pintada, se sustituye el color. Shift+clic: toda la estancia (o la fachada).',
    ),
  );
}

/** Ajustes del proyecto (ventana emergente desde ⚙ → Proyecto). */
export function renderProjectSettings(el, store) {
  el.innerHTML = '';
  const d = store.data;
  const s = d.settings;
  const set = (field, fn) => (v) => store.commit((dd) => fn(dd, v), `project:${field}`);
  el.append(
    numberRow('Altura de la base', s.baseHeight, { min: 0, max: 2, step: 0.05, slider: true }, set('base', (dd, v) => (dd.settings.baseHeight = v))),
    numberRow('Altura de techo', s.levelHeight - s.slabThickness, { min: 2.2, max: 4.8, step: 0.05, slider: true }, set('lh', (dd, v) => (dd.settings.levelHeight = v + dd.settings.slabThickness))),
    numberRow('Grosor de pared nueva', s.wallThickness, { min: 0.08, max: 0.6, step: 0.01 }, set('wt', (dd, v) => (dd.settings.wallThickness = v))),
    numberRow('Solar: ancho (m)', s.lotW, { min: 10, max: 200, step: 1 }, set('lotW', (dd, v) => (dd.settings.lotW = v))),
    numberRow('Solar: largo (m)', s.lotD, { min: 10, max: 200, step: 1 }, set('lotD', (dd, v) => (dd.settings.lotD = v))),
    h(
      'p',
      {},
      `${d.walls.length} paredes · ${d.openings.length} huecos · ${d.stairs.length} escaleras · ${d.roofs.length} tejados · ${d.furniture.length} muebles`,
    ),
  );
}
