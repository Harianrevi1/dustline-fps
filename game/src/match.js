// The match: rounds, the bomb, the economy and the buy menu. One state machine, kept apart
// from rendering: main.js feeds it facts (who is alive, who is planting) and it emits events
// the HUD and the sound bank listen to. First to 8 round wins takes the match, at most 15
// rounds; the sides swap at the half, after round 7.
import { SITES } from './world.js';
import { WEAPONS, GRENADES } from './weapons.js';

const FREEZE_SECONDS = 8;
const ROUND_SECONDS = 100;
const BOMB_FUSE = 40;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5;
const WIN_SCORE = 8;
const MAX_ROUNDS = 15;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_BASE = 1900;
const PLANT_REWARD = 300;
const DEFUSE_REWARD = 300;

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', label: 'VK-47 Rifle', price: WEAPONS.rifle.price },
  { key: '2', id: 'smg', label: 'Sting SMG', price: WEAPONS.smg.price },
  { key: '3', id: 'dmr', label: 'Longshot DMR', price: WEAPONS.dmr.price },
  { key: '4', id: 'shotgun', label: 'Breach Shotgun', price: WEAPONS.shotgun.price },
  { key: '5', id: 'armor', label: 'Kevlar Armor', price: 650 },
  { key: '6', id: 'frag', label: 'Frag Grenade', price: GRENADES.frag.price },
  { key: '7', id: 'smoke', label: 'Smoke Grenade', price: GRENADES.smoke.price },
  { key: '8', id: 'flash', label: 'Flash Grenade', price: GRENADES.flash.price },
];

