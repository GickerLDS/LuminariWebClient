import express from 'express'
import net from 'node:net'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { RawData } from 'ws'
import { appSettings } from '../shared/app-settings.ts'
import type { ClientMessage, ConnectionStatus, MudState, MudValue, ServerMessage } from '../shared/mud.ts'

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240
const TTYPE_IS = 0
const TTYPE_SEND = 1
const TELOPT_ECHO = 1
const TELOPT_SGA = 3
const TELOPT_TTYPE = 24
const TELOPT_NAWS = 31
const TELOPT_CHARSET = 42
const TELOPT_MSDP = 69
const TELOPT_MCCP = 86
const TELOPT_MXP = 91
const MSDP_VAR = 1
const MSDP_VAL = 2
const MSDP_TABLE_OPEN = 3
const MSDP_TABLE_CLOSE = 4
const MSDP_ARRAY_OPEN = 5
const MSDP_ARRAY_CLOSE = 6
const WEB_CLIENT_NAME = 'LuminariWebClient'
const WEB_CLIENT_VERSION = '0.1.0'
const DEFAULT_COLUMNS = 120
const DEFAULT_ROWS = 40
const REPORTABLE_VARIABLES = [
  'CHARACTER_NAME',
  'SERVER_ID',
  'SERVER_TIME',
  'SNIPPET_VERSION',
  'LEVEL',
  'CLASS',
  'RACE',
  'HEALTH',
  'HEALTH_MAX',
  'PSP',
  'PSP_MAX',
  'MOVEMENT',
  'MOVEMENT_MAX',
  'EXPERIENCE',
  'EXPERIENCE_MAX',
  'EXPERIENCE_TNL',
  'ATTACK_BONUS',
  'DAMAGE_BONUS',
  'AC',
  'ALIGNMENT',
  'PRACTICE',
  'MONEY',
  'POSITION',
  'ROOM',
  'ROOM_NAME',
  'AREA_NAME',
  'ROOM_VNUM',
  'ROOM_EXITS',
  'AUTOMAP',
  'MINIMAP',
  'WORLD_TIME',
  'AFFECTS',
  'ACTIONS',
  'GROUP',
  'OPPONENT_NAME',
  'OPPONENT_HEALTH',
  'OPPONENT_HEALTH_MAX',
  'TANK_NAME',
  'TANK_HEALTH',
  'TANK_HEALTH_MAX',
]
const REFRESHABLE_VARIABLES = [
  'HEALTH',
  'HEALTH_MAX',
  'PSP',
  'PSP_MAX',
  'MOVEMENT',
  'MOVEMENT_MAX',
  'EXPERIENCE',
  'EXPERIENCE_MAX',
  'EXPERIENCE_TNL',
  'POSITION',
  'ROOM',
  'ROOM_NAME',
  'AREA_NAME',
  'ROOM_VNUM',
  'ROOM_EXITS',
  'MINIMAP',
  'OPPONENT_NAME',
  'OPPONENT_HEALTH',
  'OPPONENT_HEALTH_MAX',
  'TANK_NAME',
  'TANK_HEALTH',
  'TANK_HEALTH_MAX',
]
const CONTROL_BYTES = new Set([
  MSDP_VAR,
  MSDP_VAL,
  MSDP_TABLE_OPEN,
  MSDP_TABLE_CLOSE,
  MSDP_ARRAY_OPEN,
  MSDP_ARRAY_CLOSE,
])
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const clientDist = path.resolve(__dirname, '../client')

app.get('/health', (_request, response) => {
  response.json({ ok: true })
})

app.use(express.static(clientDist))

app.get(/^(?!\/ws).*/, (_request, response) => {
  response.sendFile(path.join(clientDist, 'index.html'))
})

wss.on('connection', (socket) => {
  const session = new MudSession(socket)

  socket.on('message', (data) => {
    const message = parseClientMessage(data)
    if (!message) {
      session.sendStatus('error', 'Received an invalid browser message.')
      return
    }

    if (message.type === 'connect') {
      session.connect(message.host, message.port)
      return
    }

    if (message.type === 'disconnect') {
      session.disconnect('Disconnected.')
      return
    }

    session.sendInput(message.text)
  })

  socket.on('close', () => {
    session.disconnect('Disconnected.')
  })
})

const port = Number(process.env.PORT ?? appSettings.ports.server)
server.listen(port, () => {
  console.log(`LuminariWebClient proxy listening on http://localhost:${port}`)
})

