// The DOM HUD: crosshair, hit marker, health and armour, ammunition, money, the round
// timer and the score, the kill feed, the buy menu, a minimap and the overlay panels. It
// never touches the simulation; main.js pushes numbers in and reads the play callback out.
// The minimap draws the world's own collider footprints, so it can never drift from the map.
import { BUY_ITEMS } from './match.js';

const COPY = {
  menu: {
    title: 'DUSTLINE',
    copy: 'A dusk yard, two bombsites, five against five. Plant the device or wipe the other team. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSTLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: { title: '', copy: '', action: 'Next round' },
  matchEnd: { title: '', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthValue = $('health-value');
  const healthBar = $('health-bar');
  const armorValue = $('armor-value');
  const armorBar = $('armor-bar');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const roundValue = $('round-value');
  const scoreSable = $('score-sable');
  const scoreRust = $('score-rust');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const bombTimer = $('bomb-timer');
  const progressBar = $('progress-bar');
  const progressLabel = $('progress-label');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const hint = $('hint');
  const flashOverlay = $('flash-overlay');
  const damageOverlay = $('damage-overlay');
  const grenadeCounts = $('grenade-counts');
  const minimap = $('minimap');
  const mapContext = minimap.getContext('2d');

  let hitTimer = 0;
  let last = {};
  let colliders = [];
  let mapTimer = 0;

  // The buy menu is built once from the match's own item table.
  for (const item of BUY_ITEMS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-item';
    row.dataset.item = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-label">${item.label}</span><span class="buy-price">$${item.price}</span>`;
    buyItems.appendChild(row);
  }

  function setText(element, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    element.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      setText(weaponName, name, 'weapon');
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      setText(healthValue, String(Math.max(0, Math.ceil(health))), 'health');
      setText(armorValue, String(Math.max(0, Math.ceil(armor))), 'armor');
      healthBar.style.width = `${Math.max(0, health)}%`;
      armorBar.style.width = `${Math.max(0, armor)}%`;
    },
    setMoney(money) {
      setText(moneyValue, `$${money}`, 'money');
    },
    setTimer(seconds, bombLeft) {
      const value = bombLeft != null ? `BOMB ${Math.ceil(bombLeft)}` : formatTime(seconds);
      setText(timerValue, value, 'timer');
      timerValue.classList.toggle('danger', (bombLeft ?? seconds) <= 10);
    },
    setScore(round, sable, rust) {
      setText(roundValue, `ROUND ${round}/15`, 'round');
      setText(scoreSable, String(sable), 'sable');
      setText(scoreRust, String(rust), 'rust');
    },
    setGrenades(counts, selected) {
      const text = `Frag ${counts.frag} · Smoke ${counts.smoke} · Flash ${counts.flash} — Q cycles, G throws (${selected})`;
      setText(grenadeCounts, text, 'grenades');
    },
    setCrosshair(spreadPx) {
      crosshair.style.setProperty('--spread', `${Math.round(spreadPx)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damageOverlay.classList.add('on');
      setTimeout(() => damageOverlay.classList.remove('on'), 180);
    },
    flashBang(strength) {
      flashOverlay.style.opacity = String(Math.min(1, strength));
      setTimeout(() => {
        flashOverlay.style.opacity = '0';
      }, 900);
    },
    addKill(killer, victim, headshot) {
      const row = document.createElement('div');
      row.className = 'kill-row';
      row.innerHTML = `<b>${killer}</b> ${headshot ? '◉' : '✕'} <b>${victim}</b>`;
      killfeed.prepend(row);
      while (killfeed.children.length > 4) killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    setBombStatus(text) {
      setText(bombStatus, text, 'bombStatus');
      bombStatus.hidden = !text;
    },
    setBombTimer(text) {
      setText(bombTimer, text, 'bombTimer');
      bombTimer.hidden = !text;
    },
    setProgress(label, fraction) {
      if (!label) {
        progressBar.hidden = true;
        return;
      }
      progressBar.hidden = false;
      progressLabel.textContent = label;
      progressBar.firstElementChild.style.width = `${Math.round(fraction * 100)}%`;
    },
    setHint(text) {
      setText(hint, text, 'hint');
      hint.hidden = !text;
    },
    showBuy(open, money) {
      buyMenu.hidden = !open;
      for (const row of buyItems.children) {
        const item = BUY_ITEMS.find((entry) => entry.id === row.dataset.item);
        row.classList.toggle('poor', money < item.price);
      }
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      if (mode === 'roundEnd') {
        title.textContent = data.winner === 'draw' ? 'Round drawn' : `${data.winner === 'sable' ? 'Sable' : 'Rust'} takes the round`;
        copy.textContent = `${data.reason} — Sable ${data.score.sable} · Rust ${data.score.rust}.`;
        play.textContent = 'Next round';
      } else if (mode === 'matchEnd') {
        title.textContent = data.winner === 'draw' ? 'Match drawn' : `${data.winner === 'sable' ? 'Sable' : 'Rust'} wins the match`;
        copy.textContent = `Final score — Sable ${data.score.sable} · Rust ${data.score.rust}.`;
        play.textContent = 'Play again';
      } else {
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuy(handler) {
      buyItems.addEventListener('click', (event) => {
        const row = event.target.closest('.buy-item');
        if (row) handler(row.dataset.item);
      });
    },
    setMap(footprints) {
      colliders = footprints;
    },
    drawMinimap(dt, player, teammates, enemies, bomb) {
      mapTimer -= dt;
      if (mapTimer > 0) return;
      mapTimer = 0.2;
      const width = minimap.width;
      const height = minimap.height;
      const scaleX = width / 46;
      const scaleZ = height / 38;
      const toX = (x) => (x + 23) * scaleX;
      const toY = (z) => (z + 19) * scaleZ;
      mapContext.clearRect(0, 0, width, height);
      mapContext.fillStyle = 'rgba(14, 16, 22, 0.9)';
      mapContext.fillRect(0, 0, width, height);
      mapContext.fillStyle = '#e8a33d';
      mapContext.font = 'bold 11px system-ui, sans-serif';
      mapContext.textAlign = 'center';
      mapContext.fillText('A', toX(-15), toY(-11) + 4);
      mapContext.fillText('B', toX(15), toY(-11) + 4);
      mapContext.fillStyle = '#8b93a1';
      for (const box of colliders) {
        mapContext.fillRect(toX(box.minX), toY(box.minZ), (box.maxX - box.minX) * scaleX, (box.maxZ - box.minZ) * scaleZ);
      }
      for (const mate of teammates) {
        if (!mate.alive) continue;
        mapContext.fillStyle = '#5b8dd9';
        mapContext.beginPath();
        mapContext.arc(toX(mate.body.position.x), toY(mate.body.position.z), 3, 0, Math.PI * 2);
        mapContext.fill();
      }
      for (const enemy of enemies) {
        if (!enemy.alive || !enemy.spotted) continue;
        mapContext.fillStyle = '#d96a4f';
        mapContext.beginPath();
        mapContext.arc(toX(enemy.body.position.x), toY(enemy.body.position.z), 3, 0, Math.PI * 2);
        mapContext.fill();
      }
      if (bomb && bomb.state === 'planted' && bomb.position) {
        mapContext.fillStyle = '#e8a33d';
        mapContext.beginPath();
        mapContext.arc(toX(bomb.position.x), toY(bomb.position.z), 4, 0, Math.PI * 2);
        mapContext.fill();
      }
      const px = toX(player.position.x);
      const py = toY(player.position.z);
      mapContext.save();
      mapContext.translate(px, py);
      mapContext.rotate(-player.yaw);
      mapContext.fillStyle = '#ece7db';
      mapContext.beginPath();
      mapContext.moveTo(0, -6);
      mapContext.lineTo(4, 5);
      mapContext.lineTo(-4, 5);
      mapContext.closePath();
      mapContext.fill();
      mapContext.restore();
    },
  };
}

function formatTime(seconds) {
  const left = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
