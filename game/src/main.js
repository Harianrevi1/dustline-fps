// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// Owns the shooting (player and bot shots both resolve through one raycast), the damage,
// the tracers, the bomb mesh and the round orchestration. The modules own their own rules;
// this file only wires them together.
// ?shot=start|buy|play|plant with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, pointInSite } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS, GRENADES } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch } from './match.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { hasLineOfSight } from './physics.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 90);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const match = createMatch(onMatchEvent);
const player = createPlayer(world.colliders);
const arsenal = createArsenal(camera, scene);
const bots = createBots(scene, world.colliders, world.shootables, (from, to) => arsenal.smokeBlocks(from, to));
const input = createInput(renderer.domElement, onLockChange);

// The player's own hit meshes: an invisible torso box and head sphere, so bot shots resolve
// through the same raycast as the player's shots.
const playerFighter = {
  id: 'player', isPlayer: true, name: 'You', team: 'sable',
  body: player.body, health: 100, armor: 0, alive: true,
};
const playerHitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerTorsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.4), playerHitMaterial);
playerTorsoMesh.position.y = 1.05;
playerTorsoMesh.userData = { fighter: playerFighter, part: 'torso' };
const playerHeadMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), playerHitMaterial);
playerHeadMesh.position.y = 1.58;
playerHeadMesh.userData = { fighter: playerFighter, part: 'head' };
const playerHitGroup = new THREE.Group();
playerHitGroup.add(playerTorsoMesh, playerHeadMesh);
scene.add(playerHitGroup);

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const direction = new THREE.Vector3();
const tempVector = new THREE.Vector3();

// Tracer pool: eight reusable lines, each fading out after one shot.
const tracers = [];
const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 });
for (let index = 0; index < 8; index += 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geometry, tracerMaterial.clone());
  line.visible = false;
  scene.add(line);
  tracers.push({ line, left: 0 });
}
let tracerIndex = 0;
function spawnTracer(from, to) {
  const tracer = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  tracer.line.geometry.setFromPoints([from, to]);
  tracer.line.material.opacity = 0.9;
  tracer.line.visible = true;
  tracer.left = 0.07;
}

// The planted bomb: a small device with a blinking light, shown only while planted.
const bombGroup = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.24, 0.34),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.5, metalness: 0.5 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust) }),
);
bombLight.position.set(0.2, 0.16, 0);
bombGroup.add(bombBody, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

// Smoke puffs: translucent spheres that live as long as the cloud blocks sight.
const smokeVisuals = [];
const smokeGeometry = new THREE.SphereGeometry(2.2, 12, 10);
const smokeMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.32, depthWrite: false,
});

const noises = [];
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let bombBeepAt = 0;
let buyOpen = false;
let flashUntil = 0;
let grenadeCycle = ['frag', 'smoke', 'flash'];

function roleTeam(role) {
  return match.teamRole('sable') === role ? 'sable' : 'rust';
}

const fighters = [playerFighter];
function allFighters() {
  return fighters;
}
function aliveCount(role) {
  let count = 0;
  for (const fighter of allFighters()) {
    if (!fighter.alive) continue;
    if (match.teamRole(fighter.team) === role) count += 1;
  }
  return count;
}

function onMatchEvent(type, data) {
  if (type === 'roundStart') {
    resetFighters();
    hud.setBombStatus('');
    hud.setBombTimer('');
    bombGroup.visible = false;
    buyOpen = true;
    hud.showBuy(true, match.state.money);
    hud.setHint('Freeze time — press B for the buy menu, or a number key to buy.');
  } else if (type === 'roundLive') {
    buyOpen = false;
    hud.showBuy(false, match.state.money);
    hud.setHint('');
  } else if (type === 'roundEnd') {
    buyOpen = false;
    hud.showBuy(false, match.state.money);
    hud.setProgress('', 0);
    hud.setHint('');
    if (document.pointerLockElement) document.exitPointerLock();
    if (data.winner === match.state.playerTeam) audio.roundWin();
    else audio.roundLose();
    hud.showOverlay('roundEnd', data);
  } else if (type === 'matchEnd') {
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('matchEnd', data);
  } else if (type === 'bombPlanted') {
    bombGroup.position.set(data.position?.x ?? 0, 0.14, data.position?.z ?? 0);
    bombGroup.visible = true;
    hud.setBombStatus(`BOMB PLANTED — SITE ${data.site}`);
    audio.plantBeep();
  } else if (type === 'bombDefused') {
    bombGroup.visible = false;
    hud.setBombStatus('');
    hud.setBombTimer('');
    audio.defuse();
  } else if (type === 'bombExploded') {
    bombGroup.visible = false;
    hud.setBombStatus('');
    hud.setBombTimer('');
    audio.explosion();
    explodeDamage(data.position);
  } else if (type === 'halftime') {
    hud.setHint('Half time — sides swapped. Sable now defends.');
  } else if (type === 'bought') {
    audio.buy();
  } else if (type === 'kill') {
    // Kill feed rows are added where the damage lands.
  }
}

