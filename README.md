# dustline-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Harianrevi1/dustline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Harianrevi1/dustline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

DUSTLINE is a 5v5 round-based tactical FPS in three.js: plant or defuse the bomb on the dusk industrial yard, earn credits, buy rifles and grenades, and outplay bots that hold angles, listen, and retake.

Two teams fight over two bombsites on an original map, Dustline Yard — a 44×36 m yard with a crane yard (A), a silo (B), a mid lane and a connector. Rounds are first to 8 (max 15, sides swap after 7): win by eliminating the other team or by the bomb. A freeze-time buy menu offers 4 weapons, armour and 3 grenades; kills and round wins pay credits, losses build a streak bonus. Bots route along a waypoint graph, hold angles, react to sight and sound, plant and defuse, and fight in bursts with aim error that grows with distance and target speed. Gunplay has headshot damage, recoil and bloom that punish moving fire, ADS, crouch and jump. The HUD carries health, armour, ammo, money, timer, score, kill feed, bomb status, a plant/defuse bar and a live minimap. All sound is synthesised WebAudio — no audio files — and the game runs fully offline from static files.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 and click to play. `WASD` move, mouse look, click fire, right-click aim, `R` reload, `1–4` weapons, `B` buy, `Q` cycle grenade, `G` throw, `E` plant/defuse, `Ctrl` crouch, `Space` jump.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x7g0n0hz&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
