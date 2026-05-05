import AnsiToHtml from 'ansi-to-html'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { appSettings } from '../shared/app-settings.ts'
import type { AppSettings } from '../shared/app-settings.ts'
import type {
  ClientMessage,
  ConnectionStatus,
  MudState,
  ServerMessage,
} from '../shared/mud.ts'
import './App.css'

const DEFAULT_HOST = appSettings.connection.defaultHost
const DEFAULT_PORT = appSettings.connection.defaultPort
const CUSTOM_MUD_VALUE = '__custom__'
const TERMINAL_CHUNK_LIMIT = 500
const COMMAND_HISTORY_LIMIT = 100
const LUMINARI_COLOR_CHAR = '^'
const LUMINARI_COLOR_CODES: Record<string, string> = {
  n: '\u001b[0;00m',
  d: luminariRgbToAnsi('F000'),
  D: luminariRgbToAnsi('F111'),
  '1': luminariRgbToAnsi('F022'),
  '2': luminariRgbToAnsi('F055'),
  '3': luminariRgbToAnsi('F555'),
  r: luminariRgbToAnsi('F200'),
  R: luminariRgbToAnsi('F500'),
  g: luminariRgbToAnsi('F020'),
  G: luminariRgbToAnsi('F050'),
  y: luminariRgbToAnsi('F220'),
  Y: luminariRgbToAnsi('F550'),
  b: luminariRgbToAnsi('F002'),
  B: luminariRgbToAnsi('F005'),
  m: luminariRgbToAnsi('F202'),
  M: luminariRgbToAnsi('F505'),
  c: luminariRgbToAnsi('F022'),
  C: luminariRgbToAnsi('F055'),
  w: luminariRgbToAnsi('F222'),
  W: luminariRgbToAnsi('F555'),
  a: luminariRgbToAnsi('F014'),
  A: luminariRgbToAnsi('F025'),
  j: luminariRgbToAnsi('F031'),
  J: luminariRgbToAnsi('F142'),
  l: luminariRgbToAnsi('F140'),
  L: luminariRgbToAnsi('F250'),
  o: luminariRgbToAnsi('F520'),
  O: luminariRgbToAnsi('F530'),
  p: luminariRgbToAnsi('F301'),
  P: luminariRgbToAnsi('F413'),
  s: luminariRgbToAnsi('F300'),
  S: luminariRgbToAnsi('F411'),
  t: luminariRgbToAnsi('F320'),
  T: luminariRgbToAnsi('F431'),
  v: luminariRgbToAnsi('F104'),
  V: luminariRgbToAnsi('F215'),
  _: '\u001b[4m',
  '+': '\u001b[1m',
  '-': '\u001b[5m',
  '=': '\u001b[7m',
  '*': '@',
}
const MOVEMENT_COMMANDS = new Set([
  'n',
  'north',
  's',
  'south',
  'e',
  'east',
  'w',
  'west',
  'ne',
  'northeast',
  'nw',
  'northwest',
  'se',
  'southeast',
  'sw',
  'southwest',
  'u',
  'up',
  'd',
  'down',
  'in',
  'out',
])
const NUMPAD_COMMANDS: Record<string, string> = {
  Numpad1: 'sw',
  Numpad2: 's',
  Numpad3: 'se',
  Numpad4: 'w',
  Numpad5: 'look',
  Numpad6: 'e',
  Numpad7: 'nw',
  Numpad8: 'n',
  Numpad9: 'ne',
  NumpadAdd: 'down',
  NumpadSubtract: 'up',
  Numpad0: 'in',
  NumpadDecimal: 'out',
}

type BarConfig = {
  label: string
  value?: number
  max?: number
  accentClass: string
}