function resetFighters() {
  const playerRole = match.teamRole('sable');
  const playerSpawns = playerRole === 'attack' ? SPAWNS.attack : SPAWNS.defend;
  // The player takes the first spawn of their side; the bots take the rest of that side
  // and the four spawns of the other side.
  const attackSpawns = playerRole === 'attack' ? SPAWNS.attack.slice(1) : SPAWNS.attack.slice(0, 4);
  const defendSpawns = playerRole === 'attack' ? SPAWNS.defend.slice(0, 4) : SPAWNS.defend.slice(1);
  // The player spawns first on their side; bots take the rest.
  playerFighter.alive = true;
  playerFighter.health = 100;
  playerFighter.team = 'sable';
  player.body.position.set(playerSpawns[0][0], 0, playerSpawns[0][1]);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = playerRole === 'attack' ? 0 : Math.PI;
  player.body.pitch = 0;
  arsenal.refillAmmo();
  arsenal.clearGrenades();
  for (const smoke of smokeVisuals) {
    for (const mesh of smoke.meshes) scene.remove(mesh);
  }
  smokeVisuals.length = 0;
  const round = match.state.round;
  const assignments = round % 2 === 1
    ? { attack: ['A', 'B', 'mid', 'A'], defend: ['A', 'B', 'mid', 'A'] }
    : { attack: ['B', 'A', 'mid', 'B'], defend: ['B', 'A', 'mid', 'B'] };
  bots.reset(attackSpawns, defendSpawns, round, assignments);
  fighters.length = 1;
  for (const bot of bots.bots) {
    fighters.push({
      id: bot.id, name: bot.name, team: bot.team === 'attack' ? (playerRole === 'attack' ? 'rust' : 'sable') : (playerRole === 'attack' ? 'sable' : 'rust'),
      body: bot.body, health: 100, armor: bot.armor, alive: true, bot,
    });
  }
  // The bomb carrier: the player when Sable attacks, else the first attack bot.
  const bombCarrier = playerRole === 'attack' ? 'player' : bots.bots.find((bot) => bot.carriesBomb);
  match.state.bomb.carrier = bombCarrier === 'player' ? 'player' : bombCarrier ?? null;
  syncHud();
}

function applyDamage(fighter, amount, part, attacker) {
  if (!fighter.alive) return;
  let damage = amount;
  if (part === 'head') damage *= 4;
  else if (part === 'legs') damage *= 0.75;
  let absorbed = 0;
  if (fighter.armor > 0) {
    absorbed = Math.min(fighter.armor, damage * 0.5);
    fighter.armor -= absorbed;
  }
  fighter.health -= damage - absorbed;
  if (fighter.isPlayer) {
    hud.damageFlash();
    audio.hurt();
  } else if (attacker === 'player') {
    hud.hitMarker(false);
    audio.hit();
    if (fighter.bot) fighter.bot.spottedUntil = elapsed + 3;
  }
  if (fighter.health <= 0) {
    fighter.health = 0;
    fighter.alive = false;
    if (fighter.bot) {
      fighter.bot.alive = false;
      fighter.bot.fall = 0;
    }
    if (attacker === 'player') {
      hud.hitMarker(true, 220);
      audio.kill();
    }
    match.onKill(attacker, fighter.isPlayer ? 'player' : fighter.name);
    hud.addKill(attacker === 'player' ? 'You' : attacker, fighter.isPlayer ? 'You' : fighter.name, part === 'head');
    if (fighter.bot?.carriesBomb) {
      fighter.bot.carriesBomb = false;
      const next = bots.bots.find((bot) => bot.alive && bot.team === 'attack' && bot.site !== 'mid');
      if (next) {
        next.carriesBomb = true;
        match.state.bomb.carrier = next;
      } else {
        match.state.bomb.carrier = null;
      }
    }
    if (fighter.isPlayer && document.pointerLockElement) {
      document.exitPointerLock();
      hud.setHint('You are down — the round plays on without you.');
    }
  }
  syncHud();
}

