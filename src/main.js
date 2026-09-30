import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { Store, emptyProject } from './state.js';
import { createGridMaterial, LotGrid } from './grid.js';
import { buildBuilding, disposeTree, setTint, elev, onFoundation, wallInfo, foundationTopGeometry } from './build.js';
import { Editor } from './editor.js';
import { rectToPoly, bboxOf } from './poly.js';
import { ToolController, TOOLS, HINTS, fmt, OPENING_PRESETS } from './tools.js';
import { exampleProject } from './example.js';
import { renderPanel, renderBrushPanel, renderPlanPanel, renderProjectSettings } from './panel.js';
import { renderCatalog, BUILD_TABS } from './catalog.js';
import { PlanView } from './plan.js';
import { PaintController, roomAt, faceFromHit } from './paint.js';
import { FurnishController } from './furnish.js';
import { CATALOG, CATEGORIES, catalogIcon, place } from './furniture.js';
import { uid } from './state.js';
import { WalkController } from './walk.js';

// ---------------------------------------------------------------------------
// Escena
// ---------------------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const COLORS = {
  edit: new THREE.Color('#eceae6'),
  render: new THREE.Color('#dde3e8'),
};

const scene = new THREE.Scene();
scene.background = COLORS.edit.clone();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
camera.position.set(13, 14, 16);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = false; // desplazar sobre el suelo
controls.minDistance = 2;
controls.maxDistance = 400;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.zoomToCursor = true;

// Luces
const hemi = new THREE.HemisphereLight('#ffffff', '#b9b1a3', 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff6ea', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 150;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 4;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-22, 38, 16);

// Suelo que recibe sombras
const groundMatEdit = new THREE.ShadowMaterial({ opacity: 0.14 });
const groundMatRender = new THREE.MeshStandardMaterial({ color: '#d7d3ca', roughness: 1 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 64).rotateX(-Math.PI / 2), groundMatEdit);
ground.receiveShadow = true;
ground.position.y = -0.002;
ground.raycast = () => {};
scene.add(ground);

// Cuadrícula
const gridMat = createGridMaterial();
const grid = new LotGrid(gridMat);
scene.add(grid.mesh);
const overlays = new THREE.Group(); // cuadrícula sobre las bases
scene.add(overlays);

// Postprocesado (solo en modo render): oclusión ambiental
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1.2, samples: 16 });
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Estado de la aplicación
// ---------------------------------------------------------------------------
const store = new Store();
if (store.fresh) {
  store.data = exampleProject();
  store.save();
}

const view = {
  level: 0,
  showAll: false,
  cutaway: null, // altura de recorte de las paredes: null (altas), 1.15 (bajas), 0.1 (sin paredes)
  render: false,
  snap: 0.5,
  mode: 'build', // 'build' (Construir) | 'furnish' (Amueblar)
  walk: false, // vista interior en primera persona
  // lo que dibujan las herramientas Pared / Habitación / Barandilla
  wallStyle: { height: null, style: 'solid', slatColor: '#b58a5c', slatWidth: 0.05, slatGap: 0.05, slatDir: 'v' },
  railStyle: { height: 1.0, style: 'glass', color: '#1c1d1f' },
  roofStyle: { pitch: 30 },
  stairStyle: { type: 'solid', rail: 'right' },
  furnishCat: 'bath', // estancia elegida en Amueblar
  // catálogo de Construir: pestaña actual y última variante elegida en cada una
  tab: 'wall',
  tabItem: { foundation: 'base', wall: 'full', room: 'room', slab: 'slab', roof: 'gable', door: 'door', window: 'window', stairs: 'solid', railing: 'glass', skylight: '1x1' },
  opening: { door: { ...OPENING_PRESETS.door }, window: { ...OPENING_PRESETS.window } },
  skylightSize: { w: 1, d: 1 },
};

let selection = null; // { kind, id }
let buildingRoot = new THREE.Group();
scene.add(buildingRoot);
let hovered = null;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

/** Cota del plano de trabajo de la planta actual en (x, z). */
function planeY(x, z) {
  if (view.level > 0) return elev(store.data.settings, view.level);
  return onFoundation(store.data, x, z) ? store.data.settings.baseHeight : 0;
}

function rayFrom(e) {
  setRay(e);
  return raycaster;
}

/** Limita un punto al solar. */
function clampToLot(p) {
  const { lotW, lotD } = store.data.settings;
  p.x = Math.max(-lotW / 2, Math.min(lotW / 2, p.x));
  p.z = Math.max(-lotD / 2, Math.min(lotD / 2, p.z));
  return p;
}

/** Punto bajo el ratón sobre el plano horizontal y = h (limitado al solar). */
function rayPlane(e, y, ray = true) {
  if (ray) setRay(e);
  const p = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p);
  return hit ? clampToLot(p) : null;
}

