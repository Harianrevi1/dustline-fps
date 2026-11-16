// The map: Dustline Yard, a dusk industrial yard at 44 x 36 m. Two bombsites (A: Crane Yard
// west, B: Silo east), a mid lane, two long lanes and a connector between them. Every box is
// a collider for bodies and a surface a bullet stops on. Plain geometry only, no models and
// no textures: the palette and the low sun do the look. Waypoints form the graph the bots
// walk; edges never cross a wall.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { name: 'A', label: 'Crane Yard', minX: -20, maxX: -10, minZ: -16, maxZ: -6, center: { x: -15, z: -11 } },
  B: { name: 'B', label: 'Silo', minX: 10, maxX: 20, minZ: -16, maxZ: -6, center: { x: 15, z: -11 } },
};

export const SPAWNS = {
  attack: [
    [0, 14], [-4, 14], [4, 14], [-2, 15.5], [2, 15.5],
  ],
  defend: [
    [0, -14], [-3, -14], [3, -14], [-2, -15.5], [2, -15.5],
  ],
};

// Waypoint graph: [x, z] per node, edges as neighbour lists. Bots route with findRoute.
export const WAYPOINTS = [
  [0, 14], [-4, 14], [4, 14], [0, 10], [0, 4], [0, -2], [0, -8], [0, -13],
  [-3, -14], [3, -14], [-8, 10], [-14, 6], [-17, 0], [-14, -4], [-15, -10],
  [-18, -13], [8, 10], [14, 6], [17, 0], [14, -4], [15, -10], [18, -13],
  [-6, -3], [6, -3], [-12, -12], [12, -12],
];
export const EDGES = [
  [1, 2, 3], [0, 10], [0, 16], [0, 4, 10, 16], [3, 5, 11, 17], [4, 6, 22, 23],
  [5, 7, 22, 23], [6, 8, 9], [7, 24], [7, 25], [1, 3, 11], [10, 4, 12],
  [11, 13], [12, 14, 22], [13, 15, 24], [14], [2, 3, 17], [16, 4, 18],
  [17, 19], [18, 20, 23], [19, 21, 25], [20], [5, 6, 13], [5, 6, 19],
  [8, 14], [9, 20],
];