function explodeDamage(position) {
  for (const fighter of allFighters()) {
    if (!fighter.alive) continue;
    const distance = Math.hypot(fighter.body.position.x - position.x, fighter.body.position.z - position.z);
    if (distance > 9) continue;
    const damage = Math.max(15, 120 - distance * 12);
    applyDamage(fighter, damage, 'torso', 'bomb');
  }
}

function shootFrom(origin, aimDirection, spread, weapon, attacker) {
  const pellets = weapon.pellets;
  for (let pellet = 0; pellet < pellets; pellet += 1) {
    const dir = new THREE.Vector3(aimDirection.x, aimDirection.y, aimDirection.z);
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    raycaster.set(origin, dir);
    const targets = world.shootables.concat(bots.hitMeshes, playerTorsoMesh, playerHeadMesh);
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 60);
    spawnTracer(origin.clone().addScaledVector(dir, 0.6), end);
    if (!hit) continue;
    const fighterData = hit.object.userData.fighter ?? hit.object.userData.bot;
    if (hit.object.userData.fighter) {
      const fighter = hit.object.userData.fighter;
      if (fighter.id !== attacker) applyDamage(fighter, weapon.damage, hit.object.userData.part, attacker);
    } else if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const fighter = allFighters().find((entry) => entry.bot === bot);
      if (fighter && fighter.id !== attacker) {
        applyDamage(fighter, weapon.damage, hit.object.userData.part, attacker);
      }
    }
  }
}

