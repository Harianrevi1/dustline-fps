// Weapons and grenades. One table owns every gun's numbers; the view model, the magazine,
// the reload and the spread live here, while main.js owns the ray and the damage. Spread
// grows with movement, with sustained fire (bloom) and shrinks when aiming down sights, so
// stopping to aim pays. Grenades are simulated here too: a frag that bursts, a smoke cloud
// that blocks sight, and a flash that blinds whoever looks at it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  sidearm: {
    name: 'P9 Sidearm', price: 300, damage: 26, headMult: 4, gap: 0.14, mag: 12,
    reserve: 36, reload: 1.4, spreadStill: 0.003, spreadMove: 0.02, recoil: 0.006,
    bloom: 0.0012, moveSpeed: 1.0, pellets: 1, auto: false, barrel: 0.22,
  },
  rifle: {
    name: 'VK-47 Rifle', price: 2700, damage: 34, headMult: 4, gap: 0.096, mag: 30,
    reserve: 90, reload: 2.2, spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.011,
    bloom: 0.0022, moveSpeed: 0.95, pellets: 1, auto: true, barrel: 0.42,
  },
  smg: {
    name: 'Sting SMG', price: 1500, damage: 22, headMult: 4, gap: 0.07, mag: 32,
    reserve: 96, reload: 1.8, spreadStill: 0.004, spreadMove: 0.032, recoil: 0.007,
    bloom: 0.0028, moveSpeed: 1.0, pellets: 1, auto: true, barrel: 0.3,
  },
  dmr: {
    name: 'Longshot DMR', price: 4750, damage: 95, headMult: 4, gap: 1.1, mag: 5,
    reserve: 15, reload: 3.0, spreadStill: 0.0008, spreadMove: 0.05, recoil: 0.03,
    bloom: 0.001, moveSpeed: 0.9, pellets: 1, auto: false, barrel: 0.62,
  },
  shotgun: {
    name: 'Breach Shotgun', price: 1200, damage: 12, headMult: 4, gap: 0.8, mag: 6,
    reserve: 18, reload: 2.6, spreadStill: 0.03, spreadMove: 0.04, recoil: 0.02,
    bloom: 0.004, moveSpeed: 0.97, pellets: 8, auto: false, barrel: 0.4,
  },
};

export const GRENADES = {
  frag: { name: 'Frag', price: 300, fuse: 1.6, radius: 6, damage: 100 },
  smoke: { name: 'Smoke', price: 300, fuse: 1.2, radius: 4, damage: 0 },
  flash: { name: 'Flash', price: 200, fuse: 1.1, radius: 20, damage: 0 },
};

const BLOOM_MAX = 0.03;
const BLOOM_DECAY = 0.05;

export function createArsenal(camera, scene) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

  let model = null;
  let def = WEAPONS.sidearm;
  const state = {
    weapon: 'sidearm', mag: def.mag, reserve: def.reserve, cooldown: 0,
    reloadLeft: 0, flash: 0, kick: 0, bloom: 0, aiming: false,
    grenades: { frag: 0, smoke: 0, flash: 0 },
    selectedGrenade: 'frag',
  };

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  function buildModel() {
    if (model) {
      camera.remove(model);
      model.traverse((child) => {
        if (child.isMesh) child.geometry.dispose();
      });
    }
    model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.17 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.28);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), dark);
    sight.position.set(0, 0.075, -0.1);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.24, -0.2, -0.42);
    camera.add(model);
  }
  buildModel();

  // Live grenades and smoke clouds, simulated in stepGrenades.
  const live = [];
  const smokes = [];
  const grenadeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.4 }),
  );

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    if (model) {
      model.position.z = -0.42 + state.kick;
      model.position.x = state.aiming ? 0 : 0.24;
      model.position.y = state.aiming ? -0.16 : -0.2;
      model.rotation.x = state.kick * 2.2;
      if (state.reloadLeft > 0) {
        model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  function throwGrenade(type, origin, direction) {
    if (state.grenades[type] <= 0) return false;
    state.grenades[type] -= 1;
    const mesh = grenadeMesh.clone();
    mesh.position.copy(origin);
    scene.add(mesh);
    live.push({
      type, mesh, fuse: GRENADES[type].fuse,
      velocity: direction.clone().multiplyScalar(11).add(new THREE.Vector3(0, 3.2, 0)),
    });
    return true;
  }

  function stepGrenades(dt, colliders, onBurst) {
    for (let index = live.length - 1; index >= 0; index -= 1) {
      const grenade = live[index];
      grenade.fuse -= dt;
      grenade.velocity.y -= 12 * dt;
      grenade.mesh.position.addScaledVector(grenade.velocity, dt);
      const p = grenade.mesh.position;
      if (p.y < 0.09) {
        p.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.35;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
      }
      if (grenade.fuse <= 0) {
        live.splice(index, 1);
        scene.remove(grenade.mesh);
        onBurst(grenade.type, p.clone());
        if (grenade.type === 'smoke') {
          smokes.push({ position: p.clone(), left: 12, mesh: null });
        }
      }
    }
    for (let index = smokes.length - 1; index >= 0; index -= 1) {
      smokes[index].left -= dt;
      if (smokes[index].left <= 0) smokes.splice(index, 1);
    }
  }

  return {
    state,
    def() {
      return def;
    },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(BLOOM_MAX, state.bloom + def.bloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed) {
      const moving = Math.min(1, speed / 5.2);
      const base = def.spreadStill + moving * def.spreadMove + state.bloom;
      return state.aiming ? base * 0.6 : base;
    },
    switchTo(name) {
      if (!WEAPONS[name] || name === state.weapon) return false;
      def = WEAPONS[name];
      state.weapon = name;
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      state.bloom = 0;
      buildModel();
      return true;
    },
    buy(name) {
      if (!WEAPONS[name]) return false;
      return this.switchTo(name);
    },
    refillAmmo() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
    throwGrenade,
    stepGrenades,
    clearGrenades() {
      for (const grenade of live) scene.remove(grenade.mesh);
      live.length = 0;
      smokes.length = 0;
    },
    smokes,
    // Smoke blocks sight: a segment is hidden when it passes through any live cloud.
    smokeBlocks(from, to) {
      for (const smoke of smokes) {
        const center = smoke.position;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const lengthSq = dx * dx + dy * dy + dz * dz;
        if (lengthSq === 0) continue;
        let t = ((center.x - from.x) * dx + (center.y - from.y) * dy + (center.z - from.z) * dz) / lengthSq;
        t = Math.max(0, Math.min(1, t));
        const cx = from.x + dx * t - center.x;
        const cy = from.y + dy * t - center.y + 1.0;
        const cz = from.z + dz * t - center.z;
        if (cx * cx + cy * cy + cz * cz < 2.2 * 2.2) return true;
      }
      return false;
    },
  };
}
