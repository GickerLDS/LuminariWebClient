# LuminariWebClient

Web-based MUD client for **LuminariMUD-compatible** games with:

- a browser terminal view for ANSI-colored game output
- a side-panel HUD for player stats
- HP, PSP, movement, EXP, and opponent bars
- an MSDP-driven room panel with `ROOM_NAME`, `AREA_NAME`, `ROOM_EXITS`, and `MINIMAP`
- a Node WebSocket/Telnet proxy so the browser can connect to Telnet-based MUDs

## Architecture

Browsers cannot connect directly to a Telnet MUD server, so this project is split into two parts:

1. **React + Vite frontend** for the terminal UI and HUD
2. **Node proxy** that:
   - accepts browser WebSocket connections at `/ws`
   - connects to the MUD over Telnet
   - negotiates MSDP
   - sends `REPORT` for the variables the UI needs
   - forwards terminal text and structured MSDP updates back to the browser

The proxy is tuned for Luminari-style MSDP variables such as `HEALTH`, `HEALTH_MAX`, `EXPERIENCE`, `ROOM_NAME`, `ROOM_EXITS`, and `MINIMAP`.

## Getting started

```bash
npm install
npm run dev
```

That starts:

- the Vite frontend on `http://localhost:5173`
- the Node proxy on `http://localhost:3210`

During development, Vite proxies `/ws` traffic to the Node server automatically.

## Production build

```bash
npm run build
npm start
```

`npm start` serves the built frontend and the WebSocket endpoint from the same Node process.

## Default connection target

The UI defaults to:

- **Host:** `LuminariMUD.com`
- **Port:** `4100`

You can change that in the connection form at runtime.

## Environment variables

### Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3210` | HTTP/WebSocket port for the Node proxy/server |

### Frontend

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_DEFAULT_MUD_HOST` | `LuminariMUD.com` | Initial host shown in the connect form |
| `VITE_DEFAULT_MUD_PORT` | `4100` | Initial port shown in the connect form |
| `VITE_WS_URL` | same-origin `/ws` | Override the browser WebSocket target |

## Verified scripts

```bash
npm run lint
npm run build
```

## Current MSDP usage

The proxy currently reports and maps these categories into the UI:

- **Character:** `CHARACTER_NAME`, `LEVEL`, `CLASS`, `RACE`
- **Bars:** `HEALTH`, `HEALTH_MAX`, `PSP`, `PSP_MAX`, `MOVEMENT`, `MOVEMENT_MAX`, `EXPERIENCE`, `EXPERIENCE_MAX`, `EXPERIENCE_TNL`
- **Combat:** `OPPONENT_NAME`, `OPPONENT_HEALTH`, `OPPONENT_HEALTH_MAX`
- **Room/map:** `ROOM`, `ROOM_NAME`, `AREA_NAME`, `ROOM_VNUM`, `ROOM_EXITS`, `MINIMAP`
- **Misc:** `ATTACK_BONUS`, `DAMAGE_BONUS`, `AC`, `ALIGNMENT`, `MONEY`, `PRACTICE`, `POSITION`

Server-level MSDP fields such as `SERVER_ID` are also requested so the bridge can be validated before character login completes.