/** Punto bajo el ratón en el plano de trabajo (en planta 0 tiene en cuenta las bases). */
function pickPlane(e) {
  setRay(e);
  const s = store.data.settings;
  if (view.level === 0) {
    // primero la cara superior de las bases
    const p = rayPlane(e, s.baseHeight, false);
    if (p && onFoundation(store.data, p.x, p.z)) return p;
    return rayPlane(e, 0, false);
  }
  return rayPlane(e, elev(s, view.level), false);
}

const BUILD_KINDS = ['foundation', 'slab', 'wall', 'opening', 'stairs', 'roof', 'skylight', 'railing'];

/**
 * Busca el elemento bajo el ratón. Sin `kinds`, depende del modo:
 * en Construir solo la obra; en Amueblar solo los muebles.
 */
function pickKind(e, kinds = null, filter = null) {
  kinds ??= view.mode === 'furnish' ? ['furniture'] : BUILD_KINDS;
  setRay(e);
  const hits = raycaster.intersectObject(buildingRoot, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.kind) o = o.parent;
    if (!o) continue;
    const ud = o.userData;
    if (kinds && !kinds.includes(ud.kind)) continue;
    if (filter && !filter(ud)) continue;
    const wallId = ud.kind === 'wall' ? ud.id : ud.kind === 'opening' ? o.parent.userData.id : null;
    return { ...ud, object: o, point: h.point, wallId };
  }
  return null;
}

function hoverPick(e, mode) {
  const hit = pickKind(e);
  const obj = hit ? hit.object : null;
  if (obj === hovered) return;
  if (hovered && !isSelected(hovered)) setTint(hovered, null);
  hovered = obj;
  if (hovered && !isSelected(hovered)) setTint(hovered, mode);
  canvas.style.cursor = hovered ? 'pointer' : '';
}

const isSelected = (obj) => selection && obj.userData.kind === selection.kind && obj.userData.id === selection.id;

const measureEl = document.getElementById('measure');
function setMeasure(e, text) {
  if (!text || !e) {
    measureEl.style.display = 'none';
    return;
  }
  measureEl.style.display = 'block';
  measureEl.textContent = text;
  // que no se salga por la derecha
  const flip = e.clientX + measureEl.offsetWidth + 24 > window.innerWidth;
  measureEl.style.transform = flip ? 'translate(calc(-100% - 12px), -28px)' : '';
  measureEl.style.left = `${e.clientX}px`;
  measureEl.style.top = `${e.clientY}px`;
}

const app = { store, view, scene, pickPlane, pickKind, hoverPick, planeY, setMeasure, rayFrom, rayPlane, previewPaint };
const tools = new ToolController(app);
const editor = new Editor(app);
const painter = new PaintController(app);
canvas.style.setProperty('--brush-cursor', PaintController.cursor.replace(/, crosshair$/, ''));
const furnisher = new FurnishController(app);

/** Vista previa de la pintura: la escena se construye con una copia pintada del modelo. */
let previewData = null;
function previewPaint(fn) {
  if (fn) {
    previewData = JSON.parse(JSON.stringify(store.data));
    fn(previewData);
  } else if (!previewData) return;
  else previewData = null;
  rebuild();
}

// ---------------------------------------------------------------------------
// Reconstrucción de la escena a partir del modelo
// ---------------------------------------------------------------------------
function rebuild() {
  scene.remove(buildingRoot);
  disposeTree(buildingRoot);
  hovered = null;
  canvas.style.cursor = '';
  const v = view.render ? { level: 99, showAll: true, cutaway: null, openDoors: view.walk } : view;
  const data = previewData || store.data;
  buildingRoot = buildBuilding(data, v);

  scene.add(buildingRoot);
  // matrices al día ya: un clic puede llegar antes del siguiente fotograma
  buildingRoot.updateMatrixWorld(true);

  if (selection?.kind === 'room') {
    if (!roomAt(data, selection.level, selection.x, selection.z)) selection = null;
  } else if (selection) {
    const obj = findObject(selection);
    if (!obj) selection = null;
    else if (!view.render) setTint(obj, 'select');
  }

  // cuadrícula visible también encima de las bases (planta 0)
  for (const c of [...overlays.children]) {
    c.geometry.dispose();
    overlays.remove(c);
  }
  // estancia seleccionada: su suelo resaltado
  if (selection?.kind === 'room' && !view.render) {
    const room = roomAt(data, selection.level, selection.x, selection.z);
    const shape = new THREE.Shape(room.points.map(([x, z]) => new THREE.Vector2(x, -z)));
    const m = new THREE.Mesh(
      new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#2f6fed', transparent: true, opacity: 0.18, depthWrite: false }),
    );
    m.position.y = (selection.level === 0 ? planeY(room.label[0], room.label[1]) : elev(store.data.settings, selection.level)) + 0.02;
    m.renderOrder = 3;
    m.raycast = () => {};
    overlays.add(m);
  }
  if (!view.render && view.level === 0) {
    const y = store.data.settings.baseHeight + 0.004;
    for (const f of store.data.foundations) {
      const m = new THREE.Mesh(foundationTopGeometry(f, y), gridMat);
      m.renderOrder = 2;
      m.raycast = () => {};
      overlays.add(m);
    }
  }

  const { lotW, lotD } = store.data.settings;
  grid.setLot(lotW, lotD);
  controls.maxDistance = Math.max(40, Math.max(lotW, lotD) * 2.2);
  refreshHandles();
}

