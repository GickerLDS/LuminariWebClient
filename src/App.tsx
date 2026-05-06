import AnsiToHtml from 'ansi-to-html'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ReactNode } from 'react'
import { appSettings } from '../shared/app-settings.ts'
import type { AppSettings } from '../shared/app-settings.ts'
import type {
  ClientMessage,
  ConnectionStatus,
  MudState,
  MudValue,
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
  overlayLabel?: string
  value?: number
  max?: number
  accentClass: string
}

type SidebarTabId = 'character' | 'quests' | 'group' | 'affects'

type SidebarTab = {
  id: SidebarTabId
  label: string
}

const SIDEBAR_TABS: SidebarTab[] = [
  { id: 'character', label: 'Character' },
  { id: 'quests', label: 'Quests' },
  { id: 'group', label: 'Group' },
  { id: 'affects', label: 'Affects' },
]

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
  const [isHeaderVisible, setIsHeaderVisible] = useState(true)
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTabId>('character')
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
        overlayLabel: mudState.opponentName,
        value: mudState.opponentHealth,
        max: mudState.opponentHealthMax,
        accentClass: 'bar-opponent',
      },
      {
        label: 'Tank',
        overlayLabel: mudState.tankName,
        value: mudState.tankHealth,
        max: mudState.tankHealthMax,
        accentClass: 'bar-tank',
      },
    ],
    [mudState],
  )

  const canConnect = proxyReady && status !== 'connecting'
  const connected = status === 'connected'

  useEffect(() => {
    setIsHeaderVisible(!connected)
  }, [connected])

  const mapOutput = useMemo(() => buildMapOutput(mudState), [mudState])
  const selectedMudPreset = useMemo(
    () => uiSettings.connection.muds.find((mud) => mud.id === selectedMudId),
    [selectedMudId, uiSettings.connection.muds],
  )
  const abilityScores = useMemo(
    () => [
      { label: 'STR', value: mudState.strength },
      { label: 'DEX', value: mudState.dexterity },
      { label: 'CON', value: mudState.constitution },
      { label: 'INT', value: mudState.intelligence },
      { label: 'WIS', value: mudState.wisdom },
      { label: 'CHA', value: mudState.charisma },
    ],
    [mudState.charisma, mudState.constitution, mudState.dexterity, mudState.intelligence, mudState.strength, mudState.wisdom],
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
      {connected ? (
        <div className="header-toggle-row">
          <button type="button" className="header-toggle" onClick={() => setIsHeaderVisible((current) => !current)}>
            {isHeaderVisible ? 'Hide header' : 'Show header'}
          </button>
        </div>
      ) : null}

      {isHeaderVisible ? (
        <div className="app-header">
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
        </div>
      ) : null}

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
                overlayLabel={bar.overlayLabel}
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

          <section className="panel tabbed-panel">
            <div className="tab-strip" role="tablist" aria-label="Sidebar sections">
              {SIDEBAR_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSidebarTab === tab.id}
                  className={`tab-button${activeSidebarTab === tab.id ? ' tab-button-active' : ''}`}
                  onClick={() => setActiveSidebarTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="tab-panel" role="tabpanel">
              {activeSidebarTab === 'character' ? (
                <>
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

                  <div className="ability-grid" aria-label="Ability scores">
                    {abilityScores.map((score) => (
                      <div key={score.label} className="ability-cell">
                        <span className="ability-label">{score.label}</span>
                        <span className="ability-value">{formatNumber(score.value) ?? '—'}</span>
                      </div>
                    ))}
                  </div>

                  <dl className="stats-grid">
                    <Stat label="Position" value={mudState.position} />
                    <Stat label="Attack" value={formatNumber(mudState.attackBonus)} />
                    <Stat label="Armor Class" value={formatNumber(mudState.armorClass)} />
                    <Stat label="Alignment" value={mudState.alignment} />
                    <Stat label="Money" value={formatNumber(mudState.money)} />
                  </dl>
                </>
              ) : null}

              {activeSidebarTab === 'quests' ? (
                mudState.questInfo ? (
                  <QuestInfoPanel value={mudState.questInfo} />
                ) : (
                  <EmptyTabMessage message="No quest data reported yet." />
                )
              ) : null}

              {activeSidebarTab === 'group' ? (
                mudState.group ? (
                  <GroupPanel value={mudState.group} />
                ) : (
                  <EmptyTabMessage message="No group data reported yet." />
                )
              ) : null}

              {activeSidebarTab === 'affects' ? (
                <MudValuePanel value={mudState.affects} emptyMessage="No affects reported yet." />
              ) : null}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

type StatusBarProps = {
  label: string
  overlayLabel?: string
  value?: number
  max?: number
  accentClass: string
}

function StatusBar({ label, overlayLabel, value, max, accentClass }: StatusBarProps) {
  const safeMax = max && max > 0 ? max : 0
  const percentage = safeMax > 0 && value !== undefined ? Math.min((value / safeMax) * 100, 100) : 0
  const counter =
    value !== undefined && max !== undefined
      ? `${formatNumber(value)} / ${formatNumber(max)}`
      : 'Waiting'
  const trimmedOverlayLabel = overlayLabel?.trim()
  const displayLabel = trimmedOverlayLabel ? `${label}: ${trimmedOverlayLabel}` : label

  return (
    <div className="status-bar">
      <div className="bar-track">
        <div className={`bar-fill ${accentClass}`} style={{ width: `${percentage}%` }} />
        <div className="bar-overlay">
          <span className="bar-label">{displayLabel}</span>
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

type MudValuePanelProps = {
  value?: MudValue
  emptyMessage: string
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

function EmptyTabMessage({ message }: { message: string }) {
  return <p className="tab-empty-message">{message}</p>
}

type GroupPanelProps = {
  value: MudValue
}

type GroupMember = {
  name?: string
  isLeader: boolean
  health?: string
  healthMax?: string
  move?: string
  moveMax?: string
}

function GroupPanel({ value }: GroupPanelProps) {
  const members = parseGroupMembers(value)

  if (members.length === 0) {
    return <MudValuePanel value={value} emptyMessage="No group data reported yet." />
  }

  return (
    <div className="tab-inline-output">
      {members.map((member, index) => {
        const healthText =
          member.health !== undefined && member.healthMax !== undefined
            ? `Health ${member.health}/${member.healthMax}`
            : null
        const moveText =
          member.move !== undefined && member.moveMax !== undefined
            ? `Move ${member.move}/${member.moveMax}`
            : null

        return (
          <div key={`${member.name ?? 'member'}-${index}`} className="group-member">
            <div>
              {member.name ?? 'Unknown'}
              {member.isLeader ? ' (Leader)' : ''}
            </div>
            {healthText || moveText ? (
              <div>
                {[healthText, moveText].filter(Boolean).join(' ')}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

type QuestInfoPanelProps = {
  value: MudValue
}

function QuestInfoPanel({ value }: QuestInfoPanelProps) {
  const normalizedValue = normalizeQuestValue(value)
  return <div className="tab-inline-output quest-html-output">{renderQuestNode(normalizedValue)}</div>
}

function MudValuePanel({ value, emptyMessage }: MudValuePanelProps) {
  if (value === undefined || value === null) {
    return <EmptyTabMessage message={emptyMessage} />
  }

  const text = formatMudValueAsText(value)
  return <div className="tab-inline-output">{text || emptyMessage}</div>
}

function formatMudValueAsText(value: MudValue): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number') {
    return formatNumber(value) ?? String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (Array.isArray(value)) {
    return value.map((item) => formatMudValueAsText(item)).filter(Boolean).join(', ')
  }

  const entries = Object.entries(value)
    .map(([key, val]) => {
      const formattedValue = formatMudValueAsText(val)
      return formattedValue ? `${formatMudLabel(key)}: ${formattedValue}` : null
    })
    .filter(Boolean)

  return entries.join(' | ')
}

function parseGroupMembers(value: MudValue): GroupMember[] {
  const entries = asCollection(value)

  return entries
    .flatMap((entry) => {
      if (!isMudRecord(entry)) {
        return []
      }

      const name = asOptionalText(
        readAnyKey(entry, ['name', 'NAME', 'member_name', 'MEMBER_NAME', 'character_name', 'CHARACTER_NAME']),
      )
      const health = asOptionalText(readAnyKey(entry, ['health', 'HEALTH']))
      const healthMax = asOptionalText(readAnyKey(entry, ['health_max', 'HEALTH_MAX', 'max_health', 'MAX_HEALTH']))
      const move = asOptionalText(readAnyKey(entry, ['move', 'MOVE', 'movement', 'MOVEMENT']))
      const moveMax = asOptionalText(readAnyKey(entry, ['move_max', 'MOVE_MAX', 'movement_max', 'MOVEMENT_MAX']))
      const isLeader = asOptionalBoolean(readAnyKey(entry, ['is_leader', 'IS_LEADER', 'leader', 'LEADER'])) ?? false

      if (!name && !health && !healthMax && !move && !moveMax) {
        return []
      }

      return [{ name, isLeader, health, healthMax, move, moveMax }]
    })
}

function renderQuestNode(value: MudValue): ReactNode {
  if (value === null || value === undefined) {
    return <span className="quest-empty">No quest data reported yet.</span>
  }

  if (typeof value === 'string') {
    return <span dangerouslySetInnerHTML={{ __html: renderMudHtml(value) }} />
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span>{formatMudValueAsText(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="quest-empty">No entries.</span>
    }

    return (
      <ul className="quest-list">
        {value.map((item, index) => (
          <li key={index}>{renderQuestNode(item)}</li>
        ))}
      </ul>
    )
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    return <span className="quest-empty">No fields.</span>
  }

  return (
    <div className="quest-object">
      {entries.map(([key, entryValue]) => {
        const label = formatMudLabel(key)
        const isScalar =
          entryValue === null ||
          entryValue === undefined ||
          typeof entryValue === 'string' ||
          typeof entryValue === 'number' ||
          typeof entryValue === 'boolean'

        if (isScalar) {
          return (
            <div key={key} className="quest-row">
              <span className="quest-key">{label}</span>
              <span className="quest-value">{renderQuestNode(entryValue)}</span>
            </div>
          )
        }

        return (
          <div key={key} className="quest-block">
            <div className="quest-block-title">{label}</div>
            <div>{renderQuestNode(entryValue)}</div>
          </div>
        )
      })}
    </div>
  )
}

function normalizeQuestValue(value: MudValue): MudValue {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  const looksLikeJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))

  if (!looksLikeJson) {
    return value
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (isMudValue(parsed)) {
      return parsed
    }
  } catch {
    return value
  }

  return value
}

function isMudValue(value: unknown): value is MudValue {
  if (value === null) {
    return true
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((item) => isMudValue(item))
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((entry) => isMudValue(entry))
  }

  return false
}

function asCollection(value: MudValue): MudValue[] {
  if (Array.isArray(value)) {
    return value
  }

  if (isMudRecord(value)) {
    return Object.values(value)
  }

  return []
}

function isMudRecord(value: MudValue): value is Record<string, MudValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAnyKey(record: Record<string, MudValue>, keys: string[]): MudValue | undefined {
  for (const key of keys) {
    if (key in record) {
      return record[key]
    }
  }

  return undefined
}

function asOptionalText(value: MudValue | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const formatted = formatMudValueAsText(value)
  return formatted || undefined
}

function asOptionalBoolean(value: MudValue | undefined): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y') {
      return true
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'n') {
      return false
    }
  }

  return undefined
}

function formatMudLabel(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase())
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
