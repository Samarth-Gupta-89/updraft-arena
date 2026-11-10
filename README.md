# Updraft Arena

Multiplayer browser FPS. Lift opponents into the air, then push them over the arena wall. Anyone who falls out is knocked out.

## Run it

Needs Node.js 18+ (you have 24).

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000.

## Playing with friends

The game is one Node server. Whoever can reach that server can play.

| Where your friends are | What to do |
|---|---|
| Same Wi-Fi as you | Run `npm start` on your laptop. The lobby's invite link automatically uses your Wi-Fi address (e.g. `http://192.168.1.20:3000/?room=AB3CD`). The first time, Windows may ask to allow Node through the firewall — allow it on **Private networks**. |
| Anywhere (internet) | Put the server online. Easiest: push this folder to GitHub, then create a free **Web Service** on render.com → Build command `npm install`, Start command `npm start`. Render gives you a public `https://…onrender.com` address; invite links then work for everyone. Any Node host with WebSocket support works (Railway, Fly.io, a VPS). |
| Quick test over the internet, no hosting | Run a tunnel such as `cloudflared tunnel --url http://localhost:3000` and open the `https://…trycloudflare.com` address it prints. Links from that page work for anyone while your laptop and the tunnel are running. |

## How a match works

1. Open the page, enter name + email.
2. Create **Deathmatch** (up to 10, first to 15 knockouts) or **Team Battle** (Red vs Blue, 5 per team, first team to 25).
3. Copy the invite link and send it. Friends open it, enter name + email, and land in your lobby.
4. You (the host) press **Start match** whenever you want. People can also join mid-match.
5. Matches last 7 minutes max. After the results screen everyone returns to the lobby and the host can start again.

## Controls

| Key | Action |
|---|---|
| W A S D / arrows | Move |
| Space | Jump (swim up in water) |
| Shift | Sprint |
| Left click (or Q) | **LIFTER** — launches the target upward. Hits stack: keep shooting to send them higher. |
| Right click (or E) | **SHOVER** — knocks the target back. Much stronger while they're airborne. |
| Tab | Scoreboard |
| Esc | Free the mouse |

Each gun holds 30 shots. Glowing pads on the map refill +15 (cyan = Lifter, amber = Shover; green = 2 air dashes, used with Shift while in the air) and come back 12 s after pickup. You respawn with full ammo and 2 s of spawn protection (shown as a bubble; it ends when you shoot).

Rough numbers: 3 quick Lifter hits put someone just above the 4.5 m wall; a Shover hit then carries them about 10 m.

## Where things live

| File | What it does |
|---|---|
| `server.js` | Web server + WebSocket game server: rooms, lobby, match timer, scoring, hit validation, pickups, respawns |
| `public/js/shared/map.js` | Map layout and all gameplay numbers (used by both server and browser) — tune the game here |
| `public/js/game.js` | Game loop, input, shooting, network sync |
| `public/js/physics.js` | Player movement, collisions, water, lift/push reactions |
| `public/js/world.js` | Sky, terrain, pond, walls, cliffs, cover, grass, scenery, pickups |
| `public/js/weapons.js` | First-person guns and shot effects |
| `public/js/avatar.js` | Other players' models and smoothing |
| `public/js/hud.js`, `main.js` | HUD and menus |
| `data/players.csv` | Name + email of everyone who entered (created on first run) |

All textures and sounds are generated in code — there are no asset files.

## Performance

Built to run smoothly in Chrome or Edge on ordinary laptops with built-in (integrated) graphics: simple lighting, no shadows, no scenery outside the arena. If the frame rate drops, the game automatically renders at a lower resolution. On computers with no graphics acceleration it switches to a low-quality mode by itself; you can also force it by adding `&quality=low` to the link.

## Known limits

- Desktop only for now (mouse + keyboard). Mobile controls are the next step.
- Each player's own computer decides where they are (fine among friends; not cheat-proof).
- Rooms live in server memory: restarting the server ends all rooms.