function refreshHandles() {
  editor.refresh(!view.render && tools.tool === 'select' ? selection : null);
}

function findObject(sel) {
  let found = null;
  buildingRoot.traverse((o) => {
    if (!found && o.userData.kind === sel.kind && o.userData.id === sel.id) found = o;
  });
  return found;
}

function select(sel) {
  if (selection) {
    const prev = findObject(selection);
    if (prev) setTint(prev, null);
  }
  selection = sel;
  if (sel) {
    const obj = findObject(sel);
    if (obj) setTint(obj, 'select');
  }
  hovered = null;
  refreshHandles();
  updatePanel(true);
}

store.subscribe(() => {
  previewData = null;
  if (selection && selection.kind !== 'room' && !store.find(selection.kind, selection.id)) selection = null;
  rebuild();
  updatePanel();
});

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------
// ---- Barra de catálogo (abajo): pestañas + miniaturas
const catalogEl = document.getElementById('catalog');

/** Resalta Seleccionar / Borrar en la caja común y redibuja el catálogo. */
function markActive() {
  for (const b of document.querySelectorAll('#common [data-tool]')) b.classList.toggle('active', b.dataset.tool === tools.tool);
  renderCatalogBar();
}

function renderCatalogBar() {
  let state;
  if (view.mode === 'furnish') {
    state = { mode: 'furnish', tab: view.furnishCat, item: tools.tool === 'furnish' ? furnisher.type : null };
  } else {
    const using = BUILD_TABS.some((t) => t.tool === tools.tool);
    if (using) view.tab = tools.tool;
    state = { mode: 'build', tab: view.tab, item: using ? view.tabItem[view.tab] : null };
  }
  renderCatalog(catalogEl, state, {
    onTab: (t) => {
      if (t.cat) {
        view.furnishCat = t.cat;
        if (tools.tool === 'furnish') setTool('select');
        else renderCatalogBar();
      } else {
        // la pestaña activa la herramienta con la última variante elegida
        const it = t.items.find((x) => x.id === view.tabItem[t.tool]) || t.items[0];
        pickItem(t, it);
      }
    },
    onItem: (t, it) => (t.cat ? setTool(`furnish:${it.id}`) : pickItem(t, it)),
  });
}

/** Elige una variante: fija su estilo y activa la herramienta de su pestaña. */
function pickItem(tab, it) {
  for (const [k, v] of Object.entries(it.set || {})) Object.assign(view[k], v);
  view.tabItem[tab.tool] = it.id;
  view.tab = tab.tool;
  setTool(tab.tool);
}
const pickById = (tool, id) => {
  const t = BUILD_TABS.find((x) => x.tool === tool);
  pickItem(t, t.items.find((x) => x.id === id));
};

function setMode(mode) {
  if (mode === view.mode) return;
  if (view.render) setRenderMode(false);
  view.mode = mode;
  for (const b of document.querySelectorAll('[data-action^="mode-"]')) b.classList.toggle('active', b.dataset.action === `mode-${mode}`);
  select(null);
  setTool('select');
}

const hintEl = document.getElementById('hint');
function updateHint() {
  if (view.walk) return;
  if (view.render) {
    hintEl.innerHTML = 'Modo render · <kbd>Arrastrar</kbd> rotar · <kbd>Shift+arrastrar</kbd> desplazar · <kbd>P</kbd> volver a editar';
    return;
  }
  if (view.mode === 'furnish') {
    const nav = '<kbd>Botón dcho.</kbd> rotar · <kbd>Shift+arrastrar</kbd> desplazar';
    hintEl.innerHTML =
      tools.tool === 'furnish'
        ? `Clic para colocar · <kbd>R</kbd> girar · los muebles de pared se pegan solos · ${nav}`
        : tools.tool === 'erase'
          ? `Clic sobre un mueble para quitarlo · ${nav}`
          : `Elige un mueble del catálogo · clic en uno colocado para editarlo o arrastrarlo · <kbd>R</kbd> girar · ${nav}`;
    return;
  }
  let extra = '';
  if (tools.tool === 'roof' && view.level === 0) extra = 'Sube a la planta 1 (▲) para poner el tejado sobre tus paredes · ';
  if (tools.tool === 'skylight' && view.level === 0) extra = 'Sube a la planta donde está el techo (▲) · ';
  if (tools.tool === 'foundation' && view.level !== 0) extra = 'Las bases se dibujan en la planta 0 · ';
  const key = tools.tool === 'brush' && painter.state.mode === 'zone' ? 'zone' : tools.tool;
  hintEl.innerHTML = extra + HINTS[key];
}

