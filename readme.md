# LuminariWebClient

LuminariWebClient is a web-based MUD client for **LuminariMUD-compatible** games. It combines a React frontend with a Node WebSocket/Telnet proxy so a browser can connect to a Telnet MUD while still getting live MSDP-driven HUD data.

## Features

- Browser terminal with ANSI-colored game output
- Compact responsive layout optimized for smaller screens
- Auto-collapsing header after connect, with a small show/hide toggle
- Compact HUD with HP, PSP, movement, EXP, opponent, and tank bars
- Tank and opponent gauges with overlaid names
- MSDP-driven **MINIMAP** display
- Character tab with MSDP-fed profile and ability score grid (STR/DEX/CON/INT/WIS/CHA)
- Sidebar tabs for Character, Quests, Group, and Affects
- Group tab formatting with per-member spacing, leader marker, and compact stat line (`Health x/y Move a/b`)
- Quest tab HTML rendering for structured quest payloads (including JSON array/object data)
- Affects tab rendering for nested MSDP data
- Numpad movement support
- Command history with ArrowUp / ArrowDown
- Movement commands excluded from command history
- Click-anywhere focus behavior for the command input
- MUD preset dropdown plus manual host/port entry
- Luminari `^` color-code rendering in non-terminal UI text
- Shared settings file for ports, defaults, presets, and personalization
- Node proxy that negotiates MSDP and bridges browser WebSocket traffic to the MUD

## Architecture

Browsers cannot talk to a Telnet MUD directly, so the app is split into two parts:

1. **React + Vite frontend**
2. **Node proxy server**

The proxy:

- accepts browser WebSocket connections at `/ws`
- connects to the MUD over Telnet
- negotiates MSDP
- requests the variables the UI needs
- forwards terminal output and structured MSDP updates back to the browser

## Setup

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

This starts:

- the Vite frontend on the client port from `shared/app-settings.ts`
- the Node proxy on the server port from `shared/app-settings.ts`

Vite proxies `/ws` traffic to the Node server automatically during development.

## Production build and run

Build the production version:

```bash
npm run build
```

Run the built app:

```bash
npm start
```

`npm start` serves both:

- the built frontend
- the WebSocket/Telnet proxy

## Running with PM2

The PM2 command that works for this app is:

```bash
pm2 start dist/server/index.js --name luminari-web-client
```

Recommended full flow:

```bash
npm install
npm run build
pm2 start dist/server/index.js --name luminari-web-client
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs luminari-web-client
pm2 restart luminari-web-client
pm2 stop luminari-web-client
pm2 delete luminari-web-client
pm2 save
pm2 startup
```

To run on a different port:

```bash
PORT=4000 pm2 start dist/server/index.js --name luminari-web-client
```

An optional PM2 ecosystem file also exists:

```bash
ecosystem.config.cjs
```

## Configuration

The main app settings file is:

```ts
shared/app-settings.ts
```

The browser now loads these settings from the server at runtime through `/api/settings`, so changes to MUD presets, defaults, and personalization are picked up after restarting the server. A full frontend rebuild is not required just to update the dropdown list or branding text.

It contains:

- **ports.client** - Vite dev server port
- **ports.server** - Node proxy / production HTTP server port
- **ports.preview** - Vite preview port
- **connection.defaultHost** - default host shown in the client
- **connection.defaultPort** - default port shown in the client
- **connection.muds** - optional preset list for the MUD dropdown
- **personalization.browserTitle** - browser tab title
- **personalization.eyebrow** - small heading label in the UI
- **personalization.title** - main page title
- **personalization.subtitle** - descriptive subtitle text

### Current default config values

```ts
export const appSettings = {
  ports: {
    client: 5173,
    server: 3210,
    preview: 4173,
  },
  connection: {
    defaultHost: 'LuminariMUD.com',
    defaultPort: 4100,
    muds: [
      {
        id: 'luminari',
        name: 'LuminariMUD',
        host: 'LuminariMUD.com',
        port: 4100,
        description: 'Main public LuminariMUD server',
      },
    ],
  },
  personalization: {
    browserTitle: 'LuminariWebClient',
    eyebrow: 'LuminariWebClient',
    title: 'Web MUD client with MSDP-driven HUD',
    subtitle:
      'Telnet is bridged through a local WebSocket proxy so the browser can render terminal output, stats, bars, and the Luminari room map.',
  },
}
```

## Environment overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `shared/app-settings.ts` value | Override the server HTTP/WebSocket port |
| `VITE_WS_URL` | same-origin `/ws` | Override the browser WebSocket target |

## MUD presets

Preset MUDs are configured in:

```ts
shared/app-settings.ts
```

Each preset uses:

```ts
{
  id: string
  name: string
  host: string
  port: number
  description?: string
}
```

If presets are defined, the web client shows a dropdown beside the host, port, and connect controls. The user can still switch to **Custom** and type a host and port manually.

## MSDP / HUD coverage

The client currently uses MSDP for these categories:

- **Character:** `CHARACTER_NAME`, `LEVEL`, `CLASS`, `RACE`, `POSITION`, `ALIGNMENT`, `MONEY`, `AC`, `ATTACK_BONUS`
- **Ability scores:** `STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`, `STRENGTH`, `DEXTERITY`, `CONSTITUTION`, `INTELLIGENCE`, `WISDOM`, `CHARISMA`
- **Bars:** `HEALTH`, `HEALTH_MAX`, `PSP`, `PSP_MAX`, `MOVEMENT`, `MOVEMENT_MAX`, `EXPERIENCE`, `EXPERIENCE_MAX`, `EXPERIENCE_TNL`
- **Combat:** `OPPONENT_NAME`, `OPPONENT_HEALTH`, `OPPONENT_HEALTH_MAX`, `TANK_NAME`, `TANK_HEALTH`, `TANK_HEALTH_MAX`
- **Room and map:** `ROOM`, `ROOM_NAME`, `AREA_NAME`, `ROOM_VNUM`, `ROOM_EXITS`, `MINIMAP`
- **Group and status collections:** `GROUP`, `AFFECTS`, `ACTIONS`, `QUEST_INFO`

Server-level fields such as `SERVER_ID` are also requested so the bridge can validate the connection before character login completes.

## Verified commands

```bash
npm run lint
npm run build
```
