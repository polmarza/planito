// Barra de catálogo (abajo, a todo el ancho), con dos niveles:
//  1) pestañas finas: herramientas (Construir) o estancias (Amueblar)
//  2) miniaturas grandes, sin texto: variantes de la herramienta o muebles
import { TOOLS, OPENING_PRESETS } from './tools.js';
import { CATALOG, CATEGORIES } from './furniture.js';
import { thumb, thumbs } from './thumbs.js';

const icon = (id) => TOOLS.find((t) => t !== 'sep' && t.id === id)?.icon || '';
const key = (id) => TOOLS.find((t) => t !== 'sep' && t.id === id)?.key || '';

// Cada variante indica qué estilo de `view` fija al elegirla.
const opening = (tool, id, title) => ({
  id,
  title,
  set: { opening: { [tool]: OPENING_PRESETS[id] } },
  img: () => thumb(`op:${id}`, () => thumbs.opening(OPENING_PRESETS[id]), [0.35, 0.15, 1], 0.72), // casi de frente
});

export const BUILD_TABS = [
  {
    tool: 'foundation',
    label: 'Base',
    items: [{ id: 'base', title: 'Base rectangular (arrastra para dibujarla)', img: () => thumb('base', thumbs.foundation) }],
  },
  {
    tool: 'wall',
    label: 'Pared',
    items: [
      ['full', 'Pared completa', { height: null, style: 'solid' }],
      ['half', 'Media altura (1,10 m)', { height: 1.1, style: 'solid' }],
      ['low', 'Pared baja (0,50 m)', { height: 0.5, style: 'solid' }],
      ['slats-v', 'Listones verticales', { height: null, style: 'slats', slatDir: 'v' }],
      ['slats-h', 'Listones horizontales', { height: null, style: 'slats', slatDir: 'h' }],
      ['slats-half', 'Celosía a media altura', { height: 1.1, style: 'slats', slatDir: 'v' }],
    ].map(([id, title, st]) => ({
      id,
      title,
      set: { wallStyle: st },
      img: () => thumb(`wall:${id}`, () => thumbs.wall({ ...st, height: st.height || undefined })),
    })),
  },
  {
    tool: 'room',
    label: 'Habitación',
    items: [{ id: 'room', title: 'Habitación de 4 paredes (arrastra un rectángulo)', img: () => thumb('room', thumbs.room) }],
  },
  {
    tool: 'slab',
    label: 'Suelo',
    items: [{ id: 'slab', title: 'Suelo / techo (en planta 1+ hace de techo de la de abajo)', img: () => thumb('slab', thumbs.slab) }],
  },
  {
    tool: 'roof',
    label: 'Tejado',
    items: [
      { id: 'gable', title: 'Tejado a dos aguas', set: { roofStyle: { pitch: 30 } }, img: () => thumb('roof:30', () => thumbs.roof(30)) },
      { id: 'flat', title: 'Tejado plano', set: { roofStyle: { pitch: 0 } }, img: () => thumb('roof:0', () => thumbs.roof(0)) },
    ],
  },
  {
    tool: 'door',
    label: 'Puerta',
    items: [opening('door', 'door', 'Puerta'), opening('door', 'door2', 'Puerta doble'), opening('door', 'garage', 'Puerta de garaje')],
  },
  {
    tool: 'window',
    label: 'Ventana',
    items: [
      opening('window', 'window', 'Ventana'),
      opening('window', 'small', 'Ventana pequeña'),
      opening('window', 'tall', 'Ventana alta y estrecha'),
      opening('window', 'strip', 'Ventana apaisada'),
      opening('window', 'balcony', 'Balconera'),
      opening('window', 'bigwindow', 'Ventanal'),
    ],
  },
  {
    tool: 'stairs',
    label: 'Escalera',
    items: [
      { id: 'solid', title: 'Escalera maciza', set: { stairStyle: { type: 'solid' } }, img: () => thumb('st:solid', () => thumbs.stairs({ type: 'solid', rail: 'right' })) },
      { id: 'open', title: 'Escalera de zanca abierta', set: { stairStyle: { type: 'open' } }, img: () => thumb('st:open', () => thumbs.stairs({ type: 'open', rail: 'right', color: '#222325', treadColor: '#b58a5c' })) },
    ],
  },
  {
    tool: 'railing',
    label: 'Barandilla',
    items: [
      { id: 'glass', title: 'Barandilla de cristal', set: { railStyle: { style: 'glass' } }, img: () => thumb('rail:glass', () => thumbs.railing('glass')) },
      { id: 'bars', title: 'Barandilla de barrotes', set: { railStyle: { style: 'bars' } }, img: () => thumb('rail:bars', () => thumbs.railing('bars')) },
    ],
  },
  {
    tool: 'skylight',
    label: 'Claraboya',
    items: [
      [1, 1],
      [1.5, 1.5],
      [1, 2],
    ].map(([w, d]) => ({
      id: `${w}x${d}`,
      title: `Claraboya ${String(w).replace('.', ',')} × ${String(d).replace('.', ',')} m`,
      set: { skylightSize: { w, d } },
      img: () => thumb(`sky:${w}x${d}`, () => thumbs.skylight(w, d)),
    })),
  },
].map((t) => ({ ...t, icon: icon(t.tool), key: key(t.tool) }));