function setTool(id) {
  if (id === 'foundation' && view.level !== 0) setLevel(0);
  furnisher.clear();
  if (id.startsWith('furnish:')) {
    tools.setTool('furnish');
    furnisher.setType(id.slice(8));
  } else {
    tools.setTool(id);
  }
  painter.reset();
  setMeasure(null);
  if (hovered) {
    if (!isSelected(hovered)) setTint(hovered, null);
    hovered = null;
  }
  markActive();
  canvas.classList.toggle('brush', id === 'brush');
  applyMouseButtons();
  refreshHandles();
  updateHint();
  updatePanel(true);
}

function applyMouseButtons(e = null) {
  const leftOrbit = view.render || tools.tool === 'select';
  let left = leftOrbit ? THREE.MOUSE.ROTATE : null;
  if (e && e.altKey) left = THREE.MOUSE.ROTATE;
  if (spaceDown) left = THREE.MOUSE.PAN;
  if (editing) left = null;
  controls.mouseButtons = { LEFT: left, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
}

const levelLabel = document.getElementById('level-label');
function setLevel(n) {
  n = Math.max(0, Math.min(9, n));
  if (n === view.level) return;
  const s = store.data.settings;
  const levelY = (l) => (l === 0 ? 0 : elev(s, l));
  const dy = levelY(n) - levelY(view.level);
  // acompañar la cámara al subir/bajar de planta
  controls.target.y += dy * 0.6;
  camera.position.y += dy * 0.6;
  view.level = n;
  levelLabel.textContent = `Planta ${n}`;
  tools.reset();
  rebuild();
  updateHint();
  if (plan.isOpen) {
    plan.setLevel(n);
    updatePanel(true);
  }
}

function setRenderMode(on) {
  if (!on && view.walk) return exitWalk();
  view.render = on;
  document.body.classList.toggle('render-mode', on);
  queueMicrotask(updateViewButtons);
  grid.mesh.visible = !on;
  scene.background.copy(on ? COLORS.render : COLORS.edit);
  ground.material = on ? groundMatRender : groundMatEdit;
  scene.fog = on ? new THREE.Fog(COLORS.render, 80, 320) : null;
  tools.reset();
  tools.cursor.visible = false;
  applyMouseButtons();
  rebuild();
  updateHint();
}

// ---- Vista interior (primera persona)
const walker = new WalkController({ camera, store, canvas, onExit: () => exitWalk() });
let beforeWalk = null;
function enterWalk() {
  if (view.walk) return;
  beforeWalk = { pos: camera.position.clone(), target: controls.target.clone(), render: view.render };
  select(null);
  view.walk = true;
  document.body.classList.add('walk-mode');
  controls.enabled = false;
  setRenderMode(true);
  walker.enter(view.level);
}
function exitWalk() {
  if (!view.walk) return;
  walker.exit();
  view.walk = false;
  document.body.classList.remove('walk-mode');
  controls.enabled = true;
  camera.position.copy(beforeWalk.pos);
  controls.target.copy(beforeWalk.target);
  controls.update();
  setRenderMode(beforeWalk.render);
}

const plan = new PlanView({
  store,
  onClose: () => {
    document.body.classList.remove('plan-mode');
    updateViewButtons();
    updatePanel(true);
  },
});
function openPlan() {
  if (view.walk) return;
  if (view.render) setRenderMode(false);
  select(null);
  plan.open(view.level);
  document.body.classList.add('plan-mode');
  updateViewButtons();
  updatePanel(true);
}
function closePlan() {
  plan.close();
}

// Paredes: visibles ↔ ocultas (zócalo de 10 cm, como en Los Sims); el icono cambia con el estado
const WALL_ICONS = [
  '<path d="M5 20V5h14v15"/><path d="M5 10h14M5 15h14M10 5v5M14 10v5M10 15v5"/><path d="M2 20h20"/>',
  '<path d="M2 20h20"/><path d="M5 20v-2h14v2"/><path d="M5 5h14v10H5z" stroke-dasharray="2 2" opacity="0.5"/>',
];
const WALL_STATES = [
  [null, 'Paredes visibles'],
  [0.1, 'Paredes ocultas'],
];
function cycleWalls() {
  const i = WALL_STATES.findIndex(([h]) => h === view.cutaway);
  setCutaway(WALL_STATES[(i + 1) % WALL_STATES.length][0]);
}
function setCutaway(h) {
  view.cutaway = h;
  const btn = document.getElementById('btn-walls');
  const i = WALL_STATES.findIndex(([x]) => x === h);
  btn.innerHTML = `<svg viewBox="0 0 24 24">${WALL_ICONS[i]}</svg>`;
  btn.title = `${WALL_STATES[i][1]} (H) · clic para cambiar`;
  btn.classList.toggle('active', h !== null);
  rebuild();
}

// Panel de propiedades
const panelEl = document.getElementById('panel');
function updatePanel(force = false) {
  // no redibujar mientras el usuario edita un campo del panel
  if (!force && document.activeElement?.tagName === 'INPUT' && panelEl.contains(document.activeElement)) return;
  if (plan.isOpen) return renderPlanPanel(panelEl, plan, () => closePlan());
  if (tools.tool === 'brush' && !view.render) {
    return renderBrushPanel(
      panelEl,
      painter,
      (rerender = true) => {
        if (rerender) updatePanel(true);
        painter.reset();
        if (tools.lastEvent) painter.onMove(tools.lastEvent);
        updateHint();
      },
      () => setTool('select'),
    );
  }
  renderPanel(panelEl, { store, selection, view, select, fmt, wallInfo, duplicate, rotateFurniture, startBrush });
}

/** Activa el pincel ('wall' = caras de pared, 'zone' = rectángulo de suelo) con un color. */
function startBrush(mode, colors = {}) {
  Object.assign(painter.state, { mode, erase: false }, colors);
  select(null);
  setTool('brush');
}

/** Gira el mueble seleccionado (los de pared se vuelven a pegar a la pared). */
function rotateFurniture(step = 90) {
  if (selection?.kind !== 'furniture') return;
  store.commit((d) => {
    const f = d.furniture.find((x) => x.id === selection.id);
    f.rot = ((f.rot || 0) + step + 360) % 360;
  });
}

/** Duplica el mueble seleccionado al lado (o donde quepa). */
function duplicate() {
  if (selection?.kind !== 'furniture') return;
  const f = store.find('furniture', selection.id);
  const def = CATALOG[f.type];
  const a = THREE.MathUtils.degToRad(f.rot || 0);
  // se prueba a la derecha, a la izquierda, delante y detrás
  const tries = [
    [def.w, 0],
    [-def.w, 0],
    [0, def.d],
    [0, -def.d],
  ].map(([lx, lz]) => ({ x: f.x + lx * Math.cos(a) + lz * Math.sin(a), z: f.z - lx * Math.sin(a) + lz * Math.cos(a) }));
  for (const p of tries) {
    const pl = place(store.data, f.type, f.level, p, f.rot);
    if (!pl.ok) continue;
    const id = uid();
    store.commit((d) => d.furniture.push({ ...f, id, x: pl.x, z: pl.z, rot: pl.rot }));
    select({ kind: 'furniture', id });
    return;
  }
}

// Acciones de la barra superior
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  if (a === 'undo') store.undo();
  if (a === 'project') openProject();
  if (a === 'redo') store.redo();
  if (a === 'walls') cycleWalls();
  if (a === 'render') setRenderMode(!view.render);
  if (a === 'plan') plan.isOpen ? closePlan() : openPlan();
  if (a === 'level-up') setLevel(view.level + 1);
  if (a === 'level-down') setLevel(view.level - 1);
  if (a === 'screenshot') screenshot();
  if (a === 'export-glb') exportGLB();
  if (a === 'export-json') download(new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' }), 'proyecto.build3d.json');
  if (a === 'import-json') document.getElementById('file-input').click();
  if (a === 'clear') openNewDialog();
  if (a === 'example') store.replace(exampleProject());
  if (a === 'walk') enterWalk();
  if (a === 'walk-exit') exitWalk();
  if (a === 'mode-build') setMode('build');
  if (a === 'mode-furnish') setMode('furnish');
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    select(null);
    store.replace(data);
  } catch {
    alert('No se ha podido leer el archivo.');
  }
  e.target.value = '';
});

