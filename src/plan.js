// Vista en plano 2D (SVG) con cotas: paredes, huecos, estancias con su
// superficie, escaleras, claraboyas, tejados y pilares.
// Coordenadas: 1 unidad SVG = 1 m. El eje X del mundo es X y el Z es Y.
import { rectOf, stairsRect, skylightRect, wallInfo, stairsRailSpecs, stairsToWorld } from './build.js';
import { findRooms, bbox, isRect } from './rooms.js';
import { pointInLoops } from './poly.js';
import { CELL } from './paint.js';
import { CATALOG, footprint } from './furniture.js';

const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const P = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];

const C = {
  ink: '#26241f',
  wall: '#2f2d29',
  muted: '#8a857c',
  dim: '#2f6fed',
  room: '#fbfaf7',
  base: '#d9d3c7',
  baseLine: '#b9b3a8',
  hint: '#c9c3b8',
  col: '#26241f',
};

const LINE = 'vector-effect="non-scaling-stroke"';
const FONT = 'font-family="Inter, system-ui, sans-serif"';

export class PlanView {
  constructor({ store, onClose }) {
    this.store = store;
    this.onClose = onClose;
    this.root = document.getElementById('plan');
    this.svg = document.getElementById('plan-svg');
    this.level = 0;
    this.showDims = true;
    this.view = null; // { x, y, w, h } del viewBox
    this.bindEvents();
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(level) {
    this.level = level;
    this.root.hidden = false;
    this.view = null;
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.onClose?.();
  }

  /** Cambiar de planta desde la barra inferior (se conserva el encuadre). */
  setLevel(level) {
    this.level = level;
    if (this.isOpen) this.render();
  }

  /** Desplaza el dibujo una fracción de lo que se ve (flechas del teclado). */
  panBy(fx, fy) {
    if (!this.view) return;
    this.view = { ...this.view, x: this.view.x + this.view.w * fx, y: this.view.y + this.view.h * fy };
    this.applyView();
  }

  fit() {
    this.view = null;
    this.render();
  }

  bindEvents() {
    // zoom con la rueda (hacia el cursor) y desplazamiento arrastrando
    this.svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.svg.getBoundingClientRect();
        const k = Math.exp(e.deltaY * 0.0015);
        const v = this.view;
        const scale = Math.max(v.w / r.width, v.h / r.height);
        const ox = v.x + (v.w - r.width * scale) / 2;
        const oy = v.y + (v.h - r.height * scale) / 2;
        const mx = ox + (e.clientX - r.left) * scale;
        const my = oy + (e.clientY - r.top) * scale;
        this.view = { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, w: v.w * k, h: v.h * k };
        this.applyView();
      },
      { passive: false },
    );
    let drag = null;
    this.svg.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, v: { ...this.view } };
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = this.svg.getBoundingClientRect();
      const scale = Math.max(drag.v.w / r.width, drag.v.h / r.height);
      this.view = { ...drag.v, x: drag.v.x - (e.clientX - drag.x) * scale, y: drag.v.y - (e.clientY - drag.y) * scale };
      this.applyView();
    });
    this.svg.addEventListener('pointerup', () => (drag = null));
    window.addEventListener('keydown', (e) => {
      if (this.isOpen && e.key === 'Escape') this.close();
    });
  }

  applyView() {
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  download() {
    const clone = this.svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', this.fitBox.join(' '));
    clone.setAttribute('width', `${this.fitBox[2] * 50}`);
    clone.setAttribute('height', `${this.fitBox[3] * 50}`);
    const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plano-planta-${this.level}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  render() {
    const d = this.store.data;
    const L = this.level;
    const showDims = this.showDims;

    const walls = d.walls.filter((w) => w.level === L);
    const rooms = findRooms(d, L);
    const out = [];

    // ---- extensión del dibujo
    const pts = [
      ...walls.flatMap((w) => [w.a, w.b]),
      ...(L === 0 ? d.foundations.flatMap((f) => f.points) : []),
      ...d.slabs.filter((s) => s.level === L).flatMap((s) => [[s.x0, s.z0], [s.x1, s.z1]]),
      ...d.roofs.filter((r) => r.level === L || r.level === L + 1).flatMap((r) => [[r.x0, r.z0], [r.x1, r.z1]]),
    ];
    const B = pts.length ? bbox(pts) : { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
    const pad = 3;
    // abajo queda sitio para el título y la escala gráfica
    this.fitBox = [B.minX - pad, B.minZ - pad, B.maxX - B.minX + 2 * pad, B.maxZ - B.minZ + 2 * pad + 1.5];
    if (!this.view) {
      // encuadre con margen para las barras flotantes (arriba, abajo y el panel derecho)
      const [x, y, w, h] = this.fitBox;
      this.view = { x: x - w * 0.15, y: y - h * 0.12, w: w * 1.45, h: h * 1.3 };
    }

    // mismo fondo y cuadrícula del solar que en la vista 3D
    const { lotW, lotD } = d.settings;
    out.push(`<rect x="${this.fitBox[0] - 500}" y="${this.fitBox[1] - 500}" width="1000" height="1000" fill="#eceae6"/>`);
    out.push(
      `<defs><pattern id="g-minor" width="0.5" height="0.5" patternUnits="userSpaceOnUse"><path d="M0.5 0H0V0.5" fill="none" stroke="#5d574d" stroke-opacity="0.12" stroke-width="1" ${LINE}/></pattern>` +
        `<pattern id="g-major" width="5" height="5" patternUnits="userSpaceOnUse" x="${-lotW / 2}" y="${-lotD / 2}"><rect width="5" height="5" fill="url(#g-minor)"/><path d="M5 0H0V5" fill="none" stroke="#5d574d" stroke-opacity="0.28" stroke-width="1" ${LINE}/></pattern></defs>`,
    );
    out.push(`<rect x="${-lotW / 2}" y="${-lotD / 2}" width="${lotW}" height="${lotD}" fill="url(#g-major)" stroke="#5d574d" stroke-opacity="0.5" stroke-width="1.5" ${LINE}/>`);

    // ---- base / forjado de esta planta
    if (L === 0) {
      for (const f of d.foundations) {
        const loops = [f.points, ...(f.holes || [])].map((l) => `M${l.map(P).join('L')}Z`).join('');
        out.push(`<path d="${loops}" fill="${C.base}" fill-rule="evenodd" stroke="${C.baseLine}" stroke-width="1" ${LINE}/>`);
      }
    } else {
      for (const s of d.slabs.filter((x) => x.level === L)) {
        const r = rectOf(s);
        out.push(`<rect x="${r.minX}" y="${r.minZ}" width="${r.maxX - r.minX}" height="${r.maxZ - r.minZ}" fill="${C.base}" stroke="${C.baseLine}" stroke-width="1" ${LINE}/>`);
      }
      // paredes de la planta de abajo, como referencia
      for (const w of d.walls.filter((x) => x.level === L - 1)) {
        out.push(`<line x1="${w.a[0]}" y1="${w.a[1]}" x2="${w.b[0]}" y2="${w.b[1]}" stroke="${C.hint}" stroke-width="1" stroke-dasharray="4 3" ${LINE}/>`);
      }
    }

    // ---- estancias
    for (const r of rooms) {
      // color del suelo pintado (suave)
      const seed = d.floorPaint.find((f) => f.level === L && pointInLoops([r.points], f.x, f.z));
      const fill = seed ? `fill="${seed.color}" fill-opacity="0.35"` : `fill="${C.room}"`;
      out.push(`<path d="M${r.points.map(P).join('L')}Z" ${fill}/>`);
    }
    for (const [k, v] of Object.entries(d.floorCells)) {
      const [l, i, j] = k.split(':').map(Number);
      if (l !== L) continue;
      out.push(`<rect x="${i * CELL}" y="${j * CELL}" width="${CELL}" height="${CELL}" fill="${v.color}" fill-opacity="0.35"/>`);
    }

    // ---- muebles (huella; los colgados, discontinuos)
    for (const f of d.furniture) {
      const def = CATALOG[f.type];
      if (f.level !== L || !def) continue;
      const fp = footprint(f);
      const dash = def.layer === 'high' ? 'stroke-dasharray="4 3" fill="none"' : `fill="${def.layer === 'rug' ? '#efece6' : '#f7f5f0'}"`;
      out.push(`<path d="M${fp.map(P).join('L')}Z" ${dash} stroke="${C.muted}" stroke-width="1" ${LINE}/>`);
    }

    // ---- paredes (con prolongación en las esquinas, como en 3D)
    const shares = (w, p) =>
      walls.some((o) => o !== w && (Math.hypot(o.a[0] - p[0], o.a[1] - p[1]) < 1e-3 || Math.hypot(o.b[0] - p[0], o.b[1] - p[1]) < 1e-3));
    const frame = (w) => {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const u = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const n = [-u[1], u[0]]; // izquierda de a→b (lado 'L' de las estancias)
      return { len, u, n };
    };
    for (const w of walls) {
      const { u, n } = frame(w);
      const t = w.thickness / 2;
      const a = add(w.a, u, shares(w, w.a) ? -t : 0);
      const b = add(w.b, u, shares(w, w.b) ? t : 0);
      const outline = `M${P(add(a, n, t))}L${P(add(b, n, t))}L${P(add(b, n, -t))}L${P(add(a, n, -t))}Z`;
      const info = wallInfo(d, w);
      if (w.style === 'slats') {
        // celosía: contorno fino con los listones marcados
        out.push(`<path d="${outline}" fill="#ffffff" stroke="${C.ink}" stroke-width="1" ${LINE}/>`);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const step = Math.max(0.05, (w.slatWidth ?? 0.05) + (w.slatGap ?? 0.05));
        if ((w.slatDir || 'v') === 'v') {
          for (let k = step / 2; k < len; k += step) {
            const p = add(a, u, k);
            out.push(`<line x1="${add(p, n, -t)[0]}" y1="${add(p, n, -t)[1]}" x2="${add(p, n, t)[0]}" y2="${add(p, n, t)[1]}" stroke="${C.ink}" stroke-width="1" ${LINE}/>`);
          }
        }
      } else if (info.height < info.full - 0.01) {
        // pared baja o de media altura: gris, con su altura
        out.push(`<path d="${outline}" fill="#a8a39a"/>`);
        if (showDims) out.push(textAt(add([(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], n, -(t + 0.2)), `h ${fmt(info.height)}`, angleOf(u), 0.18, C.muted));
      } else {
        out.push(`<path d="${outline}" fill="${C.wall}"/>`);
      }
    }

    // ---- barandillas
    for (const r of (d.railings || []).filter((x) => x.level === L)) {
      const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1;
      const u = [(r.b[0] - r.a[0]) / len, (r.b[1] - r.a[1]) / len];
      const n = [-u[1], u[0]];
      for (const k of [-0.03, 0.03]) {
        const p = add(r.a, n, k);
        const q = add(r.b, n, k);
        out.push(`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${C.ink}" stroke-width="1" ${LINE}/>`);
      }
      const spans = Math.max(1, Math.ceil(len / 1.2));
      for (let i = 0; i <= spans; i++) {
        const c = add(r.a, u, (len * i) / spans);
        out.push(`<rect x="${c[0] - 0.035}" y="${c[1] - 0.035}" width="0.07" height="0.07" fill="${C.ink}"/>`);
      }
    }

    // ---- huecos
    const roomSide = new Map(); // wallId → Set('L' | 'R')
    for (const r of rooms) for (const { id, side } of r.walls) (roomSide.get(id) || roomSide.set(id, new Set()).get(id)).add(side);
    for (const o of d.openings) {
      const w = walls.find((x) => x.id === o.wallId);
      if (!w) continue;
      const { u, n } = frame(w);
      const t = w.thickness / 2 + 0.01;
      const c = add(w.a, u, o.pos);
      const a = add(c, u, -o.width / 2);
      const b = add(c, u, o.width / 2);
      out.push(`<path d="M${P(add(a, n, t))}L${P(add(b, n, t))}L${P(add(b, n, -t))}L${P(add(a, n, -t))}Z" fill="#ffffff"/>`);
      const thin = `stroke="${C.ink}" stroke-width="1" ${LINE} fill="none"`;
      if (o.kind === 'window') {
        for (const k of [-0.035, 0.035]) out.push(`<line x1="${add(a, n, k)[0]}" y1="${add(a, n, k)[1]}" x2="${add(b, n, k)[0]}" y2="${add(b, n, k)[1]}" ${thin}/>`);
        for (const p of [a, b]) out.push(`<line x1="${add(p, n, -t)[0]}" y1="${add(p, n, -t)[1]}" x2="${add(p, n, t)[0]}" y2="${add(p, n, t)[1]}" ${thin}/>`);
      } else if (o.kind === 'garage') {
        out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" ${thin} stroke-dasharray="6 4"/>`);
      } else {
        // puerta: hoja abierta 90° y arco de giro
        const lw = o.width - 0.1;
        const swing = o.swing === -1 ? -1 : 1;
        const leaves = o.leaves === 2 ? [[false, lw / 2], [true, lw / 2]] : [[o.hinge === 'right', lw]];
        for (const [right, w] of leaves) {
          const Hn = add(c, u, right ? lw / 2 : -lw / 2);
          const F = add(Hn, u, right ? -w : w);
          const O = add(Hn, n, swing * w);
          const cross = (F[0] - Hn[0]) * (O[1] - Hn[1]) - (F[1] - Hn[1]) * (O[0] - Hn[0]);
          out.push(`<line x1="${Hn[0]}" y1="${Hn[1]}" x2="${O[0]}" y2="${O[1]}" stroke="${C.ink}" stroke-width="2" ${LINE}/>`);
          out.push(`<path d="M${P(F)}A${w},${w} 0 0 ${cross > 0 ? 1 : 0} ${P(O)}" ${thin} stroke-dasharray="3 3"/>`);
        }
      }
      if (showDims) {
        // medida del hueco, hacia el interior de la estancia
        const sides = roomSide.get(w.id);
        const s = sides?.has('L') ? 1 : sides?.has('R') ? -1 : 1;
        const label = `${fmt(o.width)}×${fmt(o.height)}`;
        out.push(textAt(add(c, n, s * (w.thickness / 2 + 0.28)), label, angleOf(u), 0.2, C.muted));
      }
    }

    // ---- escaleras
    for (const st of d.stairs.filter((x) => x.level === L || x.level === L - 1)) {
      const r = stairsRect(st);
      const arriving = st.level === L - 1;
      const dash = arriving ? 'stroke-dasharray="4 3"' : '';
      out.push(`<rect x="${r.minX}" y="${r.minZ}" width="${r.maxX - r.minX}" height="${r.maxZ - r.minZ}" fill="#ffffff" stroke="${C.ink}" stroke-width="1" ${dash} ${LINE}/>`);
      if (arriving) {
        out.push(textAt([(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2], 'hueco escalera', 0, 0.2, C.muted));
        continue;
      }
      const dir = [[1, 0], [0, -1], [-1, 0], [0, 1]][st.rot];
      const side = [-dir[1], dir[0]];
      const n = Math.max(3, Math.round(st.length / 0.25));
      const start = add([st.x, st.z], dir, -st.length / 2);
      for (let i = 1; i < n; i++) {
        const p = add(start, dir, (st.length * i) / n);
        const a = add(p, side, st.width / 2);
        const b = add(p, side, -st.width / 2);
        out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.ink}" stroke-width="1" ${LINE}/>`);
      }
      const end = add(start, dir, st.length - 0.15);
      out.push(`<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${C.dim}" stroke-width="1.5" ${LINE}/>`);
      const tip = add(end, dir, 0.15);
      out.push(`<path d="M${P(tip)}L${P(add(add(end, side, 0.12), dir, -0.1))}L${P(add(add(end, side, -0.12), dir, -0.1))}Z" fill="${C.dim}"/>`);
      if (showDims) out.push(textAt(add([st.x, st.z], side, st.width / 2 + 0.25), `sube · ${fmt(st.width)}×${fmt(st.length)}`, angleOf(dir), 0.2, C.muted));
    }

    // ---- barandillas de las escaleras (lados en su planta; las del hueco, en la de arriba)
    for (const st of d.stairs) {
      for (const r of stairsRailSpecs(st)) {
        if ((r.upper ? st.level + 1 : st.level) !== L) continue;
        const a = r.across ? stairsToWorld(st, r.x, r.x0) : stairsToWorld(st, r.x0, r.z);
        const b = r.across ? stairsToWorld(st, r.x, r.x1) : stairsToWorld(st, r.x1, r.z);
        out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.ink}" stroke-width="2.5" ${LINE}/>`);
      }
    }

    // ---- claraboyas (en el techo de esta planta o en su suelo)
    for (const k of d.skylights) {
      const slab = d.slabs.find((s) => s.id === k.slabId);
      if (!slab || (slab.level !== L && slab.level !== L + 1)) continue;
      const r = skylightRect(k);
      out.push(`<rect x="${r.minX}" y="${r.minZ}" width="${k.w}" height="${k.d}" fill="none" stroke="${C.muted}" stroke-width="1" stroke-dasharray="4 3" ${LINE}/>`);
      out.push(`<path d="M${r.minX},${r.minZ}L${r.maxX},${r.maxZ}M${r.maxX},${r.minZ}L${r.minX},${r.maxZ}" stroke="${C.muted}" stroke-width="1" ${LINE}/>`);
    }

    // ---- tejados (contorno y cumbrera)
    for (const rf of d.roofs.filter((x) => x.level === L || x.level === L + 1)) {
      const r = rectOf(rf);
      const o = rf.overhang;
      out.push(`<rect x="${r.minX - o}" y="${r.minZ - o}" width="${r.maxX - r.minX + 2 * o}" height="${r.maxZ - r.minZ + 2 * o}" fill="none" stroke="${C.muted}" stroke-width="1" stroke-dasharray="8 3 2 3" ${LINE}/>`);
      if (rf.pitch > 0) {
        const cx = (r.minX + r.maxX) / 2;
        const cz = (r.minZ + r.maxZ) / 2;
        const [a, b] = rf.ridge === 'x' ? [[r.minX - o, cz], [r.maxX + o, cz]] : [[cx, r.minZ - o], [cx, r.maxZ + o]];
        out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.muted}" stroke-width="1" stroke-dasharray="8 3 2 3" ${LINE}/>`);
      }
    }

    // ---- nombres y superficies de las estancias
    for (const r of rooms) {
      const [x, z] = r.label;
      out.push(textAt([x, z - 0.18], r.name, 0, 0.3, C.ink, 600));
      out.push(textAt([x, z + 0.22], `${fmt(r.area)} m²`, 0, 0.26, C.ink));
      if (isRect(r.points) && showDims) {
        const b = bbox(r.points);
        out.push(textAt([x, z + 0.55], `${fmt(b.maxX - b.minX)} × ${fmt(b.maxZ - b.minZ)}`, 0, 0.2, C.muted));
      }
    }

    // ---- cotas de cada tramo
    if (showDims) {
      for (const w of walls) {
        const { len, u, n } = frame(w);
        const sides = roomSide.get(w.id) || new Set();
        let s;
        let off;
        if (sides.size === 1) {
          s = sides.has('L') ? -1 : 1; // hacia fuera
          off = w.thickness / 2 + 0.55;
        } else if (sides.size === 2) {
          s = 1; // pared interior: cota pegada a la pared
          off = w.thickness / 2 + 0.3;
        } else {
          s = 1;
          off = w.thickness / 2 + 0.55;
        }
        out.push(dimension(w.a, w.b, add([0, 0], n, s), off, fmt(len), sides.size === 2));
      }
      // cotas totales
      if (walls.length) {
        const wb = bbox(walls.flatMap((w) => [w.a, w.b]));
        out.push(dimension([wb.minX, wb.minZ], [wb.maxX, wb.minZ], [0, -1], 1.6, fmt(wb.maxX - wb.minX), false, true));
        out.push(dimension([wb.minX, wb.maxZ], [wb.minX, wb.minZ], [-1, 0], 1.6, fmt(wb.maxZ - wb.minZ), false, true));
      }
    }

    // ---- título y escala gráfica
    const tx = this.fitBox[0] + 0.4;
    const ty = this.fitBox[1] + this.fitBox[3] - 0.5;
    out.push(`<text x="${tx}" y="${ty - 0.6}" font-size="0.4" font-weight="600" fill="${C.ink}" ${FONT}>Planta ${L}</text>`);
    out.push(`<text x="${tx}" y="${ty - 0.25}" font-size="0.22" fill="${C.muted}" ${FONT}>Cotas en metros, a ejes de pared · Planito</text>`);
    for (let i = 0; i < 5; i++) {
      out.push(`<rect x="${tx + i}" y="${ty}" width="1" height="0.12" fill="${i % 2 ? '#ffffff' : C.ink}" stroke="${C.ink}" stroke-width="1" ${LINE}/>`);
    }
    out.push(`<text x="${tx}" y="${ty + 0.42}" font-size="0.2" fill="${C.muted}" ${FONT}>0</text>`);
    out.push(`<text x="${tx + 5}" y="${ty + 0.42}" font-size="0.2" fill="${C.muted}" text-anchor="middle" ${FONT}>5 m</text>`);

    this.svg.innerHTML = out.join('\n');
    this.applyView();
  }
}

/** Ángulo (grados) para que un texto a lo largo de una dirección se lea derecho. */
function angleOf(u) {
  let a = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

function textAt(p, text, angle, size, color, weight = 400) {
  return `<text x="${p[0]}" y="${p[1]}" transform="rotate(${angle.toFixed(2)} ${p[0]} ${p[1]})" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="middle" dominant-baseline="middle" ${FONT}>${esc(text)}</text>`;
}

/** Línea de cota entre a y b, desplazada `off` metros en la dirección `n`. */
function dimension(a, b, n, off, label, inner = false, strong = false) {
  const A = add(a, n, off);
  const Bp = add(b, n, off);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const color = strong ? C.ink : C.dim;
  const parts = [];
  if (!inner) {
    // líneas de referencia desde la pared
    for (const [p, q] of [[a, A], [b, Bp]]) {
      const s = add(p, n, 0.15);
      const e = add(q, n, 0.12);
      parts.push(`<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke="${color}" stroke-opacity="0.5" stroke-width="1" ${LINE}/>`);
    }
  }
  parts.push(`<line x1="${A[0]}" y1="${A[1]}" x2="${Bp[0]}" y2="${Bp[1]}" stroke="${color}" stroke-width="1" ${LINE}/>`);
  // marcas oblicuas en los extremos
  const tick = [(u[0] + n[0]) * 0.1, (u[1] + n[1]) * 0.1];
  for (const p of [A, Bp]) {
    parts.push(`<line x1="${p[0] - tick[0]}" y1="${p[1] - tick[1]}" x2="${p[0] + tick[0]}" y2="${p[1] + tick[1]}" stroke="${color}" stroke-width="1.6" ${LINE}/>`);
  }
  const mid = add([(A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2], n, 0.2);
  parts.push(textAt(mid, label, angleOf(u), strong ? 0.3 : 0.24, color, strong ? 600 : 500));
  return parts.join('');
}