class MudSession {
  private mudSocket: net.Socket | null = null
  private parser: TelnetParser | null = null
  private state: MudState = {}
  private msdpInitialized = false
  private readonly browserSocket: WebSocket

  constructor(browserSocket: WebSocket) {
    this.browserSocket = browserSocket
  }

  connect(host: string, port: number) {
    if (!isValidHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
      this.sendStatus('error', 'Provide a valid MUD host and port.')
      return
    }

    this.disconnect('Disconnected.')
    this.state = {}
    this.msdpInitialized = false
    this.sendStatus('connecting', `Connecting to ${host}:${port}...`)

    const mudSocket = net.createConnection({ host, port })
    this.mudSocket = mudSocket
    this.parser = new TelnetParser(mudSocket, {
      onText: (text) => {
        this.send({ type: 'terminal', text })
      },
      onMsdp: (variable, value) => {
        const partial = mapMsdpUpdate(variable, value)
        if (Object.keys(partial).length === 0) {
          return
        }

        this.state = { ...this.state, ...partial }
        this.send({ type: 'state', state: partial })
      },
      onMsdpReady: () => {
        if (this.msdpInitialized) {
          return
        }

        this.msdpInitialized = true
        this.initializeMsdp()
      },
    })

    mudSocket.setNoDelay(true)

    mudSocket.on('connect', () => {
      this.sendStatus('connected', `Connected to ${host}:${port}.`)
    })

    mudSocket.on('data', (chunk) => {
      this.parser?.push(chunk)
    })

    mudSocket.on('error', (error) => {
      this.sendStatus('error', `Connection error: ${error.message}`)
    })

    mudSocket.on('close', () => {
      this.cleanupSocket()
      this.sendStatus('disconnected', `Connection to ${host}:${port} closed.`)
    })
  }

  disconnect(detail: string) {
    if (this.mudSocket) {
      this.mudSocket.destroy()
    }

    this.cleanupSocket()
    this.state = {}
    this.sendStatus('disconnected', detail)
  }

  sendInput(text: string) {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      this.sendStatus('error', 'Connect to a MUD before sending commands.')
      return
    }

    this.mudSocket.write(text.endsWith('\n') ? text : `${text}\n`)
    this.requestStateRefresh()
  }

  sendStatus(status: ConnectionStatus, detail: string) {
    this.send({ type: 'connection-status', status, detail })
  }

  private initializeMsdp() {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      return
    }

    this.sendMsdpPair('CLIENT_ID', WEB_CLIENT_NAME)
    this.sendMsdpPair('CLIENT_VERSION', WEB_CLIENT_VERSION)
    this.sendMsdpPair('ANSI_COLORS', 1)
    this.sendMsdpPair('256_COLORS', 1)
    this.sendMsdpPair('UTF_8', 1)

    for (const variable of REPORTABLE_VARIABLES) {
      this.sendMsdpPair('REPORT', variable)
    }

    this.requestStateRefresh()
  }

  private sendMsdpPair(variable: string, value: string | number) {
    if (!this.mudSocket || this.mudSocket.destroyed) {
      return
    }

    const payload = Buffer.concat([
      Buffer.from([IAC, SB, TELOPT_MSDP, MSDP_VAR]),
      Buffer.from(variable, 'utf8'),
      Buffer.from([MSDP_VAL]),
      Buffer.from(String(value), 'utf8'),
      Buffer.from([IAC, SE]),
    ])
    this.mudSocket.write(payload)
  }

  private requestStateRefresh() {
    if (!this.msdpInitialized) {
      return
    }

    for (const variable of REFRESHABLE_VARIABLES) {
      this.sendMsdpPair('SEND', variable)
    }
  }

  private cleanupSocket() {
    this.parser = null
    this.mudSocket = null
    this.msdpInitialized = false
  }

  private send(message: ServerMessage) {
    if (this.browserSocket.readyState !== WebSocket.OPEN) {
      return
    }

    this.browserSocket.send(JSON.stringify(message))
  }
}

type TelnetParserCallbacks = {
  onText: (text: string) => void
  onMsdp: (variable: string, value: MudValue) => void
  onMsdpReady: () => void
}

type ParserState = 'data' | 'iac' | 'iac-command' | 'sb-option' | 'sb-data' | 'sb-iac'