// Menú Archivo
const fileMenu = document.getElementById('file-menu');
document.getElementById('btn-file').addEventListener('click', (e) => {
  e.stopPropagation();
  fileMenu.hidden = !fileMenu.hidden;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) fileMenu.hidden = true;
  else if (e.target.closest('.menu [data-action]')) fileMenu.hidden = true;
});

// Rejilla (en ⚙): 0,25 / 0,5 / 1 m
document.getElementById('snap-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-snap]');
  if (!b) return;
  e.stopPropagation();
  view.snap = parseFloat(b.dataset.snap);
  grid.setSnap(view.snap);
  for (const x of document.querySelectorAll('#snap-seg [data-snap]')) x.classList.toggle('active', x === b);
});

// Caja común: Seleccionar / Borrar
document.getElementById('common').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) setTool(b.dataset.tool);
});

// Ajustes del proyecto (⚙ → Proyecto…)
const projectDialog = document.getElementById('project-dialog');
function openProject() {
  renderProjectSettings(document.getElementById('project-body'), store);
  projectDialog.showModal();
}

// Modos de vista: 3D · Render · Plano · Paseo
function setView(v) {
  if (v !== 'walk' && view.walk) exitWalk();
  if (v !== 'plan' && plan.isOpen) closePlan();
  if (v === '3d' && view.render) setRenderMode(false);
  if (v === 'render' && !view.render) setRenderMode(true);
  if (v === 'plan' && !plan.isOpen) openPlan();
  if (v === 'walk' && !view.walk) enterWalk();
  updateViewButtons();
}
function updateViewButtons() {
  const cur = view.walk ? 'walk' : plan.isOpen ? 'plan' : view.render ? 'render' : '3d';
  for (const b of document.querySelectorAll('#views [data-view]')) b.classList.toggle('active', b.dataset.view === cur);
  document.body.dataset.view = cur;
}
document.getElementById('views').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setView(b.dataset.view);
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function screenshot() {
  const hideGrid = grid.mesh.visible;
  grid.mesh.visible = false;
  overlays.visible = false;
  tools.ghost.visible = false;
  tools.cursor.visible = false;
  furnisher.clear();
  draw();
  canvas.toBlob((blob) => download(blob, 'planito.png'));
  grid.mesh.visible = hideGrid;
  overlays.visible = true;
  tools.ghost.visible = true;
}

