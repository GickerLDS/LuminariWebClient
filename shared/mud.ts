export type MudValue =
  | string
  | number
  | boolean
  | null
  | MudValue[]
  | {
      [key: string]: MudValue
    }

export interface MudState {
  characterName?: string
  serverId?: string
  serverTime?: number
  snippetVersion?: number
  level?: number
  race?: string
  className?: string
  health?: number
  healthMax?: number
  psp?: number
  pspMax?: number
  movement?: number
  movementMax?: number
  experience?: number
  experienceMax?: number
  experienceTnl?: number
  attackBonus?: number
  damageBonus?: number
  armorClass?: number
  alignment?: string
  practice?: number
  money?: number
  position?: string
  room?: MudValue
  roomName?: string
  areaName?: string
  roomVnum?: number
  roomExits?: string[]
  roomCoords?: {
    x?: number
    y?: number
    z?: number
  }
  roomTerrain?: string
  roomEnvironment?: string
  automap?: string
  minimap?: string
  worldTime?: string
  actions?: MudValue
  affects?: MudValue
  group?: MudValue
  opponentName?: string
  opponentHealth?: number
  opponentHealthMax?: number
  tankName?: string
  tankHealth?: number
  tankHealthMax?: number
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export type ClientMessage =
  | {
      type: 'connect'
      host: string
      port: number
    }
  | {
      type: 'disconnect'
    }
  | {
      type: 'input'
      text: string
    }

export type ServerMessage =
  | {
      type: 'connection-status'
      status: ConnectionStatus
      detail: string
    }
  | {
      type: 'terminal'
      text: string
    }
  | {
      type: 'state'
      state: Partial<MudState>
    }
