// Polígonos ortogonales (lados paralelos a los ejes) en el plano XZ.
// Se usan para las bases: al solaparse o tocarse, se fusionan en una sola.
//
// Un polígono es una lista de puntos [x, z]. Una base tiene un contorno
// exterior (`points`) y, opcionalmente, patios interiores (`holes`).

const EPS = 1e-6;

export function rectToPoly(r) {
  return [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ];
}

export function bboxOf(points) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

function onSegment(x, z, [ax, az], [bx, bz]) {
  const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax);
  if (Math.abs(cross) > EPS * 10) return false;
  return x >= Math.min(ax, bx) - EPS && x <= Math.max(ax, bx) + EPS && z >= Math.min(az, bz) - EPS && z <= Math.max(az, bz) + EPS;
}

/** Punto dentro de un conjunto de contornos (regla par-impar). El borde cuenta como dentro. */
export function pointInLoops(loops, x, z) {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i];
      const b = loop[j];
      if (onSegment(x, z, a, b)) return true;
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

export const loopsOf = (f) => [f.points, ...(f.holes || [])];

export function signedArea(loop) {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    s += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]);
  }
  return s / 2;
}

/**
 * Une una lista de formas (cada una = lista de contornos) y devuelve las piezas
 * conexas resultantes. Cada pieza: { points, holes, sources } donde `sources`
 * son los índices de las formas de entrada que la componen.
 *
 * Método: se rasteriza sobre la rejilla irregular formada por todas las
 * coordenadas de los vértices, se agrupan celdas conexas y se trazan sus bordes.
 */
export function unionShapes(shapes) {
  let xs = [...new Set(shapes.flatMap((s) => s.flatMap((l) => l.map((p) => round(p[0])))))].sort((a, b) => a - b);
  let zs = [...new Set(shapes.flatMap((s) => s.flatMap((l) => l.map((p) => round(p[1])))))].sort((a, b) => a - b);
  // con lados inclinados, se añade una rejilla fina para aproximarlos en escalera
  const oblique = shapes.some((s) =>
    s.some((l) => l.some((p, i) => {
      const q = l[(i + 1) % l.length];
      return Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6;
    })),
  );
  if (oblique && xs.length > 1 && zs.length > 1) {
    const fine = (arr) => {
      const out = new Set(arr);
      const step = Math.max(0.25, (arr.at(-1) - arr[0]) / 300);
      for (let v = Math.ceil(arr[0] / step) * step; v < arr.at(-1); v += step) out.add(round(v));
      return [...out].sort((a, b) => a - b);
    };
    xs = fine(xs);
    zs = fine(zs);
  }
  const nx = xs.length - 1;
  const nz = zs.length - 1;
  if (nx < 1 || nz < 1) return [];

  // owner[i][j] = índice de la primera forma que cubre la celda, o -1
  const owner = [];
  for (let i = 0; i < nx; i++) {
    owner.push([]);
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < nz; j++) {
      const cz = (zs[j] + zs[j + 1]) / 2;
      let o = -1;
      for (let s = 0; s < shapes.length && o < 0; s++) if (pointInLoops(shapes[s], cx, cz)) o = s;
      owner[i].push(o);
    }
  }
  const covered = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && owner[i][j] >= 0;

  // Componentes conexas (vecindad a 4)
  const comp = owner.map((col) => col.map(() => -1));
  const pieces = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (!covered(i, j) || comp[i][j] >= 0) continue;
      const id = pieces.length;
      const cells = [];
      const sources = new Set();
      const stack = [[i, j]];
      comp[i][j] = id;
      while (stack.length) {
        const [a, b] = stack.pop();
        cells.push([a, b]);
        sources.add(owner[a][b]);
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const na = a + da;
          const nb = b + db;
          if (covered(na, nb) && comp[na][nb] < 0) {
            comp[na][nb] = id;
            stack.push([na, nb]);
          }
        }
      }
      pieces.push({ cells, sources: [...sources] });
    }
  }

  return pieces.map((piece, id) => {
    const inPiece = (i, j) => covered(i, j) && comp[i][j] === id;
    // aristas dirigidas del borde (celda a la izquierda del sentido de avance)
    const edges = new Map();
    const add = (a, b) => {
      const k = a.join(',');
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(b);
    };
    for (const [i, j] of piece.cells) {
      if (!inPiece(i, j - 1)) add([i, j], [i + 1, j]);
      if (!inPiece(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!inPiece(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!inPiece(i - 1, j)) add([i, j + 1], [i, j]);
    }
    const loops = [];
    for (const [startKey, list] of edges) {
      while (list.length) {
        const loop = [startKey.split(',').map(Number)];
        let cur = list.pop();
        let guard = 0;
        while (cur.join(',') !== startKey && guard++ < 100000) {
          loop.push(cur);
          const next = edges.get(cur.join(','));
          cur = next.pop();
        }
        loops.push(simplify(loop.map(([i, j]) => [xs[i], zs[j]])));
      }
    }
    const outers = loops.filter((l) => signedArea(l) > 0).sort((a, b) => signedArea(b) - signedArea(a));
    const holes = loops.filter((l) => signedArea(l) < 0);
    return { points: outers[0], holes, sources: piece.sources };
  });
}

/** Quita vértices alineados. */
function simplify(loop) {
  const out = [];
  const n = loop.length;
  for (let k = 0; k < n; k++) {
    const p = loop[(k + n - 1) % n];
    const c = loop[k];
    const q = loop[(k + 1) % n];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    if (Math.abs(cross) > EPS) out.push(c);
  }
  return out;
}

const round = (v) => Math.round(v * 1e4) / 1e4;