function exportGLB() {
  const root = buildBuilding(store.data, { level: 99, showAll: true, cutaway: false });
  new GLTFExporter().parse(
    root,
    (glb) => {
      download(new Blob([glb], { type: 'model/gltf-binary' }), 'planito.glb');
      disposeTree(root);
    },
    (err) => alert('Error al exportar: ' + err.message),
    { binary: true },
  );
}

// ---------------------------------------------------------------------------
// Ratón y teclado
// ---------------------------------------------------------------------------
let spaceDown = false;
let navigating = false; // el clic actual es de navegación (Alt / Espacio)
let editing = false; // el clic actual arrastra un tirador o el elemento seleccionado
let downAt = null;

// En fase de captura: decide si el botón izquierdo navega antes de que lo vea OrbitControls
canvas.addEventListener(
  'pointerdown',
  (e) => {
    navigating = e.button === 0 && (e.altKey || spaceDown);
    editing = false;
    if (e.button === 0 && !navigating && !view.render && tools.tool === 'select' && selection) {
      editing = editor.tryStart(e, selection);
    }
    applyMouseButtons(e);
  },
  { capture: true },
);

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || navigating || editing) return;
  downAt = { x: e.clientX, y: e.clientY };
  if (view.render) return;
  if (tools.tool === 'brush') return painter.onDown(e);
  if (tools.tool === 'furnish') return furnisher.onDown(e);
  if (tools.tool !== 'select' && tools.tool !== 'erase') tools.onDown(e);
});

canvas.addEventListener('pointermove', (e) => {
  tools.lastEvent = e;
  app.lastEvent = e;
  if (view.render) return;
  if (editing) return editor.drag(e);
  if (e.buttons & 2 || e.buttons & 4 || navigating) return; // orbitando / desplazando
  if (e.buttons & 1 && tools.tool === 'select') return;
  if (tools.tool === 'brush') return painter.onMove(e);
  if (tools.tool === 'furnish') return furnisher.onMove(e);
  tools.onMove(e);
  if (tools.tool === 'select' && editor.canDrag(e, selection)) canvas.style.cursor = 'grab';
});

window.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (tools.tool === 'brush') painter.onUp();
  if (editing) {
    editing = false;
    editor.end();
    applyMouseButtons();
    downAt = null;
    return;
  }
  const wasNav = navigating;
  navigating = false;
  applyMouseButtons();
  if (wasNav || view.render || !downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5;
  downAt = null;
  if (tools.tool === 'select') {
    if (moved) return;
    const hit = pickKind(e);
    if (!hit) return select(null);
    // pared: se recuerda qué cara se ha pulsado (para pintarla)
    if (hit.kind === 'wall') return select({ kind: 'wall', id: hit.id, side: faceFromHit(hit).side });
    // suelo dentro de una estancia: panel de la estancia (suelo, paredes y techo)
    if (hit.kind === 'foundation' || hit.kind === 'slab') {
      const level = hit.kind === 'foundation' ? 0 : hit.level;
      if (level === view.level && roomAt(store.data, level, hit.point.x, hit.point.z)) {
        return select({ kind: 'room', level, x: hit.point.x, z: hit.point.z, base: { kind: hit.kind, id: hit.id } });
      }
    }
    select({ kind: hit.kind, id: hit.id });
  } else if (tools.tool === 'erase') {
    if (moved) return;
    const hit = pickKind(e);
    if (hit) {
      if (selection && selection.id === hit.id) selection = null;
      store.remove(hit.kind, hit.id);
      tools.onMove(e);
    }
  } else if (e.target === canvas) {
    tools.onUp(e);
  }
});

