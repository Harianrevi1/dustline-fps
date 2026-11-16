// Shared movement physics: a box body resolved against the world's colliders one axis at
// a time, so a wall never swallows a body and sliding along it still works. The player and
// every bot move through this one function; nothing else needs to know about collision.
import * as THREE from 'three';

const RADIUS = 0.34;

export function makeBody(x, z, height, eye) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye,
    height,
    onGround: true,
    crouching: false,
  };
}

const probe = new THREE.Box3();

function overlaps(colliders, x, y, z, height, lift) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (const collider of colliders) {
    if (probe.intersectsBox(collider)) return collider;
  }
  return null;
}

// wish: a unit XZ direction (or zero), speed in m/s, dt in seconds. Gravity and jumping are
// handled here too; pass jump true on the frame the body should leave the ground.
export function moveBody(body, colliders, dt, wishX, wishZ, speed, jump, gravity = 20) {
  const blend = Math.min(1, (body.onGround ? 42 : 9) * dt / Math.max(speed, 0.1));
  body.velocity.x += (wishX * speed - body.velocity.x) * blend;
  body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
  if (body.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - 9 * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }
  if (jump && body.onGround) {
    body.velocity.y = 6.2;
    body.onGround = false;
  }
  body.velocity.y -= gravity * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, body.position.y, body.position.z, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(colliders, body.position.x, body.position.y, nextZ, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
  return body;
}

export function groundSpeed(body) {
  return Math.hypot(body.velocity.x, body.velocity.z);
}

// A clear line of sight between two eye points: true when no shootable mesh blocks the
// segment. Takes meshes, not collider boxes: the raycaster needs objects it can raycast.
const losRay = new THREE.Raycaster();
const losDir = new THREE.Vector3();
export function hasLineOfSight(meshes, from, to) {
  losDir.subVectors(to, from);
  const distance = losDir.length();
  if (distance < 0.01) return true;
  losDir.divideScalar(distance);
  losRay.set(from, losDir);
  losRay.far = distance;
  return losRay.intersectObjects(meshes, false).length === 0;
}

// Breadth-first route over a waypoint graph: returns the node ids from start to goal.
export function findRoute(nodes, edges, start, goal) {
  if (start === goal) return [start];
  const cameFrom = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of edges[current] ?? []) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      if (next === goal) {
        const route = [goal];
        let node = goal;
        while (cameFrom.get(node) !== -1) {
          node = cameFrom.get(node);
          route.unshift(node);
        }
        return route;
      }
      queue.push(next);
    }
  }
  return [start, goal];
}

export function nearestNode(nodes, x, z) {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < nodes.length; index += 1) {
    const dx = nodes[index].x - x;
    const dz = nodes[index].z - z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}