// iconos de las estancias (modo Amueblar)
export const CAT_ICONS = {
  bath: '<path d="M3 12h18v3a4 4 0 01-4 4H7a4 4 0 01-4-4z"/><path d="M6 12V5a2 2 0 014 0"/><path d="M7 19l-1 2M17 19l1 2"/>',
  kitchen: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 10h16"/><circle cx="9" cy="6.5" r="1"/><circle cx="15" cy="6.5" r="1"/><path d="M8 14h8"/>',
  living: '<path d="M4 11V8a2 2 0 012-2h12a2 2 0 012 2v3"/><path d="M2 12a2 2 0 014 0v2h12v-2a2 2 0 014 0v5H2z"/><path d="M5 17v2M19 17v2"/>',
  bed: '<path d="M3 19v-9M3 14h18v5"/><path d="M21 14v-2a3 3 0 00-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
  other: '<path d="M12 21v-7"/><path d="M12 14c-4 0-6-3-6-7 4 0 6 3 6 7z"/><path d="M12 12c0-4 2-7 6-7 0 4-2 7-6 7z"/><path d="M8 21h8"/>',
};

export const FURNISH_TABS = CATEGORIES.map(([cat, label]) => ({
  cat,
  label: label.split(' ')[0],
  icon: CAT_ICONS[cat],
  items: Object.entries(CATALOG)
    .filter(([, def]) => def.cat === cat)
    .map(([type, def]) => ({ id: type, title: `${def.name} · ${def.w} × ${def.d} m`, img: () => thumb(`f:${type}`, () => thumbs.furniture(type)) })),
}));

/**
 * Pinta la barra. state = { mode, tab, item }: pestaña e ítem activos (item null si
 * la herramienta no está en uso). Los clics llaman a onTab(tab) y onItem(tab, item).
 */
export function renderCatalog(el, state, { onTab, onItem }) {
  const tabs = state.mode === 'furnish' ? FURNISH_TABS : BUILD_TABS;
  const tabId = (t) => t.tool || t.cat;
  const current = tabs.find((t) => tabId(t) === state.tab) || tabs[0];
  el.innerHTML = '';

  const row1 = document.createElement('div');
  row1.className = 'cat-tabs';
  for (const t of tabs) {
    const b = document.createElement('button');
    b.className = 'cat-tab' + (t === current ? ' active' : '') + (t === current && state.item ? ' using' : '');
    b.title = t.key ? `${t.label} (${t.key})` : t.label;
    b.innerHTML = `<svg viewBox="0 0 24 24">${t.icon}</svg><span>${t.label}</span>`;
    b.onclick = () => onTab(t);
    row1.append(b);
  }

  const row2 = document.createElement('div');
  row2.className = 'cat-items';
  for (const it of current.items) {
    const b = document.createElement('button');
    b.className = 'cat-item' + (state.item === it.id ? ' active' : '');
    b.title = it.title;
    const img = document.createElement('img');
    img.alt = it.title;
    img.src = it.img();
    b.append(img);
    b.onclick = () => onItem(current, it);
    row2.append(b);
  }
  el.append(row1, row2);
}
