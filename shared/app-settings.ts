export type MudPreset = {
  id: string
  name: string
  host: string
  port: number
  description?: string
}

export type AppSettings = {
  ports: {
    client: number
    server: number
    preview: number
  }
  connection: {
    defaultHost: string
    defaultPort: number
    muds: MudPreset[]
  }
  personalization: {
    browserTitle: string
    eyebrow: string
    title: string
    subtitle: string
  }
}

export const appSettings: AppSettings = {
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
