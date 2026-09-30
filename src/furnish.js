// Herramienta de colocar muebles: previsualización (verde/rojo), giro con R
// e imán a paredes (lo resuelve `place`).
import * as THREE from 'three';
import { uid } from './state.js';
import { CATALOG, buildFurniture, place } from './furniture.js';

const okMat = new THREE.MeshBasicMaterial({ color: '#2f6fed', transparent: true, opacity: 0.45, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: '#d9463b', transparent: true, opacity: 0.45, depthWrite: false });

export class FurnishController {
  constructor(app) {
    this.app = app;
    this.type = null;
    this.rot = 0;
    this.ghost = null;
    this.last = null; // última colocación calculada
  }

  setType(type) {
    this.type = type;
    this.rot = 0;
    this.clear();
  }

  clear() {
    if (this.ghost) {
      this.app.scene.remove(this.ghost);
      this.ghost.traverse((o) => o.geometry?.dispose());
      this.ghost = null;
    }
    this.last = null;
  }

  onMove(e) {
    if (!this.type) return;
    const p = this.app.pickPlane(e);
    if (!p) return;
    const d = this.app.store.data;
    const level = this.app.view.level;
    const pl = place(d, this.type, level, p, this.rot);
    this.last = { ...pl, level };
    if (!this.ghost) {
      this.ghost = buildFurniture(null, { type: this.type });
      this.ghost.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.renderOrder = 5;
        }
      });
      this.app.scene.add(this.ghost);
    }
    this.ghost.traverse((o) => {
      if (o.isMesh) o.material = pl.ok ? okMat : badMat;
    });
    this.ghost.position.set(pl.x, this.app.planeY(pl.x, pl.z) + 0.002, pl.z);
    this.ghost.rotation.y = THREE.MathUtils.degToRad(pl.rot);
    this.app.setMeasure(e, pl.ok ? (pl.wall ? `${CATALOG[this.type].name} · contra la pared` : CATALOG[this.type].name) : 'Choca con otro mueble');
  }

  onDown() {
    const pl = this.last;
    if (!pl || !pl.ok || !this.type) return;
    const def = CATALOG[this.type];
    this.app.store.commit((d) => {
      d.furniture.push({ id: uid(), type: this.type, level: pl.level, x: pl.x, z: pl.z, rot: pl.rot, color: def.color, accent: def.accent });
    });
  }

  rotate(step = 90) {
    this.rot = (this.rot + step + 360) % 360;
    if (this.app.lastEvent) this.onMove(this.app.lastEvent);
  }
}