function App() {
  const [uiSettings, setUiSettings] = useState<AppSettings>(appSettings)
  const [mudState, setMudState] = useState<MudState>({})
  const [host, setHost] = useState(DEFAULT_HOST)
  const [port, setPort] = useState(DEFAULT_PORT)
  const [selectedMudId, setSelectedMudId] = useState(
    findMatchingMudPresetId(appSettings.connection.muds, DEFAULT_HOST, DEFAULT_PORT) ?? CUSTOM_MUD_VALUE,
  )
  const [command, setCommand] = useState('')
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [historyDraft, setHistoryDraft] = useState('')
  const [terminalChunks, setTerminalChunks] = useState<string[]>([
    '<span class="terminal-muted">Connect to a LuminariMUD-compatible server to begin.</span>',
  ])
  const [proxyReady, setProxyReady] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [statusDetail, setStatusDetail] = useState('Awaiting connection.')
  const socketRef = useRef<WebSocket | null>(null)
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const ansiConverterRef = useRef(createAnsiConverter())

  useEffect(() => {
    document.title = uiSettings.personalization.browserTitle
  }, [uiSettings.personalization.browserTitle])

  useEffect(() => {
    let active = true

    async function loadSettings() {
      try {
        const response = await fetch(getSettingsUrl())
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const settings = (await response.json()) as AppSettings
        if (!active) {
          return
        }

        setUiSettings(settings)
        setHost(settings.connection.defaultHost)
        setPort(settings.connection.defaultPort)
        setSelectedMudId(
          findMatchingMudPresetId(
            settings.connection.muds,
            settings.connection.defaultHost,
            settings.connection.defaultPort,
          ) ?? CUSTOM_MUD_VALUE,
        )
      } catch (error) {
        console.error('Failed to load app settings from /api/settings', error)
      }
    }

    void loadSettings()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const socket = new WebSocket(getWebSocketUrl())
    socketRef.current = socket

    socket.addEventListener('open', () => {
      setProxyReady(true)
      setStatusDetail((current) =>
        current === 'Awaiting connection.' ? 'Proxy ready. Connect to start playing.' : current,
      )
    })

    socket.addEventListener('close', () => {
      setProxyReady(false)
      setStatus('error')
      setStatusDetail('The local WebSocket proxy is unavailable.')
    })

    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(event.data)
      if (!message) {
        return
      }

      if (message.type === 'terminal') {
        const html = ansiConverterRef.current.toHtml(message.text)
        setTerminalChunks((current) => {
          const next = [...current, html]
          return next.slice(-TERMINAL_CHUNK_LIMIT)
        })
        return
      }

      if (message.type === 'connection-status') {
        setStatus(message.status)
        setStatusDetail(message.detail)

        if (message.status === 'connecting' || message.status === 'disconnected') {
          setMudState({})
        }

        if (message.status === 'connected') {
          ansiConverterRef.current = createAnsiConverter()
          setTerminalChunks([
            '<span class="terminal-muted">Connected. Waiting for room text and MSDP updates...</span>',
          ])
        }

        return
      }

      setMudState((current) => ({ ...current, ...message.state }))
    })

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [terminalChunks])

  const bars = useMemo<BarConfig[]>(
    () => [
      {
        label: 'HP',
        value: mudState.health,
        max: mudState.healthMax,
        accentClass: 'bar-health',
      },
      {
        label: 'PSP',
        value: mudState.psp,
        max: mudState.pspMax,
        accentClass: 'bar-psp',
      },
      {
        label: 'Move',
        value: mudState.movement,
        max: mudState.movementMax,
        accentClass: 'bar-movement',
      },
      {
        label: 'EXP',
        value: getExperienceProgress(mudState),
        max: mudState.experienceMax,
        accentClass: 'bar-exp',
      },
      {
        label: 'Opp',
        value: mudState.opponentHealth,
        max: mudState.opponentHealthMax,
        accentClass: 'bar-opponent',
      },
    ],
    [mudState],
  )

  const canConnect = proxyReady && status !== 'connecting'
  const connected = status === 'connected'
  const mapOutput = useMemo(() => buildMapOutput(mudState), [mudState])
  const selectedMudPreset = useMemo(
    () => uiSettings.connection.muds.find((mud) => mud.id === selectedMudId),
    [selectedMudId, uiSettings.connection.muds],
  )

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setStatus('error')
      setStatusDetail('The local WebSocket proxy is unavailable.')
      return
    }

    socket.send(JSON.stringify(message))
  }, [])

  const sendInputLine = useCallback(
    (text: string) => {
      if (!connected) {
        return
      }

      sendMessage({ type: 'input', text })
    },
    [connected, sendMessage],
  )

  const rememberCommand = useCallback((text: string) => {
    const normalized = text.trim().toLowerCase()
    if (!normalized || MOVEMENT_COMMANDS.has(normalized)) {
      return
    }

    setCommandHistory((current) => [...current, text].slice(-COMMAND_HISTORY_LIMIT))
  }, [])

  useEffect(() => {
    if (!proxyReady) {
      return
    }

    focusCommandInput(commandInputRef.current)
  }, [connected, proxyReady])

  useEffect(() => {
    if (!connected) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target === commandInputRef.current) {
        return
      }

      focusCommandInput(commandInputRef.current)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [connected])

  useEffect(() => {
    if (!connected) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      const command = NUMPAD_COMMANDS[event.code]
      if (!command) {
        return
      }

      event.preventDefault()
      rememberCommand(command)
      setHistoryIndex(null)
      setHistoryDraft('')
      setCommand('')
      sendInputLine(command)
      focusCommandInput(commandInputRef.current)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [connected, rememberCommand, sendInputLine])

  function handleConnectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (connected) {
      sendMessage({ type: 'disconnect' })
      return
    }

    setStatus('connecting')
    setStatusDetail(`Connecting to ${host}:${port}...`)
    sendMessage({ type: 'connect', host, port })
  }

  function handleMudPresetChange(mudId: string) {
    setSelectedMudId(mudId)
    if (mudId === CUSTOM_MUD_VALUE) {
      return
    }

    const preset = uiSettings.connection.muds.find((mud) => mud.id === mudId)
    if (!preset) {
      return
    }

    setHost(preset.host)
    setPort(preset.port)
  }

  function handleHostChange(nextHost: string) {
    setHost(nextHost)
    setSelectedMudId(
      findMatchingMudPresetId(uiSettings.connection.muds, nextHost, port) ?? CUSTOM_MUD_VALUE,
    )
  }

  function handlePortChange(nextPort: number) {
    setPort(nextPort)
    setSelectedMudId(
      findMatchingMudPresetId(uiSettings.connection.muds, host, nextPort) ?? CUSTOM_MUD_VALUE,
    )
  }

  function handleCommandSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!connected) {
      return
    }

    rememberCommand(command)
    setHistoryIndex(null)
    setHistoryDraft('')
    sendInputLine(command)
    setCommand('')
    focusCommandInput(commandInputRef.current)
  }

  function handleCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    if (event.key === 'ArrowUp') {
      if (commandHistory.length === 0) {
        return
      }

      event.preventDefault()

      if (historyIndex === null) {
        setHistoryDraft(command)
        setHistoryIndex(commandHistory.length - 1)
        setCommand(commandHistory[commandHistory.length - 1])
        return
      }

      if (historyIndex > 0) {
        setHistoryIndex(historyIndex - 1)
        setCommand(commandHistory[historyIndex - 1])
      }

      return
    }

    if (event.key !== 'ArrowDown' || historyIndex === null) {
      return
    }

    event.preventDefault()

    if (historyIndex < commandHistory.length - 1) {
      setHistoryIndex(historyIndex + 1)
      setCommand(commandHistory[historyIndex + 1])
      return
    }

    setHistoryIndex(null)
    setCommand(historyDraft)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{uiSettings.personalization.eyebrow}</p>
          <h1>{uiSettings.personalization.title}</h1>
          <p className="subtitle">{uiSettings.personalization.subtitle}</p>
        </div>

        <form className="connection-form panel" onSubmit={handleConnectionSubmit}>
          {uiSettings.connection.muds.length > 0 ? (
            <label>
              <span>MUD</span>
              <select value={selectedMudId} onChange={(event) => handleMudPresetChange(event.target.value)}>
                {uiSettings.connection.muds.map((mud) => (
                  <option key={mud.id} value={mud.id}>
                    {mud.name}
                  </option>
                ))}
                <option value={CUSTOM_MUD_VALUE}>Custom</option>
              </select>
              {selectedMudPreset?.description ? (
                <small className="connection-form-help">{selectedMudPreset.description}</small>
              ) : null}
            </label>
          ) : null}

          <label>
            <span>Host</span>
            <input value={host} onChange={(event) => handleHostChange(event.target.value)} />
          </label>

          <label>
            <span>Port</span>
            <input
              inputMode="numeric"
              value={port}
              onChange={(event) => handlePortChange(Number(event.target.value) || DEFAULT_PORT)}
            />
          </label>

          <button type="submit" disabled={!canConnect}>
            {connected ? 'Disconnect' : status === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
        </form>
      </header>

      <section className="status-row">
        <div className={`status-pill status-${status}`}>{status}</div>
        <p>{statusDetail}</p>
      </section>

      <main className="layout">
        <section className="terminal-column panel">
          <div className="panel-header">
            <div>
              <h2>Terminal</h2>
              <p>Raw game output, with ANSI colors preserved.</p>
            </div>
          </div>

          <div
            ref={terminalRef}
            className="terminal-output"
            dangerouslySetInnerHTML={{ __html: terminalChunks.join('') }}
          />

          <div className="bars">
            {bars.map((bar) => (
              <StatusBar
                key={bar.label}
                label={bar.label}
                value={bar.value}
                max={bar.max}
                accentClass={bar.accentClass}
              />
            ))}
          </div>

          <form className="command-form" onSubmit={handleCommandSubmit}>
            <input
              ref={commandInputRef}
              value={command}
              onChange={(event) => {
                setCommand(event.target.value)
                setHistoryIndex(null)
                setHistoryDraft(event.target.value)
              }}
              onKeyDown={handleCommandKeyDown}
              placeholder={connected ? 'Type a command…' : 'Connect before sending commands.'}
              readOnly={!connected}
            />
            <button type="submit" disabled={!connected}>
              Send
            </button>
          </form>
        </section>

        <aside className="sidebar">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Map</h2>
              </div>
            </div>

            <pre className="minimap" dangerouslySetInnerHTML={{ __html: renderMudHtml(mapOutput) }} />
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Character</h2>
                <p>Values populated from MSDP stats and room state.</p>
              </div>
            </div>

            <div className="identity-block">
              <strong
                dangerouslySetInnerHTML={{
                  __html: renderMudHtml(mudState.characterName ?? 'Unknown adventurer'),
                }}
              />
              <span
                dangerouslySetInnerHTML={{
                  __html: renderMudHtml(
                    [mudState.level ? `Level ${mudState.level}` : undefined, mudState.race, mudState.className]
                      .filter(Boolean)
                      .join(' · ') || 'Awaiting MSDP profile',
                  ),
                }}
              />
            </div>

            <dl className="stats-grid">
              <Stat label="Position" value={mudState.position} />
              <Stat label="Attack" value={formatNumber(mudState.attackBonus)} />
              <Stat label="Damage" value={formatNumber(mudState.damageBonus)} />
              <Stat label="Armor Class" value={formatNumber(mudState.armorClass)} />
              <Stat label="Alignment" value={mudState.alignment} />
              <Stat label="Money" value={formatNumber(mudState.money)} />
            </dl>
          </section>
        </aside>
      </main>
    </div>
  )
}

