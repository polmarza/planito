import * as THREE from 'three';

// Cuadrícula del solar: un plano del tamaño del solar cuyas líneas se dibujan
// en el shader a partir de las coordenadas del mundo (un único polígono).
export function createGridMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMinor: { value: 0.5 },
      uMajor: { value: 5.0 },
      uColor: { value: new THREE.Color('#5d574d') },
      uHalf: { value: new THREE.Vector2(20, 20) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uMinor;
      uniform float uMajor;
      uniform vec3 uColor;
      uniform vec2 uHalf;
      varying vec3 vWorld;

      float line(float size, out float density) {
        vec2 r = vWorld.xz / size;
        vec2 fw = fwidth(r);
        density = max(fw.x, fw.y);
        vec2 g = abs(fract(r - 0.5) - 0.5) / fw;
        return 1.0 - min(min(g.x, g.y), 1.0);
      }

      void main() {
        vec2 p = vWorld.xz;
        vec2 inside = uHalf - abs(p);
        if (min(inside.x, inside.y) < 0.0) discard;

        float dMinor;
        float dMajor;
        float minor = line(uMinor, dMinor);
        float major = line(uMajor, dMajor);
        // las líneas finas se desvanecen cuando están demasiado juntas (evita el moiré)
        minor *= 1.0 - smoothstep(0.2, 0.5, dMinor);
        major *= 1.0 - smoothstep(0.3, 0.7, dMajor);

        // borde del solar
        vec2 px = inside / fwidth(p);
        float border = 1.0 - min(min(px.x, px.y) / 2.0, 1.0);

        float a = max(max(minor * 0.22, major * 0.5), border * 0.75);
        if (a <= 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

export class LotGrid {
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
    this.mesh.renderOrder = 2;
    this.mesh.raycast = () => {}; // la cuadrícula nunca se selecciona
  }

  setLot(w, d) {
    this.mesh.scale.set(w, 1, d);
    this.material.uniforms.uHalf.value.set(w / 2, d / 2);
  }

  setY(y) {
    this.mesh.position.y = y;
  }

  setSnap(size) {
    this.material.uniforms.uMinor.value = size;
  }
}