canvas.addEventListener('dblclick', () => tools.onDblClick());
canvas.addEventListener('pointerleave', () => {
  setMeasure(null);
  if (!painter.rect) painter.reset();
  furnisher.clear();
  tools.cursor.visible = false;
});

// ---- Desplazar la vista con las flechas del teclado
const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const panKeys = new Set();
let panFast = false;
window.addEventListener('blur', () => panKeys.clear());

/**
 * Mueve cámara y punto de mira sobre el terreno: ↑ ↓ hacia donde mira la cámara,
 * ← → de lado. La velocidad depende de la distancia (de cerca, despacio y preciso).
 */
function panWithKeys(dt) {
  if (!panKeys.size) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); // mirando en vertical
  fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const f = (panKeys.has('ArrowUp') ? 1 : 0) - (panKeys.has('ArrowDown') ? 1 : 0);
  const r = (panKeys.has('ArrowRight') ? 1 : 0) - (panKeys.has('ArrowLeft') ? 1 : 0);
  if (!f && !r) return;
  const speed = camera.position.distanceTo(controls.target) * (panFast ? 1.6 : 0.6); // m/s
  const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(speed * Math.min(dt, 0.1));
  controls.target.add(move);
  camera.position.add(move);
}

const KEY_TOOLS = Object.fromEntries(TOOLS.filter((t) => t !== 'sep').map((t) => [t.key.toLowerCase(), t.id]));

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (plan.isOpen) {
    // en el plano: L o Esc vuelven, +/− cambian de planta
    if (e.key === 'l' || e.key === 'L') closePlan();
    if (e.key === '+' || e.key === 'PageUp') setLevel(view.level + 1);
    if (e.key === '-' || e.key === 'PageDown') setLevel(view.level - 1);
    // flechas: desplazar el dibujo
    const PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (PAN) {
      e.preventDefault();
      plan.panBy(PAN[0] * (e.shiftKey ? 0.3 : 0.1), PAN[1] * (e.shiftKey ? 0.3 : 0.1));
    }
    return;
  }
  if (view.walk) return; // la vista interior gestiona sus propias teclas
  if (ARROWS.includes(e.key)) {
    // flechas: desplazar la vista (se mueve en el bucle de dibujo mientras se mantienen)
    e.preventDefault();
    panKeys.add(e.key);
    panFast = e.shiftKey;
    return;
  }
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;

  if (mod && k === 'z') {
    e.preventDefault();
    e.shiftKey ? store.redo() : store.undo();
    return;
  }
  if (mod && k === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod) return;

  if (e.code === 'Space') {
    spaceDown = true;
    applyMouseButtons();
    e.preventDefault();
    return;
  }
  if (k === 'escape' && tools.tool === 'brush') return setTool('select');
  if (k === 'c' && view.mode === 'build' && !view.render) return startBrush(painter.state.mode);
  if (tools.onKey(e)) return;
  if (k === 'r' && tools.tool === 'furnish') return furnisher.rotate(e.shiftKey ? 45 : 90);
  if (k === 'r' && selection?.kind === 'furniture') return rotateFurniture(e.shiftKey ? 45 : 90);
  if (k === 'escape' && tools.tool === 'furnish') return setTool('select');
  if (k === 'r' && selection?.kind === 'stairs' && tools.tool === 'select') {
    store.commit((d) => {
      const st = d.stairs.find((x) => x.id === selection.id);
      st.rot = (st.rot + 1) % 4;
    });
    return;
  }
  if (k === 'escape' && selection) return select(null);
  if ((k === 'delete' || k === 'backspace') && selection && selection.kind !== 'room') {
    store.remove(selection.kind, selection.id);
    select(null);
    return;
  }
  if (k === 'p') return setRenderMode(!view.render);
  if (k === 'l') return openPlan();
  if (k === 'i') return enterWalk();
  if (view.render) return;
  if (k === 'h') return cycleWalls();
  if (k === 'pageup' || k === ']' || k === '+' || e.code === 'BracketRight') return setLevel(view.level + 1);
  if (k === 'pagedown' || k === '[' || k === '-' || e.code === 'BracketLeft') return setLevel(view.level - 1);
  if (k === 'q' || k === 'e') return orbitStep(k === 'q' ? 1 : -1);
  if (view.mode === 'furnish' && k !== 'v' && k !== 'x') return; // en Amueblar solo Seleccionar y Borrar
  if (k === 'g') return pickById('window', 'bigwindow');
  if (k === 'j') return pickById('door', 'garage');
  if (KEY_TOOLS[k]) setTool(KEY_TOOLS[k]);
});

