// The local player: look, crouch and the wish direction fed into the shared mover. All
// collision lives in physics.js; this module only decides how the player wants to move.
import { groundSpeed, makeBody, moveBody } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;

export function createPlayer(colliders, x = 0, z = 14) {
  const body = makeBody(x, z, STAND_HEIGHT, STAND_EYE);
  body.yaw = 0;
  let wishX = 0;
  let wishZ = 0;

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys, speedScale = 1) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wishX = 0;
    wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      const length = Math.hypot(-sin * forward + cos * strafe, -cos * forward - sin * strafe) || 1;
      wishX = (-sin * forward + cos * strafe) / length;
      wishZ = (-cos * forward - sin * strafe) / length;
    }
    const speed = (body.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
    moveBody(body, colliders, dt, wishX, wishZ, speed, keys.has('Space'));
  }

  return {
    body,
    step,
    look,
    recoil,
    groundSpeed() {
      return groundSpeed(body);
    },
  };
}
