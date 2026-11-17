// Original Baizhice model. Regenerate with: node scripts/create-login-book.mjs
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};

const scene = new THREE.Scene();
const blue = new THREE.MeshStandardMaterial({ color: '#2f66da', roughness: 0.38, metalness: 0.12, side: THREE.DoubleSide });
const edgeBlue = new THREE.MeshStandardMaterial({ color: '#1c49b3', roughness: 0.5 });
const paper = new THREE.MeshStandardMaterial({ color: '#fffefa', roughness: 0.88, side: THREE.DoubleSide });
const paperEdge = new THREE.MeshStandardMaterial({ color: '#dbe5f5', roughness: 0.9, side: THREE.DoubleSide });
const ink = new THREE.MeshStandardMaterial({ color: '#5d80bd', roughness: 0.8, side: THREE.DoubleSide });
const lightInk = new THREE.MeshStandardMaterial({ color: '#c5d4ed', roughness: 0.8, side: THREE.DoubleSide });
const paleBlue = new THREE.MeshStandardMaterial({ color: '#c5daff', roughness: 0.6, side: THREE.DoubleSide });

function mesh(geometry, material, parent, position = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position); parent.add(object); return object;
}
function box(w, h, d, material, parent, position, radius = 0.03) {
  return mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material, parent, position);
}
const book = new THREE.Group();
book.name = 'Book'; book.rotation.set(-0.46, -0.28, -0.22); book.position.set(-0.05, -0.35, 0);
scene.add(book);

const width = 2.05, height = 2.75;
function pageDepth(u) { return 0.06 + u * 0.25 + Math.sin(u * Math.PI) * 0.15; }
for (const side of [-1, 1]) {
  const cover = box(width + 0.16, height + 0.20, 0.09, blue, book, [side * (width / 2 + 0.035), 0, -0.045]);
  cover.rotation.y = side * -0.12;
  const back = box(width + 0.12, height + 0.16, 0.035, edgeBlue, book, [side * (width / 2 + 0.035), 0, -0.10]);
  back.rotation.y = side * -0.12;
  for (let layer = 0; layer < 12; layer++) {
    const geometry = new THREE.PlaneGeometry(width, height, 32, 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const u = (positions.getX(i) + width / 2) / width;
      positions.setXYZ(i, side * (0.035 + u * width), positions.getY(i), pageDepth(u) - (11 - layer) * 0.012);
    }
    geometry.computeVertexNormals();
    mesh(geometry, layer === 11 ? paper : layer % 3 === 0 ? paperEdge : paper, book);
  }
  // Raised print follows the curved paper rather than intersecting it.
  function printLine(x, y, length, thickness, material) {
    const geometry = new THREE.PlaneGeometry(length, thickness, 20, 1);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const px = x + positions.getX(i);
      positions.setXYZ(i, side * px, y + positions.getY(i), pageDepth((px - 0.035) / width) + 0.006);
    }
    geometry.computeVertexNormals(); mesh(geometry, material, book);
  }
  printLine(0.82, 0.91, 1.0, 0.095, blue);
  for (let row = 0; row < 5; row++) printLine(0.99, 0.62 - row * 0.17, row === 4 ? 0.90 : 1.35, 0.022, lightInk);
  if (side === -1) {
    printLine(0.73, -0.48, 0.8, 0.06, ink);
    for (let row = 0; row < 3; row++) printLine(0.97, -0.70 - row * 0.16, 1.28 - row * 0.12, 0.022, lightInk);
  } else {
    const nodes = [[0.55, -0.60], [1.06, -0.38], [1.53, -0.72], [0.99, -1.02]];
    for (const [a, b] of [[0, 1], [1, 2], [1, 3]]) {
      const points = Array.from({ length: 21 }, (_, i) => {
        const t = i / 20, x = nodes[a][0] + (nodes[b][0] - nodes[a][0]) * t, y = nodes[a][1] + (nodes[b][1] - nodes[a][1]) * t;
        return new THREE.Vector3(x, y, pageDepth((x - 0.035) / width) + 0.017);
      });
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, 0.012, 5, false), lightInk, book);
    }
    nodes.forEach(([x, y], i) => mesh(new THREE.SphereGeometry(i === 1 ? 0.11 : 0.075, 12, 8), i === 1 ? blue : paleBlue, book, [x, y, pageDepth((x - 0.035) / width) + 0.035]));
  }
}
box(0.08, height + 0.08, 0.10, edgeBlue, book, [0, 0, -0.05]);
const ribbon = box(0.13, 0.6, 0.018, blue, book, [-0.28, -1.46, 0.08], 0.008);
ribbon.rotation.z = -0.08;

const poses = [
  { p: [-2.48, 0.85, 0.35], r: [-0.15, 0.4, 0.32], s: 0.82, color: paper },
  { p: [1.85, 1.72, -0.12], r: [-0.2, -0.42, -0.18], s: 0.90, color: paper },
  { p: [2.45, -1.18, 0.6], r: [-0.12, -0.30, 0.25], s: 0.66, color: paleBlue }
];
const animations = [];
poses.forEach(({ p, r, s, color }, index) => {
  const sheet = new THREE.Group(); sheet.name = `FloatingPaper${index + 1}`;
  sheet.position.set(...p); sheet.rotation.set(...r); sheet.scale.setScalar(s); scene.add(sheet);
  const geometry = new THREE.PlaneGeometry(1.22, 1.57, 20, 20);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    positions.setZ(i, 0.10 * x * x + 0.055 * Math.sin(y * 2));
  }
  geometry.computeVertexNormals(); mesh(geometry, color, sheet);
  const line = (y, w, h, material) => mesh(new THREE.BoxGeometry(w, h, 0.012), material, sheet, [-0.04, y, 0.03 + 0.055 * Math.sin(y * 2)]);
  line(0.43, 0.62, 0.075, blue);
  for (let row = 0; row < 4; row++) line(0.17 - row * 0.19, row === 3 ? 0.47 : 0.83, 0.022, index === 2 ? ink : lightInk);
  const duration = 8 + index * 2, times = [0, duration / 4, duration / 2, duration * 3 / 4, duration];
  const animatedPositions = [], rotations = [];
  times.forEach(time => {
    const wave = Math.sin(time / duration * Math.PI * 2);
    animatedPositions.push(p[0] + wave * 0.035, p[1] + wave * 0.085, p[2]);
    rotations.push(...new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1] + wave * 0.045, r[2] + wave * 0.035)).toArray());
  });
  animations.push(new THREE.AnimationClip(`Paper drift ${index + 1}`, duration, [
    new THREE.VectorKeyframeTrack(`${sheet.name}.position`, times, animatedPositions),
    new THREE.QuaternionKeyframeTrack(`${sheet.name}.quaternion`, times, rotations)
  ]));
});

const binary = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, animations });
const destination = fileURLToPath(new URL('../public/brand/login-book.glb', import.meta.url));
await mkdir(fileURLToPath(new URL('../public/brand/', import.meta.url)), { recursive: true });
await writeFile(destination, Buffer.from(binary));
console.log(`Original login book exported: ${binary.byteLength} bytes`);