export function createMatch(onEvent) {
  const state = {
    phase: 'menu',
    round: 1,
    half: 'first',
    score: { sable: 0, rust: 0 },
    money: 800,
    lossStreak: 0,
    freezeLeft: FREEZE_SECONDS,
    roundLeft: ROUND_SECONDS,
    roundEndLeft: 0,
    bomb: { state: 'carried', site: null, position: null, carrier: null, plantedAt: 0 },
    plantProgress: 0,
    defuseProgress: 0,
    winner: null,
    winReason: null,
    playerTeam: 'sable',
    kills: 0,
    deaths: 0,
  };

  function teamRole(team) {
    // Sable attacks in the first half, defends in the second.
    const sableAttacks = state.half === 'first';
    if (team === 'sable') return sableAttacks ? 'attack' : 'defend';
    return sableAttacks ? 'defend' : 'attack';
  }

  function emit(type, data) {
    onEvent(type, data ?? {});
  }

  function startRound() {
    state.phase = 'freeze';
    state.freezeLeft = FREEZE_SECONDS;
    state.roundLeft = ROUND_SECONDS;
    state.bomb = { state: 'carried', site: null, position: null, carrier: null, plantedAt: 0 };
    state.plantProgress = 0;
    state.defuseProgress = 0;
    emit('roundStart', { round: state.round, half: state.half });
  }

  function startMatch() {
    state.phase = 'freeze';
    state.round = 1;
    state.half = 'first';
    state.score = { sable: 0, rust: 0 };
    state.money = 800;
    state.lossStreak = 0;
    state.winner = null;
    state.winReason = null;
    startRound();
  }

  function endRound(winnerTeam, reason) {
    if (state.phase !== 'live' && state.phase !== 'freeze') return;
    state.phase = 'roundEnd';
    state.roundEndLeft = 4;
    state.winner = winnerTeam;
    state.winReason = reason;
    state.score[winnerTeam] += 1;
    const playerWon = winnerTeam === state.playerTeam;
    if (playerWon) {
      state.money += WIN_REWARD;
      state.lossStreak = 0;
    } else {
      state.money += Math.min(3400, LOSS_BASE + 500 * state.lossStreak);
      state.lossStreak += 1;
    }
    emit('roundEnd', { winner: winnerTeam, reason, score: { ...state.score } });
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const winner = state.score.sable === state.score.rust ? 'draw' : state.score.sable > state.score.rust ? 'sable' : 'rust';
    state.winner = winner;
    emit('matchEnd', { winner, score: { ...state.score } });
  }

  function nextRound() {
    if (state.score.sable >= WIN_SCORE || state.score.rust >= WIN_SCORE || state.round >= MAX_ROUNDS) {
      endMatch();
      return;
    }
    state.round += 1;
    if (state.round === 8) {
      state.half = 'second';
      emit('halftime', {});
    }
    startRound();
  }

  function plantBomb(carrier, siteName, position) {
    if (state.phase !== 'live' || state.bomb.state !== 'carried') return false;
    state.bomb = { state: 'planted', site: siteName, position: { ...position }, carrier, plantedAt: state.roundLeft };
    if (carrier === 'player') state.money += PLANT_REWARD;
    emit('bombPlanted', { site: siteName, by: carrier, position: { ...position } });
    return true;
  }

  function defuseBomb(who) {
    if (state.phase !== 'live' || state.bomb.state !== 'planted') return false;
    state.bomb.state = 'defused';
    if (who === 'player') state.money += DEFUSE_REWARD;
    emit('bombDefused', { by: who });
    endRound(teamRole('sable') === 'defend' ? 'sable' : 'rust', 'defuse');
    return true;
  }

  function explodeBomb() {
    if (state.bomb.state !== 'planted') return;
    state.bomb.state = 'exploded';
    emit('bombExploded', { site: state.bomb.site, position: state.bomb.position });
    endRound(teamRole('sable') === 'attack' ? 'sable' : 'rust', 'bomb');
  }

  function buy(itemId) {
    if (state.phase !== 'freeze') return { ok: false, reason: 'buy menu is open only in the freeze' };
    const item = BUY_ITEMS.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, reason: 'no such item' };
    if (state.money < item.price) return { ok: false, reason: 'not enough money' };
    state.money -= item.price;
    emit('bought', { id: itemId, label: item.label, money: state.money });
    return { ok: true, item };
  }

  function step(dt, ctx) {
    if (state.phase === 'freeze') {
      state.freezeLeft -= dt;
      if (state.freezeLeft <= 0) {
        state.phase = 'live';
        emit('roundLive', { round: state.round });
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.roundEndLeft -= dt;
      if (state.roundEndLeft <= 0) nextRound();
      return;
    }
    if (state.phase !== 'live') return;

    state.roundLeft -= dt;

    // The bomb fuse runs on the round clock: plantedAt holds the seconds that were left.
    if (state.bomb.state === 'planted') {
      const elapsed = state.bomb.plantedAt - state.roundLeft;
      state.bomb.fuseLeft = BOMB_FUSE - elapsed;
      if (state.bomb.fuseLeft <= 0) {
        explodeBomb();
        return;
      }
    }

    // Planting and defusing progress while the key is held in the right place.
    if (state.bomb.state === 'carried' && ctx.playerPlanting) {
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_TIME) {
        const siteName = ctx.playerSite;
        plantBomb('player', siteName, { x: ctx.playerX, z: ctx.playerZ });
        state.plantProgress = 0;
      }
    } else {
      state.plantProgress = 0;
    }
    if (state.bomb.state === 'planted' && ctx.playerDefusing) {
      state.defuseProgress += dt;
      if (state.defuseProgress >= DEFUSE_TIME) {
        defuseBomb('player');
        state.defuseProgress = 0;
      }
    } else {
      state.defuseProgress = 0;
    }

    // Round end checks.
    const attackersAlive = ctx.aliveCount('attack');
    const defendersAlive = ctx.aliveCount('defend');
    const attackTeam = teamRole('sable') === 'attack' ? 'sable' : 'rust';
    const defendTeam = attackTeam === 'sable' ? 'rust' : 'sable';
    if (attackersAlive === 0 && state.bomb.state !== 'planted') {
      endRound(defendTeam, 'elimination');
      return;
    }
    if (defendersAlive === 0 && state.bomb.state !== 'planted') {
      endRound(attackTeam, 'elimination');
      return;
    }
    if (state.roundLeft <= 0 && state.bomb.state !== 'planted') {
      endRound(defendTeam, 'time');
    }
  }

  function onKill(killer, victim) {
    if (killer === 'player') {
      state.money += KILL_REWARD;
      state.kills += 1;
      emit('killReward', { money: state.money });
    }
    if (victim === 'player') state.deaths += 1;
    emit('kill', { killer, victim });
  }

  return {
    state,
    teamRole,
    startMatch,
    startRound,
    plantBomb,
    defuseBomb,
    explodeBomb,
    buy,
    step,
    onKill,
  };
}
