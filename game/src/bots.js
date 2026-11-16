// Bots: five per side, one job each in a small state machine — route, hold, engage, plant,
// defuse. They walk the waypoint graph, hold angles, react to what they see and hear, and
// fight in bursts with an aim error that grows with distance and target speed. The module
// decides when a bot shoots; main.js resolves the shot, so the damage rules stay in one place.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { findRoute, groundSpeed, hasLineOfSight, makeBody, moveBody, nearestNode } from './physics.js';
import { SITES, WAYPOINTS, EDGES } from './world.js';
import { WEAPONS } from './weapons.js';

const NAMES = {
  attack: ['Vex', 'Mara', 'Juno', 'Pike'],
  defend: ['Ash', 'Rook', 'Fenn', 'Wren'],
};
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const PERCEIVE_EVERY = 0.12;
const WALK_SPEED = 4.3;

const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
const headGeometry = new THREE.SphereGeometry(0.155, 16, 12);
const legGeometry = new THREE.BoxGeometry(0.18, 0.72, 0.2);
const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.6);

export function createBots(scene, colliders, shootables, smokeBlocks) {
  const bots = [];
  const hitMeshes = [];
  let now = 0;

  function makeBotMesh(team) {
    const group = new THREE.Group();
    const teamColor = team === 'attack' ? PALETTE.sable : PALETTE.rust;
    const teamMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6, metalness: 0.05 });
    const inkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.1 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.7, metalness: 0.2 });
    const torso = new THREE.Mesh(torsoGeometry, teamMaterial);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, inkMaterial);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.14, 0.36, 0);
    legL.userData.part = 'legs';
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.14, 0.36, 0);
    legR.userData.part = 'legs';
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.3, 1.1, -0.25);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { group, torso, head, legL, legR };
  }

  function spawnBot(team, index, spawn, round) {
    const [x, z] = spawn;
    const parts = makeBotMesh(team);
    parts.group.position.set(x, 0, z);
    scene.add(parts.group);
    const skill = 0.45 + Math.random() * 0.35;
    const weaponKey = round === 1 ? 'sidearm' : index === 0 && team === 'defend' ? 'dmr' : index % 3 === 0 ? 'smg' : 'rifle';
    const bot = {
      id: `${team}-${index}`,
      name: NAMES[team][index],
      team,
      body: makeBody(x, z, 1.72, 1.6),
      parts,
      health: 100,
      armor: round === 1 ? 0 : 100,
      alive: true,
      weaponKey,
      weapon: WEAPONS[weaponKey],
      skill,
      state: 'route',
      route: [],
      routeIndex: 0,
      holdNode: -1,
      site: null,
      target: null,
      lastSeen: null,
      reactAt: 0,
      perceiveAt: Math.random() * PERCEIVE_EVERY,
      burstLeft: 0,
      fireAt: 0,
      strafeDir: 1,
      strafeAt: 0,
      plantProgress: 0,
      defuseProgress: 0,
      fall: 0,
      investigateAt: 0,
      investigateNode: -1,
    };
    parts.torso.userData.bot = bot;
    parts.head.userData.bot = bot;
    parts.legL.userData.bot = bot;
    parts.legR.userData.bot = bot;
    hitMeshes.push(parts.torso, parts.head, parts.legL, parts.legR);
    bots.push(bot);
    return bot;
  }

  function reset(attackSpawns, defendSpawns, round, assignments) {
    for (const bot of bots) {
      scene.remove(bot.parts.group);
    }
    bots.length = 0;
    hitMeshes.length = 0;
    for (let index = 0; index < 4; index += 1) {
      const bot = spawnBot('attack', index, attackSpawns[index], round);
      bot.site = assignments.attack[index];
      bot.holdNode = assignments.attack[index] === 'A' ? 14 : assignments.attack[index] === 'B' ? 20 : 6;
    }
    for (let index = 0; index < 4; index += 1) {
      const bot = spawnBot('defend', index, defendSpawns[index], round);
      bot.site = assignments.defend[index];
      bot.holdNode = assignments.defend[index] === 'A' ? 24 : assignments.defend[index] === 'B' ? 25 : 6;
    }
    // One attacker carries the bomb: the first bot heading for a site.
    const carrier = bots.find((bot) => bot.team === 'attack' && bot.site !== 'mid');
    if (carrier) carrier.carriesBomb = true;
  }

  function eyeOf(body) {
    return new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z);
  }
  const chestOf = (body) => new THREE.Vector3(body.position.x, body.position.y + 1.05, body.position.z);

  function planRoute(bot, goalNode) {
    if (bot.routeGoal === goalNode && bot.route.length > 0) return;
    bot.routeGoal = goalNode;
    const start = nearestNode(WAYPOINTS.map(([x, z]) => ({ x, z })), bot.body.position.x, bot.body.position.z);
    bot.route = findRoute(WAYPOINTS.map(([x, z]) => ({ x, z })), EDGES, start, goalNode);
    bot.routeIndex = 0;
  }

  function followRoute(bot, dt) {
    if (bot.routeIndex >= bot.route.length) return true;
    const node = WAYPOINTS[bot.route[bot.routeIndex]];
    const dx = node[0] - bot.body.position.x;
    const dz = node[1] - bot.body.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.7) {
      bot.routeIndex += 1;
      return bot.routeIndex >= bot.route.length;
    }
    const wishX = dx / distance;
    const wishZ = dz / distance;
    bot.body.yaw = Math.atan2(-wishX, -wishZ);
    moveBody(bot.body, colliders, dt, wishX, wishZ, WALK_SPEED, false);
    return false;
  }

  function faceToward(bot, x, z) {
    const dx = x - bot.body.position.x;
    const dz = z - bot.body.position.z;
    bot.body.yaw = Math.atan2(-dx, -dz);
  }

  function step(dt, api) {
    now += dt;
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.parts.group.rotation.x = -bot.fall * 1.45;
        bot.parts.group.position.y = -bot.fall * 0.08;
        continue;
      }
      // Perception, staggered so not every bot scans on the same frame. A flashed bot
      // sees nothing until its blindness wears off.
      const blinded = now < (bot.blindUntil || 0);
      if (now >= bot.perceiveAt && !blinded) {
        bot.perceiveAt = now + PERCEIVE_EVERY;
        const eye = eyeOf(bot.body);
        let best = null;
        let bestDistance = Infinity;
        for (const enemy of api.enemiesOf(bot)) {
          if (!enemy.alive) continue;
          const chest = chestOf(enemy.body);
          const distance = eye.distanceTo(chest);
          if (distance > 60) continue;
          if (!hasLineOfSight(shootables, eye, chest)) continue;
          if (smokeBlocks(eye, chest)) continue;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = enemy;
          }
        }
        if (best) {
          if (bot.target !== best) {
            bot.target = best;
            bot.reactAt = now + 0.35 + (1 - bot.skill) * 0.45;
            bot.burstLeft = 0;
          }
          bot.lastSeen = { x: best.body.position.x, y: best.body.position.y + 1.05, z: best.body.position.z, time: now };
        } else if (bot.target && (!bot.lastSeen || now - bot.lastSeen.time > 2)) {
          bot.target = null;
        }
      }

      // Hearing: a recent loud noise nearby pulls an idle bot to look.
      if (!bot.target && api.noises.length > 0) {
        const noise = api.noises[api.noises.length - 1];
        const distance = Math.hypot(noise.x - bot.body.position.x, noise.z - bot.body.position.z);
        if (distance < 25 && now > bot.investigateAt) {
          bot.investigateAt = now + 4;
          bot.investigateNode = nearestNode(WAYPOINTS.map(([x, z]) => ({ x, z })), noise.x, noise.z);
          if (bot.state === 'hold') {
            planRoute(bot, bot.investigateNode);
            bot.state = 'route';
          }
        }
      }

      const bomb = api.bomb;
      if (bot.target) {
        bot.state = 'engage';
        bot.plantProgress = 0;
        bot.defuseProgress = 0;
      } else if (bot.team === 'attack' && bomb.state === 'planted') {
        if (bot.state !== 'hold') {
          const siteNode = bomb.site === 'A' ? 14 : 20;
          planRoute(bot, siteNode);
          bot.state = 'route';
        }
      } else if (bot.team === 'defend' && bomb.state === 'planted') {
        if (bot.state !== 'defuse' && bot.state !== 'route') {
          const siteNode = bomb.site === 'A' ? 14 : 20;
          planRoute(bot, siteNode);
          bot.state = 'route';
        }
      } else if (bot.state === 'route' && bot.route.length === 0) {
        planRoute(bot, bot.holdNode);
      }

      if (bot.state === 'engage' && bot.target) {
        const target = bot.target;
        faceToward(bot, target.body.position.x, target.body.position.z);
        // Strafe while fighting, so a bot is not a standing target.
        if (now >= bot.strafeAt) {
          bot.strafeAt = now + 0.7 + Math.random() * 0.8;
          bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        const sin = Math.sin(bot.body.yaw);
        const cos = Math.cos(bot.body.yaw);
        moveBody(bot.body, colliders, dt, cos * bot.strafeDir * 0.5, -sin * bot.strafeDir * 0.5, WALK_SPEED * 0.45, false);
        if (now >= bot.reactAt && now >= bot.fireAt && !blinded) {
          if (bot.burstLeft <= 0) {
            bot.burstLeft = 3 + Math.floor(Math.random() * 3);
            bot.fireAt = now + 0.4 + Math.random() * 0.5;
          } else {
            bot.burstLeft -= 1;
            bot.fireAt = now + bot.weapon.gap;
            api.onBotShot(bot, target);
          }
        }
      } else if (bot.state === 'route') {
        const arrived = followRoute(bot, dt);
        if (arrived) {
          if (bot.team === 'attack' && bomb.state !== 'planted' && bot.carriesBomb && bot.site !== 'mid') {
            const site = SITES[bot.site];
            if (pointInSite(bot.body.position.x, bot.body.position.z, site)) {
              bot.state = 'plant';
              bot.plantProgress = 0;
            } else {
              bot.state = 'hold';
            }
          } else if (bot.team === 'defend' && bomb.state === 'planted') {
            const distance = Math.hypot(bomb.position.x - bot.body.position.x, bomb.position.z - bot.body.position.z);
            if (distance < 2.2) {
              bot.state = 'defuse';
              bot.defuseProgress = 0;
            } else {
              bot.state = 'hold';
            }
          } else {
            bot.state = 'hold';
          }
        }
      } else if (bot.state === 'plant') {
        bot.plantProgress += dt;
        if (bot.plantProgress >= PLANT_TIME) {
          bot.state = 'hold';
          bot.plantProgress = 0;
          api.onBotPlant(bot);
        }
      } else if (bot.state === 'defuse') {
        bot.defuseProgress += dt;
        if (bot.defuseProgress >= DEFUSE_TIME) {
          bot.state = 'hold';
          bot.defuseProgress = 0;
          api.onBotDefuse(bot);
        }
      } else if (bot.state === 'hold') {
        // A defender with a planted bomb walks straight to it and starts the defuse.
        if (bot.team === 'defend' && bomb.state === 'planted') {
          const distance = Math.hypot(bomb.position.x - bot.body.position.x, bomb.position.z - bot.body.position.z);
          if (distance > 2.0) {
            const dx = bomb.position.x - bot.body.position.x;
            const dz = bomb.position.z - bot.body.position.z;
            const length = Math.hypot(dx, dz) || 1;
            faceToward(bot, bomb.position.x, bomb.position.z);
            moveBody(bot.body, colliders, dt, dx / length, dz / length, WALK_SPEED, false);
          } else {
            bot.state = 'defuse';
            bot.defuseProgress = 0;
          }
        } else if (bot.lastSeen && now - bot.lastSeen.time < 3) {
          // Hold the angle: face the site entry or the last known enemy direction.
          faceToward(bot, bot.lastSeen.x, bot.lastSeen.z);
        } else {
          const node = WAYPOINTS[bot.holdNode];
          if (node) faceToward(bot, node[0], node[1] - 4);
        }
      }

      // Sync the mesh to the body.
      bot.parts.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
      bot.parts.group.rotation.y = bot.body.yaw;
      const speed = groundSpeed(bot.body);
      const swing = Math.min(1, speed / WALK_SPEED) * 0.5;
      bot.parts.legL.rotation.x = Math.sin(now * 9) * swing;
      bot.parts.legR.rotation.x = -Math.sin(now * 9) * swing;
    }
  }

  function pointInSite(x, z, site) {
    return x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ;
  }

  return {
    bots,
    hitMeshes,
    step,
    reset,
    eyeOf,
    chestOf,
  };
}