type StatusBarProps = {
  label: string
  value?: number
  max?: number
  accentClass: string
}

function StatusBar({ label, value, max, accentClass }: StatusBarProps) {
  const safeMax = max && max > 0 ? max : 0
  const percentage = safeMax > 0 && value !== undefined ? Math.min((value / safeMax) * 100, 100) : 0
  const counter =
    value !== undefined && max !== undefined
      ? `${formatNumber(value)} / ${formatNumber(max)}`
      : 'Waiting'

  return (
    <div className="status-bar">
      <div className="bar-track">
        <div className={`bar-fill ${accentClass}`} style={{ width: `${percentage}%` }} />
        <div className="bar-overlay">
          <span className="bar-label">{label}</span>
          <span className="bar-counter">{counter}</span>
        </div>
      </div>
    </div>
  )
}

type StatProps = {
  label: string
  value?: string | number
}

function Stat({ label, value }: StatProps) {
  if (typeof value === 'string') {
    return (
      <>
        <dt>{label}</dt>
        <dd dangerouslySetInnerHTML={{ __html: renderMudHtml(value || '—') }} />
      </>
    )
  }

  return (
    <>
      <dt>{label}</dt>
      <dd>{value !== undefined ? value : '—'}</dd>
    </>
  )
}

function getWebSocketUrl() {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function getSettingsUrl() {
  return '/api/settings'
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return null
    }

    return parsed as ServerMessage
  } catch {
    return null
  }
}

