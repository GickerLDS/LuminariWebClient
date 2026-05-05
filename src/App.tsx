import AnsiToHtml from 'ansi-to-html'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  ClientMessage,
  ConnectionStatus,
  MudState,
  ServerMessage,
} from '../shared/mud.ts'
import './App.css'

const DEFAULT_HOST = import.meta.env.VITE_DEFAULT_MUD_HOST ?? 'LuminariMUD.com'
const DEFAULT_PORT = Number(import.meta.env.VITE_DEFAULT_MUD_PORT ?? '4100')
const TERMINAL_CHUNK_LIMIT = 500
const COMMAND_HISTORY_LIMIT = 100
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
  const [mudState, setMudState] = useState<MudState>({})
  const [host, setHost] = useState(DEFAULT_HOST)
  const [port, setPort] = useState(DEFAULT_PORT)
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
          <p className="eyebrow">LuminariWebClient</p>
          <h1>Web MUD client with MSDP-driven HUD</h1>
          <p className="subtitle">
            Telnet is bridged through a local WebSocket proxy so the browser can render terminal
            output, stats, bars, and the Luminari room map.
          </p>
        </div>

        <form className="connection-form panel" onSubmit={handleConnectionSubmit}>
          <label>
            <span>Host</span>
            <input value={host} onChange={(event) => setHost(event.target.value)} />
          </label>

          <label>
            <span>Port</span>
            <input
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(Number(event.target.value) || DEFAULT_PORT)}
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
                <p>Displays the `MINIMAP` MSDP value only.</p>
              </div>
            </div>

            <pre className="minimap">{mapOutput}</pre>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Character</h2>
                <p>Values populated from MSDP stats and room state.</p>
              </div>
            </div>

            <div className="identity-block">
              <strong>{mudState.characterName ?? 'Unknown adventurer'}</strong>
              <span>
                {[mudState.level ? `Level ${mudState.level}` : undefined, mudState.race, mudState.className]
                  .filter(Boolean)
                  .join(' · ') || 'Awaiting MSDP profile'}
              </span>
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
  return (
    <>
      <dt>{label}</dt>
      <dd>{value !== undefined && value !== '' ? value : '—'}</dd>
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