class TelnetParser {
  private state: ParserState = 'data'
  private readonly decoder = new StringDecoder('utf8')
  private readonly textBuffer: number[] = []
  private readonly sbBuffer: number[] = []
  private pendingCommand = 0
  private currentSbOption = 0
  private readonly socket: net.Socket
  private readonly callbacks: TelnetParserCallbacks

  constructor(socket: net.Socket, callbacks: TelnetParserCallbacks) {
    this.socket = socket
    this.callbacks = callbacks
  }

  push(chunk: Buffer) {
    for (const byte of chunk) {
      this.consume(byte)
    }

    this.flushText()
  }

  private consume(byte: number) {
    if (this.state === 'data') {
      if (byte === IAC) {
        this.flushText()
        this.state = 'iac'
        return
      }

      this.textBuffer.push(byte)
      return
    }

    if (this.state === 'iac') {
      if (byte === IAC) {
        this.textBuffer.push(IAC)
        this.state = 'data'
        return
      }

      if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
        this.pendingCommand = byte
        this.state = 'iac-command'
        return
      }

      if (byte === SB) {
        this.state = 'sb-option'
        return
      }

      this.state = 'data'
      return
    }

    if (this.state === 'iac-command') {
      this.handleNegotiation(this.pendingCommand, byte)
      this.state = 'data'
      return
    }

    if (this.state === 'sb-option') {
      this.currentSbOption = byte
      this.sbBuffer.length = 0
      this.state = 'sb-data'
      return
    }

    if (this.state === 'sb-data') {
      if (byte === IAC) {
        this.state = 'sb-iac'
        return
      }

      this.sbBuffer.push(byte)
      return
    }

    if (byte === SE) {
      this.handleSubnegotiation(this.currentSbOption, Buffer.from(this.sbBuffer))
      this.sbBuffer.length = 0
      this.state = 'data'
      return
    }

    if (byte === IAC) {
      this.sbBuffer.push(IAC)
    }

    this.state = 'sb-data'
  }

  private flushText() {
    if (this.textBuffer.length === 0) {
      return
    }

    const text = this.decoder.write(Buffer.from(this.textBuffer))
    this.textBuffer.length = 0

    if (text) {
      this.callbacks.onText(text)
    }
  }

  private handleNegotiation(command: number, option: number) {
    if (command === WILL) {
      if (option === TELOPT_MSDP) {
        this.sendNegotiation(DO, option)
        this.callbacks.onMsdpReady()
        return
      }

      if (option === TELOPT_ECHO || option === TELOPT_SGA) {
        this.sendNegotiation(DO, option)
        return
      }

      if (option === TELOPT_MCCP) {
        this.sendNegotiation(DONT, option)
        return
      }

      this.sendNegotiation(DONT, option)
      return
    }

    if (command === DO) {
      if (option === TELOPT_TTYPE) {
        this.sendNegotiation(WILL, option)
        return
      }

      if (option === TELOPT_NAWS) {
        this.sendNegotiation(WILL, option)
        this.sendNaws(DEFAULT_COLUMNS, DEFAULT_ROWS)
        return
      }

      if (option === TELOPT_CHARSET || option === TELOPT_MXP) {
        this.sendNegotiation(WONT, option)
        return
      }

      this.sendNegotiation(WONT, option)
    }
  }

  private handleSubnegotiation(option: number, payload: Buffer) {
    if (option === TELOPT_MSDP) {
      for (const [variable, value] of parseMsdpPayload(payload)) {
        this.callbacks.onMsdp(variable, value)
      }
      return
    }

    if (option === TELOPT_TTYPE && payload[0] === TTYPE_SEND) {
      this.socket.write(
        Buffer.concat([
          Buffer.from([IAC, SB, TELOPT_TTYPE, TTYPE_IS]),
          Buffer.from(WEB_CLIENT_NAME, 'utf8'),
          Buffer.from([IAC, SE]),
        ]),
      )
    }
  }

  private sendNegotiation(command: number, option: number) {
    this.socket.write(Buffer.from([IAC, command, option]))
  }

  private sendNaws(columns: number, rows: number) {
    const width = Buffer.from([columns >> 8, columns & 0xff])
    const height = Buffer.from([rows >> 8, rows & 0xff])
    this.socket.write(Buffer.concat([Buffer.from([IAC, SB, TELOPT_NAWS]), width, height, Buffer.from([IAC, SE])]))
  }
}

