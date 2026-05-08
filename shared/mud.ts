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
  title?: string
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
  strength?: number
  dexterity?: number
  constitution?: number
  intelligence?: number
  wisdom?: number
  charisma?: number
  fortitude?: number
  reflex?: number
  willpower?: number
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
    questInfo?: MudValue
  opponentName?: string
  opponentHealth?: number
  opponentHealthMax?: number
  tankName?: string
  tankHealth?: number
  tankHealthMax?: number
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export const defaultMsdpVariables = {
  characterName: 'CHARACTER_NAME',
  title: 'TITLE',
  level: 'LEVEL',
  race: 'RACE',
  className: 'CLASS',
  health: 'HEALTH',
  healthMax: 'HEALTH_MAX',
  psp: 'PSP',
  pspMax: 'PSP_MAX',
  movement: 'MOVEMENT',
  movementMax: 'MOVEMENT_MAX',
  experience: 'EXPERIENCE',
  experienceMax: 'EXPERIENCE_MAX',
  experienceTnl: 'EXPERIENCE_TNL',
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
  fortitude: 'FORTITUDE',
  reflex: 'REFLEX',
  willpower: 'WILLPOWER',
  position: 'POSITION',
  attackBonus: 'ATTACK_BONUS',
  armorClass: 'AC',
  alignment: 'ALIGNMENT',
  money: 'MONEY',
  minimap: 'MINIMAP',
  affects: 'AFFECTS',
  group: 'GROUP',
  questInfo: 'QUEST_INFO',
  opponentName: 'OPPONENT_NAME',
  opponentHealth: 'OPPONENT_HEALTH',
  opponentHealthMax: 'OPPONENT_HEALTH_MAX',
  tankName: 'TANK_NAME',
  tankHealth: 'TANK_HEALTH',
  tankHealthMax: 'TANK_HEALTH_MAX',
} as const

export type MsdpVariableKey = keyof typeof defaultMsdpVariables
export type MsdpVariableMap = Record<MsdpVariableKey, string>

export function normalizeMsdpVariableMap(value: unknown): MsdpVariableMap {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

  return {
    characterName: normalizeMsdpVariableValue(raw.characterName, defaultMsdpVariables.characterName),
    title: normalizeMsdpVariableValue(raw.title, defaultMsdpVariables.title),
    level: normalizeMsdpVariableValue(raw.level, defaultMsdpVariables.level),
    race: normalizeMsdpVariableValue(raw.race, defaultMsdpVariables.race),
    className: normalizeMsdpVariableValue(raw.className, defaultMsdpVariables.className),
    health: normalizeMsdpVariableValue(raw.health, defaultMsdpVariables.health),
    healthMax: normalizeMsdpVariableValue(raw.healthMax, defaultMsdpVariables.healthMax),
    psp: normalizeMsdpVariableValue(raw.psp, defaultMsdpVariables.psp),
    pspMax: normalizeMsdpVariableValue(raw.pspMax, defaultMsdpVariables.pspMax),
    movement: normalizeMsdpVariableValue(raw.movement, defaultMsdpVariables.movement),
    movementMax: normalizeMsdpVariableValue(raw.movementMax, defaultMsdpVariables.movementMax),
    experience: normalizeMsdpVariableValue(raw.experience, defaultMsdpVariables.experience),
    experienceMax: normalizeMsdpVariableValue(raw.experienceMax, defaultMsdpVariables.experienceMax),
    experienceTnl: normalizeMsdpVariableValue(raw.experienceTnl, defaultMsdpVariables.experienceTnl),
    strength: normalizeMsdpVariableValue(raw.strength, defaultMsdpVariables.strength),
    dexterity: normalizeMsdpVariableValue(raw.dexterity, defaultMsdpVariables.dexterity),
    constitution: normalizeMsdpVariableValue(raw.constitution, defaultMsdpVariables.constitution),
    intelligence: normalizeMsdpVariableValue(raw.intelligence, defaultMsdpVariables.intelligence),
    wisdom: normalizeMsdpVariableValue(raw.wisdom, defaultMsdpVariables.wisdom),
    charisma: normalizeMsdpVariableValue(raw.charisma, defaultMsdpVariables.charisma),
    fortitude: normalizeMsdpVariableValue(raw.fortitude, defaultMsdpVariables.fortitude),
    reflex: normalizeMsdpVariableValue(raw.reflex, defaultMsdpVariables.reflex),
    willpower: normalizeMsdpVariableValue(raw.willpower, defaultMsdpVariables.willpower),
    position: normalizeMsdpVariableValue(raw.position, defaultMsdpVariables.position),
    attackBonus: normalizeMsdpVariableValue(raw.attackBonus, defaultMsdpVariables.attackBonus),
    armorClass: normalizeMsdpVariableValue(raw.armorClass, defaultMsdpVariables.armorClass),
    alignment: normalizeMsdpVariableValue(raw.alignment, defaultMsdpVariables.alignment),
    money: normalizeMsdpVariableValue(raw.money, defaultMsdpVariables.money),
    minimap: normalizeMsdpVariableValue(raw.minimap, defaultMsdpVariables.minimap),
    affects: normalizeMsdpVariableValue(raw.affects, defaultMsdpVariables.affects),
    group: normalizeMsdpVariableValue(raw.group, defaultMsdpVariables.group),
    questInfo: normalizeMsdpVariableValue(raw.questInfo, defaultMsdpVariables.questInfo),
    opponentName: normalizeMsdpVariableValue(raw.opponentName, defaultMsdpVariables.opponentName),
    opponentHealth: normalizeMsdpVariableValue(raw.opponentHealth, defaultMsdpVariables.opponentHealth),
    opponentHealthMax: normalizeMsdpVariableValue(raw.opponentHealthMax, defaultMsdpVariables.opponentHealthMax),
    tankName: normalizeMsdpVariableValue(raw.tankName, defaultMsdpVariables.tankName),
    tankHealth: normalizeMsdpVariableValue(raw.tankHealth, defaultMsdpVariables.tankHealth),
    tankHealthMax: normalizeMsdpVariableValue(raw.tankHealthMax, defaultMsdpVariables.tankHealthMax),
  }
}

function normalizeMsdpVariableValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export type ClientMessage =
  | {
      type: 'connect'
      host: string
      port: number
      msdpVariables: MsdpVariableMap
    }
  | {
      type: 'disconnect'
    }
  | {
      type: 'input'
      text: string
    }
  | {
      type: 'msdp-config'
      msdpVariables: MsdpVariableMap
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