function playerShoot() {
  if (!arsenal.takeRound()) return;
  const weapon = arsenal.def();
  camera.getWorldDirection(direction);
  const spread = arsenal.spread(player.groundSpeed());
  const origin = camera.position.clone();
  shootFrom(origin, direction, spread, weapon, 'player');
  arsenal.pullTrigger();
  player.recoil(0.009 + weapon.recoil * 0.4 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(arsenal.state.weapon);
  noises.push({ x: player.body.position.x, z: player.body.position.z, time: elapsed });
  syncHud();
}

function botShoot(bot, target) {
  const weapon = bot.weapon;
  const eye = bots.eyeOf(bot.body);
  const chest = bots.chestOf(target.body);
  const distance = eye.distanceTo(chest);
  const aimAtHead = random() < 0.15;
  const aimPoint = aimAtHead
    ? new THREE.Vector3(target.body.position.x, target.body.position.y + 1.53, target.body.position.z)
    : chest;
  const error = (0.015 + distance * 0.0011 + (target.isPlayer ? player.groundSpeed() * 0.004 : 0)) * (1.35 - bot.skill);
  const aimDirection = aimPoint.clone().sub(eye).normalize();
  shootFrom(eye, aimDirection, error, weapon, bot.name);
  if (target.isPlayer) {
    const distanceToPlayer = eye.distanceTo(chest);
    audio.enemyShot(distanceToPlayer);
  }
  bot.spottedUntil = elapsed + 3;
  noises.push({ x: bot.body.position.x, z: bot.body.position.z, time: elapsed });
}

function burstGrenade(type, position) {
  if (type === 'frag') {
    audio.explosion();
    for (const fighter of allFighters()) {
      if (!fighter.alive) continue;
      const distance = Math.hypot(fighter.body.position.x - position.x, fighter.body.position.z - position.z);
      if (distance > GRENADES.frag.radius) continue;
      const damage = Math.max(20, GRENADES.frag.damage - distance * 12);
      applyDamage(fighter, damage, 'torso', 'grenade');
    }
    noises.push({ x: position.x, z: position.z, time: elapsed });
  } else if (type === 'smoke') {
    const meshes = [];
    for (let index = 0; index < 3; index += 1) {
      const mesh = new THREE.Mesh(smokeGeometry, smokeMaterial);
      mesh.position.set(position.x + (random() - 0.5) * 2, 1.2 + random() * 0.8, position.z + (random() - 0.5) * 2);
      scene.add(mesh);
      meshes.push(mesh);
    }
    smokeVisuals.push({ left: 12, meshes });
  } else if (type === 'flash') {
    const playerEye = new THREE.Vector3(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
    const distance = playerEye.distanceTo(position);
    if (distance < 20 && hasLineOfSight(world.shootables, playerEye, position)) {
      camera.getWorldDirection(direction);
      tempVector.subVectors(position, playerEye).normalize();
      const facing = direction.dot(tempVector);
      if (facing > 0.1) {
        const strength = Math.max(0.2, (1 - distance / 20) * (facing > 0.6 ? 1 : 0.6));
        hud.flashBang(strength);
        flashUntil = elapsed + strength * 1.5;
        audio.flash();
      }
    }
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const eye = bots.eyeOf(bot.body);
      if (eye.distanceTo(position) > 20) continue;
      if (!hasLineOfSight(world.shootables, eye, position)) continue;
      bot.blindUntil = elapsed + 1.5 + random();
    }
  }
}

function syncCamera() {
  camera.position.set(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
  camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
  playerHitGroup.position.set(player.body.position.x, player.body.position.y, player.body.position.z);
  playerHitGroup.rotation.y = player.body.yaw;
}

function syncHud() {
  const weapon = arsenal.def();
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, weapon.name.toUpperCase());
  hud.setHealth(playerFighter.health, playerFighter.armor);
  hud.setMoney(match.state.money);
  hud.setScore(match.state.round, match.state.score.sable, match.state.score.rust);
  hud.setGrenades(arsenal.state.grenades, arsenal.state.selectedGrenade);
  const bomb = match.state.bomb;
  if (bomb.state === 'planted') {
    hud.setTimer(match.state.roundLeft, bomb.fuseLeft);
    hud.setBombTimer(`BOMB ${Math.ceil(bomb.fuseLeft ?? 0)}s — SITE ${bomb.site}`);
  } else {
    hud.setTimer(match.state.phase === 'freeze' ? match.state.freezeLeft : match.state.roundLeft, null);
    hud.setBombTimer('');
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    if (match.state.phase === 'menu') match.startMatch();
  } else if (match.state.phase !== 'roundEnd' && match.state.phase !== 'matchEnd') {
    hud.showOverlay(started ? 'paused' : 'menu');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.state.phase === 'matchEnd') {
    match.startMatch();
    input.requestLock();
    return;
  }
  input.requestLock();
});