function parseClientMessage(data: RawData): ClientMessage | null {
  const text = dataToString(data)
  if (!text) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const message = parsed as Record<string, unknown>

    if (message.type === 'connect' && typeof message.host === 'string' && typeof message.port === 'number') {
      return { type: 'connect', host: message.host, port: message.port }
    }

    if (message.type === 'disconnect') {
      return { type: 'disconnect' }
    }

    if (message.type === 'input' && typeof message.text === 'string') {
      return { type: 'input', text: message.text }
    }

    return null
  } catch {
    return null
  }
}

function dataToString(data: RawData) {
  if (typeof data === 'string') {
    return data
  }

  if (data instanceof Buffer) {
    return data.toString('utf8')
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8')
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }

  return ''
}

function isValidHost(host: string) {
  return /^[a-z0-9.-]+$/i.test(host) || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)
}

function parseMsdpPayload(payload: Buffer): Array<[string, MudValue]> {
  const pairs: Array<[string, MudValue]> = []
  let index = 0

  while (index < payload.length) {
    if (payload[index] !== MSDP_VAR) {
      index += 1
      continue
    }

    index += 1
    const [variable, nextIndex] = readScalar(payload, index)
    index = nextIndex

    if (payload[index] !== MSDP_VAL) {
      continue
    }

    index += 1
    const [value, afterValue] = readValue(payload, index)
    index = afterValue

    if (variable) {
      pairs.push([variable, value])
    }
  }

  return pairs
}

function readValue(payload: Buffer, index: number): [MudValue, number] {
  const marker = payload[index]

  if (marker === MSDP_ARRAY_OPEN) {
    const items: MudValue[] = []
    let cursor = index + 1

    while (cursor < payload.length && payload[cursor] !== MSDP_ARRAY_CLOSE) {
      if (payload[cursor] === MSDP_VAL) {
        cursor += 1
        const [value, nextCursor] = readValue(payload, cursor)
        items.push(value)
        cursor = nextCursor
        continue
      }

      const [value, nextCursor] = readScalar(payload, cursor)
      if (value !== '') {
        items.push(normalizeScalar(value))
      }
      cursor = nextCursor
    }

    return [items, cursor + 1]
  }

  if (marker === MSDP_TABLE_OPEN) {
    const table: Record<string, MudValue> = {}
    let cursor = index + 1

    while (cursor < payload.length && payload[cursor] !== MSDP_TABLE_CLOSE) {
      if (payload[cursor] !== MSDP_VAR) {
        cursor += 1
        continue
      }

      cursor += 1
      const [key, nextCursor] = readScalar(payload, cursor)
      cursor = nextCursor

      if (payload[cursor] !== MSDP_VAL) {
        continue
      }

      cursor += 1
      const [value, afterValue] = readValue(payload, cursor)
      cursor = afterValue

      if (key) {
        table[key] = value
      }
    }

    return [table, cursor + 1]
  }

  const [value, nextIndex] = readScalar(payload, index)
  return [normalizeScalar(value), nextIndex]
}

function readScalar(payload: Buffer, index: number): [string, number] {
  const bytes: number[] = []
  let cursor = index

  while (cursor < payload.length && !CONTROL_BYTES.has(payload[cursor])) {
    bytes.push(payload[cursor])
    cursor += 1
  }

  return [Buffer.from(bytes).toString('utf8'), cursor]
}

function normalizeScalar(value: string): MudValue {
  if (/^-?\d+$/.test(value)) {
    return Number(value)
  }

  return value
}