window.addEventListener('keyup', (e) => {
  panKeys.delete(e.key);
  if (e.key === 'Shift') panFast = false;
  if (e.code === 'Space') {
    spaceDown = false;
    applyMouseButtons();
  }
});

/** Q / E: girar la cámara 45° alrededor del punto de mira. */
let orbitAnim = null;
function orbitStep(dir) {
  const offset = camera.position.clone().sub(controls.target);
  orbitAnim = { from: 0, to: (dir * Math.PI) / 4, t: 0, offset, last: 0 };
}

/** Mantiene el punto de mira dentro del solar. */
function clampTarget() {
  const t = controls.target;
  const before = t.clone();
  clampToLot(t);
  if (!before.equals(t)) camera.position.add(t.clone().sub(before));
}

/** Encuadra la cámara sobre lo construido (o sobre el solar si está vacío). */
function frameProject() {
  const d = store.data;
  const pts = [...d.foundations.flatMap((f) => f.points), ...d.walls.flatMap((w) => [w.a, w.b])];
  const b = pts.length
    ? bboxOf(pts)
    : { minX: -d.settings.lotW / 4, maxX: d.settings.lotW / 4, minZ: -d.settings.lotD / 4, maxZ: d.settings.lotD / 4 };
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 6);
  controls.target.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  const dir = new THREE.Vector3(0.62, 0.62, 0.78).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, size * 2.4);
  controls.update();
}

// Diálogo "Proyecto nuevo"
const newDialog = document.getElementById('new-dialog');
function openNewDialog() {
  newDialog.querySelector('.snap-info').textContent = `ajustado a la rejilla de ${fmt(view.snap)} m`;
  newDialog.showModal();
}
newDialog.addEventListener('change', () => {
  const withBase = newDialog.querySelector('[name=start]:checked').value === 'base';
  newDialog.querySelector('.base-fields').classList.toggle('disabled', !withBase);
});
newDialog.addEventListener('close', () => {
  if (newDialog.returnValue !== 'create') return;
  const f = new FormData(newDialog.querySelector('form'));
  const num = (k, def, min, max) => {
    const v = parseFloat(String(f.get(k)).replace(',', '.'));
    return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : def;
  };
  const d = emptyProject();
  d.settings.lotW = num('lotW', 40, 10, 200);
  d.settings.lotD = num('lotD', 40, 10, 200);
  d.settings.levelHeight = num('ceil', 2.8, 2.2, 4.8) + d.settings.slabThickness;
  if (f.get('start') === 'base') {
    const snapV = (v) => Math.round(v / view.snap) * view.snap;
    const w = Math.min(num('baseW', 10, 1, 200), d.settings.lotW);
    const dd = Math.min(num('baseD', 8, 1, 200), d.settings.lotD);
    d.settings.baseHeight = num('baseH', 0.5, 0, 2);
    const minX = snapV(-w / 2);
    const minZ = snapV(-dd / 2);
    d.foundations.push({
      id: Math.random().toString(36).slice(2, 10),
      points: rectToPoly({ minX, maxX: minX + w, minZ, maxZ: minZ + dd }),
      holes: [],
    });
  }
  select(null);
  setLevel(0);
  store.replace(d);
  frameProject();
});

// ---------------------------------------------------------------------------
// Bucle de dibujo
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function draw() {
  if (view.render) composer.render();
  else renderer.render(scene, camera);
}

const timer = new THREE.Timer();
function frame(time) {
  timer.update(time);
  const dt = timer.getDelta();
  if (orbitAnim) {
    orbitAnim.t = Math.min(1, orbitAnim.t + dt * 3.5);
    const ease = 1 - Math.pow(1 - orbitAnim.t, 3);
    const angle = orbitAnim.to * ease;
    const off = orbitAnim.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    camera.position.copy(controls.target).add(off);
    if (orbitAnim.t >= 1) orbitAnim = null;
  }
  if (view.walk) {
    walker.update(dt);
  } else {
    panWithKeys(dt);
    controls.update();
    clampTarget();
  }
  editor.updateScale(camera);
  grid.setY(view.level === 0 ? 0.002 : elev(store.data.settings, view.level) + 0.01);
  const focus = view.walk ? walker.pos : controls.target;
  sun.position.copy(focus).add(SUN_OFFSET);
  sun.target.position.copy(focus);
  draw();
  requestAnimationFrame(frame);
}

// Arranque
updateViewButtons();
setCutaway(null);
rebuild();
frameProject();
setTool('select');
updatePanel(true);
grid.setSnap(view.snap);
frame();

// Acceso desde la consola para depurar
window.build3d = { store, view, scene, camera, controls, pickKind, select, painter, tools, walker, get selection() { return selection; } };