hud.onBuy((itemId) => {
  if (match.state.phase !== 'freeze') return;
  const result = match.buy(itemId);
  if (!result.ok) {
    audio.denied();
    return;
  }
  if (itemId === 'armor') {
    playerFighter.armor = 100;
  } else if (itemId === 'frag' || itemId === 'smoke' || itemId === 'flash') {
    arsenal.state.grenades[itemId] += 1;
  } else {
    arsenal.buy(itemId);
  }
  syncHud();
});

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;
  const keys = input.state.keys;

  // One-shot keys: buy, grenade cycle/throw, reload.
  for (const code of input.takePressed()) {
    if (code === 'KeyB' && (phase === 'freeze' || buyOpen)) {
      buyOpen = !buyOpen;
      hud.showBuy(buyOpen, match.state.money);
    }
    if (phase === 'freeze' && /^Digit[1-8]$/.test(code)) {
      const item = [null, 'rifle', 'smg', 'dmr', 'shotgun', 'armor', 'frag', 'smoke', 'flash'][Number(code.slice(5))];
      if (item) {
        const result = match.buy(item);
        if (result.ok) {
          if (item === 'armor') playerFighter.armor = 100;
          else if (item === 'frag' || item === 'smoke' || item === 'flash') arsenal.state.grenades[item] += 1;
          else arsenal.buy(item);
          audio.buy();
        } else {
          audio.denied();
        }
        syncHud();
      }
    }
    if (code === 'KeyQ') {
      const index = grenadeCycle.indexOf(arsenal.state.selectedGrenade);
      arsenal.state.selectedGrenade = grenadeCycle[(index + 1) % grenadeCycle.length];
      syncHud();
    }
    if (code === 'KeyG' && phase === 'live' && playerFighter.alive) {
      camera.getWorldDirection(direction);
      const origin = camera.position.clone().addScaledVector(direction, 0.5);
      if (arsenal.throwGrenade(arsenal.state.selectedGrenade, origin, direction.clone())) {
        audio.shot('sidearm');
      }
      syncHud();
    }
    if (code === 'KeyR') arsenal.reload();
  }

  // Aiming down sights: right mouse held narrows the view and steadies the spread.
  const fovTarget = arsenal.state.aiming ? 55 : 74;
  camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();

  if (phase === 'live' || phase === 'freeze') {
    const speedScale = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.55 : 1;
    if (playerFighter.alive) {
      player.step(dt, keys, speedScale * arsenal.def().moveSpeed);
    }
    arsenal.step(dt);
    if (phase === 'live' && playerFighter.alive) {
      if (input.state.firing && arsenal.ready()) playerShoot();
    }
  }
  arsenal.stepGrenades(dt, world.colliders, (type, position) => burstGrenade(type, position));

  // Bots run in every phase but freeze, so they stand ready at their spawns.
  if (phase === 'live' || phase === 'roundEnd') {
    bots.step(dt, {
      enemiesOf(bot) {
        const ownTeam = roleTeam(bot.team);
        return allFighters().filter((fighter) => fighter.team !== ownTeam && fighter.alive);
      },
      noises: noises.filter((noise) => elapsed - noise.time < 2),
      bomb: match.state.bomb,
      onBotShot(bot, target) {
        botShoot(bot, target);
      },
      onBotPlant(bot) {
        const siteName = bot.site;
        match.plantBomb(bot.name, siteName, { x: bot.body.position.x, z: bot.body.position.z });
        bot.carriesBomb = false;
      },
      onBotDefuse(bot) {
        match.defuseBomb(bot.name);
      },
    });
  }

  // The match clock: planting, defusing and round ends.
  const playerRole = match.teamRole('sable');
  const carrier = match.state.bomb.carrier;
  const inSite = playerRole === 'attack' && match.state.bomb.state === 'carried' && carrier === 'player'
    ? (pointInSite(player.body.position.x, player.body.position.z, SITES.A) ? 'A' : pointInSite(player.body.position.x, player.body.position.z, SITES.B) ? 'B' : null)
    : null;
  const nearBomb = match.state.bomb.state === 'planted' && match.state.bomb.position
    ? Math.hypot(match.state.bomb.position.x - player.body.position.x, match.state.bomb.position.z - player.body.position.z) < 2.2
    : false;
  match.step(dt, {
    aliveCount,
    playerPlanting: phase === 'live' && playerFighter.alive && keys.has('KeyE') && inSite !== null,
    playerDefusing: phase === 'live' && playerFighter.alive && keys.has('KeyE') && nearBomb && playerRole === 'defend',
    playerSite: inSite,
    playerX: player.body.position.x,
    playerZ: player.body.position.z,
  });

  // Context hints and progress bars for the bomb.
  if (phase === 'live' && playerFighter.alive) {
    if (inSite) {
      hud.setHint('Hold E to plant the device');
      hud.setProgress('PLANTING', match.state.plantProgress / 3.2);
    } else if (nearBomb && playerRole === 'defend') {
      hud.setHint('Hold E to defuse the device');
      hud.setProgress('DEFUSING', match.state.defuseProgress / 5);
    } else if (match.state.bomb.state === 'carried' && playerRole === 'attack' && carrier === 'player') {
      hud.setHint('You carry the device — reach site A or B');
      hud.setProgress('', 0);
    } else {
      hud.setHint('');
      hud.setProgress('', 0);
    }
  }

  // Bomb beeps, faster as the fuse runs down.
  if (match.state.bomb.state === 'planted') {
    const fuseLeft = match.state.bomb.fuseLeft ?? 40;
    const interval = fuseLeft < 10 ? 0.5 : 1;
    if (elapsed - bombBeepAt >= interval) {
      bombBeepAt = elapsed;
      bombLight.material.color.setHex(bombLight.material.color.getHex() === 0xd96a4f ? 0xe8a33d : 0xd96a4f);
      audio.bombBeep();
    }
  }

  // Smoke visuals fade out with their clouds.
  for (let index = smokeVisuals.length - 1; index >= 0; index -= 1) {
    smokeVisuals[index].left -= dt;
    if (smokeVisuals[index].left <= 0) {
      for (const mesh of smokeVisuals[index].meshes) scene.remove(mesh);
      smokeVisuals.splice(index, 1);
    }
  }
  // Tracers fade.
  for (const tracer of tracers) {
    if (tracer.left > 0) {
      tracer.left -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.left / 0.07) * 0.9;
      if (tracer.left <= 0) tracer.line.visible = false;
    }
  }
  // Expire old noises.
  while (noises.length > 0 && elapsed - noises[0].time > 2) noises.shift();

  syncHud();
  const teammates = bots.bots
    .filter((bot) => roleTeam(bot.team) === 'sable')
    .map((bot) => ({ body: bot.body, alive: bot.alive }));
  const enemies = bots.bots
    .filter((bot) => roleTeam(bot.team) === 'rust')
    .map((bot) => ({ body: bot.body, alive: bot.alive, spotted: (bot.spottedUntil ?? 0) > elapsed }));
  hud.drawMinimap(dt, player.body, teammates, enemies, match.state.bomb);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerFighter.alive && input.state.locked) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const body = player.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    player.body.position.set(0, 0, 14);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('menu');
  } else if (name === 'buy') {
    match.startMatch();
    player.body.position.set(0, 0, 14);
    player.body.yaw = 0;
    settle(30);
    buyOpen = true;
    hud.showBuy(true, match.state.money);
    hud.setHint('Freeze time — press B for the buy menu, or a number key to buy.');
  } else if (name === 'play') {
    match.startMatch();
    match.state.phase = 'live';
    match.state.roundLeft = 85;
    buyOpen = false;
    hud.showBuy(false, match.state.money);
    hud.setHint('');
    player.body.position.set(0, 0, 4);
    settle(30);
    const enemy = bots.bots.find((bot) => bot.team === 'defend' && bot.alive);
    if (enemy) {
      enemy.body.position.set(1.5, 0, -3);
      enemy.body.yaw = Math.PI;
      enemy.parts.group.position.set(1.5, 0, -3);
      enemy.parts.group.rotation.y = Math.PI;
      aimAt(new THREE.Vector3(1.5, 1.2, -3));
      playerShoot();
      settle(5);
    }
    const second = bots.bots.find((bot) => bot.team === 'defend' && bot.alive && bot !== enemy);
    if (second) {
      second.body.position.set(-2.5, 0, -8);
      second.parts.group.position.set(-2.5, 0, -8);
    }
  } else if (name === 'plant') {
    match.startMatch();
    match.state.phase = 'live';
    match.state.roundLeft = 62;
    buyOpen = false;
    hud.showBuy(false, match.state.money);
    hud.setHint('');
    match.plantBomb('player', 'B', { x: 14, z: -8.5 });
    player.body.position.set(10, 0, -2);
    settle(30);
    const enemy = bots.bots.find((bot) => bot.team === 'defend' && bot.alive);
    if (enemy) {
      enemy.body.position.set(17, 0, -8);
      enemy.parts.group.position.set(17, 0, -8);
    }
    aimAt(new THREE.Vector3(14, 0.3, -8.5));
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Right mouse aims down sights; the input module only tracks the left button, so this
// listener lives here beside the camera it drives.
window.addEventListener('mousedown', (event) => {
  if (event.button === 2) arsenal.state.aiming = true;
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) arsenal.state.aiming = false;
});
window.addEventListener('contextmenu', (event) => event.preventDefault());

hud.setMap(world.colliders.map((box) => ({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z })));
syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
