# Canvas Platformer

A 3-stage HTML5 Canvas platformer game built with Vanilla JavaScript. No external libraries, no external images — pure Canvas API.

**Play it here:** https://hariku0212.github.io/portfolio-platformer-game/

---

## How to Play

Reach the **green flag** at the end of each stage to advance. Complete all 3 stages to win!

- **Collect coins** for +10 points each
- **Stomp enemies** (jump on top of them) for +50 points each
- **Don't fall off** the stage — you lose a life!
- You have **3 lives** total. Lose them all and it's Game Over.

---

## Controls

### Keyboard

| Action | Keys |
|--------|------|
| Move Left | `←` / `A` |
| Move Right | `→` / `D` |
| Jump | `↑` / `W` / `Space` |
| Double Jump | Press jump again while airborne |

### Mobile (Touch)

| Button | Location | Action |
|--------|----------|--------|
| ◀ | Bottom-left | Move Left |
| ▶ | Bottom-left (inner) | Move Right |
| ▲ | Bottom-right | Jump / Double Jump |

---

## Game Mechanics

- **Double Jump** — Press jump once to jump, press again in mid-air for a second jump. Resets on landing.
- **Stomp Attack** — Land on top of an enemy while falling to defeat them and bounce upward.
- **Moving Platforms** — Purple platforms with `↔` arrows move back and forth. Ride them carefully!
- **Invincibility Frames** — After taking damage, you flash for 2 seconds and are invulnerable.
- **Parallax Scrolling** — Background layers scroll at different speeds for depth.

---

## Stages

| Stage | Name | Width | Coins | Enemies | Difficulty |
|-------|------|-------|-------|---------|------------|
| 1 | はじめの一歩 | 2400px | 8 | 2 | Easy |
| 2 | 空への挑戦 | 3200px | 12 | 4 | Normal |
| 3 | 頂上決戦 | 4000px | 16 | 6 | Hard |

---

## Tech Stack

| Item | Details |
|------|---------|
| Language | Vanilla JavaScript (ES6+) |
| Rendering | HTML5 Canvas API (800×450px) |
| Audio | Web Audio API (procedurally generated) |
| Styling | CSS3 |
| External Libraries | **None** |
| External Images | **None** (all drawn with Canvas) |
| Target FPS | 60fps (requestAnimationFrame) |
| Browser Support | Chrome / Firefox / Safari / Edge (latest) |
| Mobile Support | iOS Safari / Android Chrome |

---

## Project Structure

```
portfolio-platformer-game/
├── index.html   — Canvas element, DOM structure
├── game.js      — All game logic (12 classes)
├── style.css    — Layout and canvas positioning
└── README.md    — This file
```

### Class Architecture (`game.js`)

| Class | Responsibility |
|-------|---------------|
| `Game` | Main loop, state management, input handling |
| `Player` | Physics, collision, rendering |
| `Enemy` | Patrol AI, crush animation |
| `Coin` | Float animation, collection |
| `Platform` | Fixed and moving platforms |
| `GoalObject` | Stage goal (flag pole) |
| `Particle` | Single particle physics |
| `ParticleSystem` | Particle emission and pooling |
| `AudioManager` | Web Audio API sound effects |
| `Camera` | Horizontal scrolling |
| `HUD` | Score, lives, timer, coin counter |
| `Stage` | Stage data factory (3 stages) |

---

## License

MIT License — Feel free to use as portfolio reference.
