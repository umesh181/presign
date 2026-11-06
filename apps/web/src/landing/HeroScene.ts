/**
 * Hero WebGL scene: a refractive glass shield with a glowing check mark, orbiting light rings
 * and a drifting field of hex glyphs (the calldata PreSign turns into meaning). Reacts to the mouse.
 * Imperative three.js, mounted into a canvas; returns a dispose function.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const GLYPHS = "0123456789abcdef";

function shieldShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 1.25);
  s.bezierCurveTo(0.45, 1.05, 0.8, 1.0, 1.05, 1.0);
  s.bezierCurveTo(1.05, 0.15, 0.95, -0.75, 0, -1.35);
  s.bezierCurveTo(-0.95, -0.75, -1.05, 0.15, -1.05, 1.0);
  s.bezierCurveTo(-0.8, 1.0, -0.45, 1.05, 0, 1.25);
  return s;
}

function checkShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.02);
  s.lineTo(-0.34, 0.18);
  s.lineTo(-0.12, -0.04);
  s.lineTo(0.42, 0.5);
  s.lineTo(0.58, 0.34);
  s.lineTo(-0.12, -0.36);
  s.lineTo(-0.5, 0.02);
  return s;
}

/** 4x4 atlas of hex glyphs for the point field. */
function glyphAtlas(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.font = `500 ${size / 5}px "JetBrains Mono", monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < 16; i++) g.fillText(GLYPHS[i]!, ((i % 4) + 0.5) * (size / 4), (Math.floor(i / 4) + 0.5) * (size / 4));
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function mountHero(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 7.5);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const rig = new THREE.Group();
  scene.add(rig);

  // Glass shield.
  const shieldGeo = new THREE.ExtrudeGeometry(shieldShape(), {
    depth: 0.32,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.1,
    bevelSegments: 12,
    curveSegments: 48,
  });
  shieldGeo.center();
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.06,
    transmission: 1,
    thickness: 1.4,
    ior: 1.45,
    iridescence: 1,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 620],
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color("#b9b2ff"),
    attenuationDistance: 3.5,
    envMapIntensity: 1.3,
  });
  const shield = new THREE.Mesh(shieldGeo, glass);
  rig.add(shield);

  // Glowing check mark floating inside the shield.
  const checkGeo = new THREE.ExtrudeGeometry(checkShape(), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 4 });
  checkGeo.center();
  const check = new THREE.Mesh(checkGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color("#8ef0ff").multiplyScalar(2.2) }));
  check.scale.setScalar(1.1);
  rig.add(check);

  // Orbiting light rings (bloomed).
  const rings: THREE.Mesh[] = [];
  const ringColors = ["#7c6cff", "#2dd4ff", "#c084fc"];
  ringColors.forEach((col, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.85 + i * 0.32, 0.008 + i * 0.002, 16, 220),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.4), transparent: true, opacity: 0.9 - i * 0.2 }),
    );
    ring.rotation.set(Math.PI / 2.4 + i * 0.35, i * 0.6, 0);
    rings.push(ring);
    rig.add(ring);
  });

  // Hex glyph field.
  const COUNT = window.innerWidth < 700 ? 900 : 2200;
  const pos = new Float32Array(COUNT * 3);
  const glyph = new Float32Array(COUNT);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const r = 3 + Math.random() * 9;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r * 1.4;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 2] = -2 - Math.random() * 10;
    glyph[i] = Math.floor(Math.random() * 16);
    seed[i] = Math.random();
  }
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  fieldGeo.setAttribute("aGlyph", new THREE.BufferAttribute(glyph, 1));
  fieldGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const fieldMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAtlas: { value: glyphAtlas() }, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */ `
      attribute float aGlyph; attribute float aSeed;
      uniform float uTime; uniform float uPixel;
      varying float vGlyph; varying float vAlpha; varying float vSeed;
      void main() {
        vec3 p = position;
        p.y += mod(uTime * (0.08 + aSeed * 0.18) + aSeed * 9.0, 9.0) - 4.5 - position.y * 0.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (26.0 + aSeed * 18.0) * uPixel / -mv.z;
        float flick = step(0.5, fract(uTime * (0.3 + aSeed) + aSeed * 13.0));
        vGlyph = mod(aGlyph + floor(uTime * (0.5 + aSeed) + aSeed * 40.0) * flick, 16.0);
        vAlpha = smoothstep(-13.0, -3.0, mv.z) * (0.25 + aSeed * 0.55);
        vSeed = aSeed;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying float vGlyph; varying float vAlpha; varying float vSeed;
      void main() {
        vec2 cell = vec2(mod(vGlyph, 4.0), 3.0 - floor(vGlyph / 4.0));
        vec2 uv = (cell + vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)) / 4.0;
        float a = texture2D(uAtlas, uv).a;
        vec3 col = mix(vec3(0.49, 0.42, 1.0), vec3(0.18, 0.83, 1.0), vSeed);
        gl_FragColor = vec4(col, a * vAlpha);
      }`,
  });
  const field = new THREE.Points(fieldGeo, fieldMat);
  scene.add(field);

  // Post: bloom on the bright parts (rings, check mark).
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // Wide screens: shield on the right, balancing the left-aligned headline. Narrow: centred, further back.
    camera.position.z = w < 700 ? 9.5 : 7.5;
    rig.position.x = w > 1000 ? 1.75 : 0;
    field.position.x = rig.position.x * 0.5;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Mouse parallax (smoothed).
  const target = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    target.x = (e.clientX / window.innerWidth) * 2 - 1;
    target.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onMove);

  // Only render while visible.
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
  io.observe(canvas);

  const clock = new THREE.Timer();
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    clock.update();
    const t = clock.getElapsed();
    cur.x += (target.x - cur.x) * 0.05;
    cur.y += (target.y - cur.y) * 0.05;
    rig.rotation.y = Math.sin(t * 0.4) * 0.35 + cur.x * 0.6;
    rig.rotation.x = Math.cos(t * 0.3) * 0.12 + cur.y * 0.35;
    rig.position.y = Math.sin(t * 0.8) * 0.08;
    check.position.z = 0.05 + Math.sin(t * 1.2) * 0.04;
    rings.forEach((r, i) => {
      r.rotation.z = t * (0.25 + i * 0.12) * (i % 2 ? -1 : 1);
    });
    field.rotation.y = cur.x * 0.15;
    fieldMat.uniforms.uTime!.value = t;
    composer.render();
  };

  if (opts.reducedMotion) {
    composer.render();
  } else {
    frame();
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove);
    ro.disconnect();
    io.disconnect();
    composer.dispose();
    renderer.dispose();
    pmrem.dispose();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
    });
  };
}