function formatNumber(value: number | undefined) {
  return value === undefined ? undefined : new Intl.NumberFormat().format(value)
}

function getExperienceProgress(mudState: MudState) {
  if (mudState.experienceMax === undefined) {
    return undefined
  }

  if (mudState.experienceTnl === undefined) {
    return mudState.experience
  }

  return Math.max(mudState.experienceMax - mudState.experienceTnl, 0)
}

function buildMapOutput(mudState: MudState) {
  const minimap = mudState.minimap?.trimEnd()
  if (minimap) {
    return minimap
  }

  return 'Waiting for MINIMAP MSDP data.'
}

function findMatchingMudPresetId(mudPresets: AppSettings['connection']['muds'], host: string, port: number) {
  return mudPresets.find(
    (mud) => mud.host.toLowerCase() === host.trim().toLowerCase() && mud.port === port,
  )?.id
}

function renderMudHtml(value: string) {
  return new AnsiToHtml({ escapeXML: true }).toHtml(convertLuminariColorCodes(value))
}

function convertLuminariColorCodes(value: string) {
  let converted = ''

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index]
    if (current !== LUMINARI_COLOR_CHAR) {
      converted += current
      continue
    }

    const next = value[index + 1]
    if (!next) {
      converted += current
      continue
    }

    if (next === LUMINARI_COLOR_CHAR) {
      converted += LUMINARI_COLOR_CHAR
      index += 1
      continue
    }

    if (next === '[') {
      const endIndex = value.indexOf(']', index + 2)
      if (endIndex > index + 2) {
        const luminariRgb = value.slice(index + 2, endIndex)
        const ansiColor = luminariRgbToAnsi(luminariRgb)
        if (ansiColor) {
          converted += ansiColor
          index = endIndex
          continue
        }
      }
    }

    const luminariColor = LUMINARI_COLOR_CODES[next]
    if (luminariColor !== undefined) {
      converted += luminariColor
      index += 1
      continue
    }

    converted += current
  }

  return converted
}

function luminariRgbToAnsi(code: string) {
  if (!/^[FfBb][0-5]{3}$/.test(code)) {
    return ''
  }

  const isBackground = code[0].toLowerCase() === 'b'
  const [red, green, blue] = code
    .slice(1)
    .split('')
    .map((value) => Number(value) * 51)

  return `\u001b[${isBackground ? 48 : 38};2;${red};${green};${blue}m`
}

function focusCommandInput(input: HTMLInputElement | null) {
  requestAnimationFrame(() => {
    input?.focus({ preventScroll: true })
  })
}

function createAnsiConverter() {
  return new AnsiToHtml({
    escapeXML: true,
    newline: true,
    stream: true,
  })
}

export default App