function mapMsdpUpdate(variable: string, value: MudValue): Partial<MudState> {
  const partial: Partial<MudState> = {}

  switch (variable) {
    case 'SERVER_ID':
      partial.serverId = toOptionalString(value)
      break
    case 'SERVER_TIME':
      partial.serverTime = toOptionalNumber(value)
      break
    case 'SNIPPET_VERSION':
      partial.snippetVersion = toOptionalNumber(value)
      break
    case 'CHARACTER_NAME':
      partial.characterName = toOptionalString(value)
      break
    case 'LEVEL':
      partial.level = toOptionalNumber(value)
      break
    case 'RACE':
      partial.race = toOptionalString(value)
      break
    case 'CLASS':
      partial.className = toOptionalString(value)
      break
    case 'HEALTH':
      partial.health = toOptionalNumber(value)
      break
    case 'HEALTH_MAX':
      partial.healthMax = toOptionalNumber(value)
      break
    case 'PSP':
      partial.psp = toOptionalNumber(value)
      break
    case 'PSP_MAX':
      partial.pspMax = toOptionalNumber(value)
      break
    case 'MOVEMENT':
      partial.movement = toOptionalNumber(value)
      break
    case 'MOVEMENT_MAX':
      partial.movementMax = toOptionalNumber(value)
      break
    case 'EXPERIENCE':
      partial.experience = toOptionalNumber(value)
      break
    case 'EXPERIENCE_MAX':
      partial.experienceMax = toOptionalNumber(value)
      break
    case 'EXPERIENCE_TNL':
      partial.experienceTnl = toOptionalNumber(value)
      break
    case 'ATTACK_BONUS':
      partial.attackBonus = toOptionalNumber(value)
      break
    case 'DAMAGE_BONUS':
      partial.damageBonus = toOptionalNumber(value)
      break
    case 'AC':
      partial.armorClass = toOptionalNumber(value)
      break
    case 'ALIGNMENT':
      partial.alignment = toOptionalString(value)
      break
    case 'PRACTICE':
      partial.practice = toOptionalNumber(value)
      break
    case 'MONEY':
      partial.money = toOptionalNumber(value)
      break
    case 'POSITION':
      partial.position = toOptionalString(value)
      break
    case 'ROOM':
      partial.room = value
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        partial.roomName = toOptionalString(value.NAME)
        partial.areaName = toOptionalString(value.AREA)
        partial.roomVnum = toOptionalNumber(value.VNUM)
        partial.roomExits = toStringArray(value.EXITS)
        partial.roomTerrain = toOptionalString(value.TERRAIN)
        partial.roomEnvironment = toOptionalString(value.ENVIRONMENT)
        partial.roomCoords = toCoords(value.COORDS)
      }
      break
    case 'ROOM_NAME':
      partial.roomName = toOptionalString(value)
      break
    case 'AREA_NAME':
      partial.areaName = toOptionalString(value)
      break
    case 'ROOM_VNUM':
      partial.roomVnum = toOptionalNumber(value)
      break
    case 'ROOM_EXITS':
      partial.roomExits = toStringArray(value)
      break
    case 'AUTOMAP':
      partial.automap = toOptionalString(value)
      break
    case 'MINIMAP':
      partial.minimap = toOptionalString(value)
      break
    case 'WORLD_TIME':
      partial.worldTime = toOptionalString(value)
      break
    case 'ACTIONS':
      partial.actions = value
      break
    case 'AFFECTS':
      partial.affects = value
      break
    case 'GROUP':
      partial.group = value
      break
    case 'OPPONENT_NAME':
      partial.opponentName = toOptionalString(value)
      break
    case 'OPPONENT_HEALTH':
      partial.opponentHealth = toOptionalNumber(value)
      break
    case 'OPPONENT_HEALTH_MAX':
      partial.opponentHealthMax = toOptionalNumber(value)
      break
    case 'TANK_NAME':
      partial.tankName = toOptionalString(value)
      break
    case 'TANK_HEALTH':
      partial.tankHealth = toOptionalNumber(value)
      break
    case 'TANK_HEALTH_MAX':
      partial.tankHealthMax = toOptionalNumber(value)
      break
    default:
      break
  }

  return partial
}

function toOptionalNumber(value: MudValue) {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return Number(value)
  }

  return undefined
}

function toOptionalString(value: MudValue) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    return String(value)
  }

  return undefined
}

function toStringArray(value: MudValue): string[] | undefined {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = toOptionalString(item)
      return text ? [text] : []
    })
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).sort(sortDirections)
  }

  if (typeof value === 'string') {
    return value
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return undefined
}

function toCoords(value: MudValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return {
    x: toOptionalNumber(value.X),
    y: toOptionalNumber(value.Y),
    z: toOptionalNumber(value.Z),
  }
}

function sortDirections(left: string, right: string) {
  const order = ['n', 'north', 'ne', 'northeast', 'e', 'east', 'se', 'southeast', 's', 'south', 'sw', 'southwest', 'w', 'west', 'nw', 'northwest', 'u', 'up', 'd', 'down', 'in', 'out']
  const leftIndex = order.indexOf(left.toLowerCase())
  const rightIndex = order.indexOf(right.toLowerCase())

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right)
  }

  if (leftIndex === -1) {
    return 1
  }

  if (rightIndex === -1) {
    return -1
  }

  return leftIndex - rightIndex
}