export function pointInSite(x, z, site) {
  return x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const teamMaterials = {
    sable: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sable), roughness: 0.6, metalness: 0.05 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.05 }),
  };

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function signPlane(text, color, x, y, z, rotationY) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#20242e';
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = color;
    context.lineWidth = 6;
    context.strokeRect(4, 4, 120, 120);
    context.fillStyle = color;
    context.font = 'bold 84px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 68);
    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY;
    group.add(mesh);
    return mesh;
  }

  // Ground: one slab, plus dirt patches as thin slabs on top of it.
  box(44.4, 0.4, 36.4, 0, -0.2, 0, 'ground');
  box(12, 0.06, 10, -14, 0.03, -10, 'surface');
  box(12, 0.06, 10, 14, 0.03, -10, 'surface');
  box(10, 0.06, 8, 0, 0.03, 12, 'surface');

  // Perimeter walls, 4 m high.
  box(44.4, 4, 0.4, 0, 2, -18.2, 'surface');
  box(44.4, 4, 0.4, 0, 2, 18.2, 'surface');
  box(0.4, 4, 36.4, -22.2, 2, 0, 'surface');
  box(0.4, 4, 36.4, 22.2, 2, 0, 'surface');

  // Spawn separator at z = 8: a gap in the middle is the mid entrance.
  box(17, 3.2, 0.4, -13.5, 1.6, 8, 'surface');
  box(17, 3.2, 0.4, 13.5, 1.6, 8, 'surface');

  // Site walls at z = -6: gaps into A (x -16..-10) and B (x 10..16), and mid (x -4..4).
  box(6, 3.2, 0.4, -19, 1.6, -6, 'surface');
  box(6, 3.2, 0.4, -7, 1.6, -6, 'surface');
  box(6, 3.2, 0.4, 7, 1.6, -6, 'surface');
  box(6, 3.2, 0.4, 19, 1.6, -6, 'surface');

  // Mid doors frame at z = -2: two pillars and a lintel to walk under.
  box(0.8, 3.4, 0.8, -2.5, 1.7, -2, 'hairline');
  box(0.8, 3.4, 0.8, 2.5, 1.7, -2, 'hairline');
  box(5.8, 0.8, 0.8, 0, 3.0, -2, 'hairline');

  // Cover: crates to crouch behind, containers, pillars.
  const crates = [
    [-6, 12], [6, 12], [-14, 4], [14, 4], [-17, -2], [17, -2],
    [-8, -3], [8, -3], [-13, -13], [13, -13], [-2.5, -8], [2.5, -8],
  ];
  for (const [x, z] of crates) box(1.2, 1.1, 1.2, x, 0.55, z, 'hairline');
  box(1.2, 1.1, 1.2, 0, 1.65, -8, 'hairline');
  box(3, 2.4, 2.4, -8, 1.2, -10, 'surface');
  box(3, 2.4, 2.4, 8, 1.2, -10, 'surface');
  box(0.9, 3.2, 0.9, -10, 1.6, 12, 'hairline');
  box(0.9, 3.2, 0.9, 10, 1.6, 12, 'hairline');
  box(0.9, 3.2, 0.9, -10, 1.6, -14, 'hairline');
  box(0.9, 3.2, 0.9, 10, 1.6, -14, 'hairline');

  // Site A: a crane — two posts and a beam, plus a hanging hook block.
  box(0.6, 6, 0.6, -18, 3, -13, 'accent');
  box(0.6, 6, 0.6, -12, 3, -13, 'accent');
  box(6.6, 0.5, 0.5, -15, 5.6, -13, 'accent', false);
  box(0.5, 1.2, 0.5, -15, 4.6, -13, 'hairline', false);

  // Site B: a silo (cylinder, boxed collider) and a smaller tank.
  const silo = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 5, 20),
    materials.surface,
  );
  silo.position.set(16, 2.5, -11);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(16, 2.5, -11), new THREE.Vector3(4, 5, 4)));
  shootables.push(silo);
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 3.5, 16),
    materials.hairline,
  );
  tank.position.set(12.5, 1.75, -14);
  tank.castShadow = true;
  tank.receiveShadow = true;
  group.add(tank);
  colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(12.5, 1.75, -14), new THREE.Vector3(2.8, 3.5, 2.8)));
  shootables.push(tank);

  // Site signs, facing the lanes that feed them.
  signPlane('A', PALETTE.accent, -13, 2.2, -6.2, 0);
  signPlane('B', PALETTE.accent, 13, 2.2, -6.2, 0);
  signPlane('A', PALETTE.accent, -20, 2.2, -11, Math.PI / 2);
  signPlane('B', PALETTE.accent, 20, 2.2, -11, -Math.PI / 2);

  // Skyline silhouettes outside the walls, for depth in the fog. Visual only.
  const skyline = [
    [-30, 6, -26, 8, 14], [-14, 10, -30, 10, 20], [6, 8, -28, 7, 16],
    [26, 12, -24, 9, 22], [34, 5, 4, 6, 10], [-34, 7, 10, 7, 12], [30, 6, 26, 8, 12],
  ];
  for (const [x, y, z, w, h] of skyline) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), materials.canvas);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }

  // Light: a low warm sun from the west, a cool fill from the east, and a dusk sky. The
  // hemisphere is strong so shadowed lanes still read.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.ground), 1.9);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb46b'), 2.7);
  key.position.set(-18, 12, 10);
  key.target.position.set(2, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.sable), 0.7);
  fill.position.set(16, 10, -8);
  scene.add(fill);

  // Accent top edges on the tall walls, so the flat planes read as built structures.
  const trim = (w, d, x, z) => box(w, 0.14, d, x, 4.05, z, 'accent', false);
  trim(44.4, 0.5, 0, -18.2);
  trim(44.4, 0.5, 0, 18.2);
  trim(0.5, 36.4, -22.2, 0);
  trim(0.5, 36.4, 22.2, 0);

  // Lane markings on the ground: a centre line down mid and approach lines into each site.
  // They sit above the dirt patches, so no two surfaces share a height.
  box(0.3, 0.04, 22, 0, 0.07, -3, 'accent', false);
  box(0.3, 0.04, 10, -15, 0.07, -11, 'accent', false);
  box(0.3, 0.04, 10, 15, 0.07, -11, 'accent', false);

  return { colliders, shootables, group, teamMaterials };
}
