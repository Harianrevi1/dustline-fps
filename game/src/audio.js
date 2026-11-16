// Sound, synthesized: every effect is an oscillator or filtered noise built in code, so the
// game ships no audio files and plays offline. The context is created on the first user
// gesture, as browsers require.
export function createAudio() {
  let context = null;
  let master = null;

  function ensure() {
    if (context) return true;
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      master = context.createGain();
      master.gain.value = 0.45;
      master.connect(context.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, duration, type, gain, slideTo) {
    if (!ensure()) return;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const amp = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, start);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(amp);
    amp.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function noise(duration, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const start = context.currentTime;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(start);
  }

  return {
    unlock() {
      ensure();
    },
    shot(weapon) {
      if (weapon === 'dmr') {
        noise(0.22, 900, 0.9);
        tone(90, 0.18, 'sine', 0.8, 40);
      } else if (weapon === 'shotgun') {
        noise(0.3, 700, 1.0);
        tone(70, 0.25, 'sine', 0.9, 35);
      } else if (weapon === 'smg') {
        noise(0.08, 1800, 0.5);
        tone(160, 0.06, 'square', 0.25, 90);
      } else if (weapon === 'sidearm') {
        noise(0.1, 1500, 0.6);
        tone(140, 0.08, 'square', 0.3, 70);
      } else {
        noise(0.12, 1200, 0.7);
        tone(120, 0.1, 'square', 0.35, 60);
      }
    },
    enemyShot(distance) {
      const gain = Math.max(0.08, 0.5 - distance * 0.012);
      noise(0.1, 1000, gain);
    },
    reload() {
      tone(700, 0.05, 'square', 0.2);
      setTimeout(() => tone(500, 0.05, 'square', 0.2), 180);
    },
    hit() {
      tone(1200, 0.06, 'sine', 0.35);
    },
    kill() {
      tone(1200, 0.06, 'sine', 0.35);
      setTimeout(() => tone(1600, 0.09, 'sine', 0.35), 70);
    },
    hurt() {
      tone(180, 0.12, 'sawtooth', 0.3, 90);
    },
    plantBeep() {
      tone(1000, 0.08, 'sine', 0.3);
    },
    bombBeep() {
      tone(1400, 0.07, 'sine', 0.3);
    },
    explosion() {
      noise(1.2, 300, 1.0);
      tone(60, 1.0, 'sine', 0.9, 28);
    },
    flash() {
      tone(2400, 0.8, 'sine', 0.25, 1800);
    },
    buy() {
      tone(880, 0.07, 'sine', 0.3);
      setTimeout(() => tone(1320, 0.1, 'sine', 0.3), 80);
    },
    denied() {
      tone(160, 0.15, 'square', 0.25);
    },
    roundWin() {
      [523, 659, 784].forEach((freq, index) => {
        setTimeout(() => tone(freq, 0.18, 'sine', 0.3), index * 110);
      });
    },
    roundLose() {
      [392, 330, 262].forEach((freq, index) => {
        setTimeout(() => tone(freq, 0.2, 'sine', 0.3), index * 120);
      });
    },
    defuse() {
      tone(900, 0.06, 'sine', 0.25);
      setTimeout(() => tone(900, 0.06, 'sine', 0.25), 120);
    },
  };
}
