import AnsiToHtml from 'ansi-to-html'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { ReactNode } from 'react'
import { appSettings } from '../shared/app-settings.ts'
import type { AppSettings } from '../shared/app-settings.ts'
import {
  defaultMsdpVariables,
  normalizeMsdpVariableMap,
} from '../shared/mud.ts'
import type {
  ClientMessage,
  ConnectionStatus,
  MsdpVariableKey,
  MsdpVariableMap,
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
const AUTOMATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const AUTOMATION_COOKIE_CHUNK_SIZE = 3000
const AUTOMATION_RECURSION_LIMIT = 10
const CLIENT_CONFIG_EXPORT_VERSION = 1
const ALIASES_COOKIE_NAME = 'lwc.aliases'
const TRIGGERS_COOKIE_NAME = 'lwc.triggers'
const CLIENT_SETTINGS_COOKIE_NAME = 'lwc.settings'
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, 'g')
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

type AliasDefinition = {
  id: string
  pattern: string
  expansion: string
  enabled: boolean
}

type TriggerDefinition = {
  id: string
  pattern: string
  action: string
  enabled: boolean
}

type SidebarFontFamily = 'sans' | 'mono' | 'serif'

type ClientSettings = {
  terminal: {
    fontSize: number
    lineHeight: number
    autoScroll: boolean
    wrapLines: boolean
  }
  minimap: {
    fontSize: number
    paneHeight: number
  }
  sidebar: {
    fontFamily: SidebarFontFamily
    fontSize: number
  }
  msdp: MsdpVariableMap
}

type AutomationNotice = {
  kind: 'success' | 'error'
  text: string
}

type AutomationMenuId = 'aliases' | 'triggers' | 'msdpVars' | 'settings'

const DEFAULT_CLIENT_SETTINGS: ClientSettings = {
  terminal: {
    fontSize: 14,
    lineHeight: 1.55,
    autoScroll: true,
    wrapLines: true,
  },
  minimap: {
    fontSize: 14,
    paneHeight: 16,
  },
  sidebar: {
    fontFamily: 'mono',
    fontSize: 13,
  },
  msdp: normalizeMsdpVariableMap(defaultMsdpVariables),
}

const OUTPUT_FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20, 22, 24]
const OUTPUT_LINE_HEIGHT_OPTIONS = [
  { value: 1.35, label: 'Compact' },
  { value: 1.55, label: 'Normal' },
  { value: 1.75, label: 'Relaxed' },
]
const SIDEBAR_FONT_OPTIONS: Array<{ value: SidebarFontFamily; label: string }> = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'mono', label: 'Monospace' },
  { value: 'serif', label: 'Serif' },
]
const SIDEBAR_FONT_FAMILIES: Record<SidebarFontFamily, string> = {
  sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'var(--mono)',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
}
const MSDP_VARIABLE_GROUPS: Array<{
  title: string
  description: string
  fields: Array<{ key: MsdpVariableKey; label: string }>
}> = [
  {
    title: 'Character',
    description: 'Profile and core stat variables used in the character panel.',
    fields: [
      { key: 'characterName', label: 'Character name' },
      { key: 'title', label: 'Title' },
      { key: 'level', label: 'Level' },
      { key: 'race', label: 'Race' },
      { key: 'className', label: 'Class' },
      { key: 'position', label: 'Position' },
      { key: 'alignment', label: 'Alignment' },
      { key: 'money', label: 'Money' },
    ],
  },
  {
    title: 'Status and attributes',
    description: 'Values that drive the bars and ability score sections.',
    fields: [
      { key: 'health', label: 'Health' },
      { key: 'healthMax', label: 'Health max' },
      { key: 'psp', label: 'PSP' },
      { key: 'pspMax', label: 'PSP max' },
      { key: 'movement', label: 'Movement' },
      { key: 'movementMax', label: 'Movement max' },
      { key: 'experience', label: 'Experience' },
      { key: 'experienceMax', label: 'Experience max' },
      { key: 'experienceTnl', label: 'Experience to next level' },
      { key: 'strength', label: 'Strength' },
      { key: 'dexterity', label: 'Dexterity' },
      { key: 'constitution', label: 'Constitution' },
      { key: 'intelligence', label: 'Intelligence' },
      { key: 'wisdom', label: 'Wisdom' },
      { key: 'charisma', label: 'Charisma' },
      { key: 'fortitude', label: 'Fortitude' },
      { key: 'reflex', label: 'Reflex' },
      { key: 'willpower', label: 'Willpower' },
      { key: 'attackBonus', label: 'Attack bonus' },
      { key: 'armorClass', label: 'Armor class' },
    ],
  },
  {
    title: 'Panels and map',
    description: 'Variables that populate the minimap, quest, group, and affects panels.',
    fields: [
      { key: 'minimap', label: 'Minimap' },
      { key: 'affects', label: 'Affects' },
      { key: 'group', label: 'Group' },
      { key: 'questInfo', label: 'Quest info' },
    ],
  },
  {
    title: 'Combat targets',
    description: 'Opponent and tank data shown in the status bars.',
    fields: [
      { key: 'opponentName', label: 'Opponent name' },
      { key: 'opponentHealth', label: 'Opponent health' },
      { key: 'opponentHealthMax', label: 'Opponent health max' },
      { key: 'tankName', label: 'Tank name' },
      { key: 'tankHealth', label: 'Tank health' },
      { key: 'tankHealthMax', label: 'Tank health max' },
    ],
  },
]

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
  const [aliases, setAliases] = useState<AliasDefinition[]>(() => loadAliasesFromCookies())
  const [triggers, setTriggers] = useState<TriggerDefinition[]>(() => loadTriggersFromCookies())
  const [clientSettings, setClientSettings] = useState<ClientSettings>(() => loadClientSettingsFromCookies())
  const [automationNotice, setAutomationNotice] = useState<AutomationNotice | null>(null)
  const [terminalChunks, setTerminalChunks] = useState<string[]>([
    '<span class="terminal-muted">Connect to a LuminariMUD-compatible server to begin.</span>',
  ])
  const [proxyReady, setProxyReady] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [statusDetail, setStatusDetail] = useState('Awaiting connection.')
  const [isHeaderVisible, setIsHeaderVisible] = useState(true)
  const [openAutomationMenu, setOpenAutomationMenu] = useState<AutomationMenuId | null>(null)
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTabId>('character')
  const socketRef = useRef<WebSocket | null>(null)
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const configFileInputRef = useRef<HTMLInputElement | null>(null)
  const menuBarRef = useRef<HTMLDivElement | null>(null)
  const ansiConverterRef = useRef(createAnsiConverter())
  const triggerBufferRef = useRef('')
  const statusRef = useRef<ConnectionStatus>('idle')
  const aliasesRef = useRef<AliasDefinition[]>(aliases)
  const triggersRef = useRef<TriggerDefinition[]>(triggers)

  useEffect(() => {
    document.title = uiSettings.personalization.browserTitle
  }, [uiSettings.personalization.browserTitle])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    aliasesRef.current = aliases
    saveAliasesToCookies(aliases)
  }, [aliases])

  useEffect(() => {
    triggersRef.current = triggers
    saveTriggersToCookies(triggers)
  }, [triggers])

  useEffect(() => {
    saveClientSettingsToCookies(normalizeClientSettings(clientSettings))
  }, [clientSettings])

  useEffect(() => {
    if (!openAutomationMenu) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuBarRef.current?.contains(event.target)) {
        return
      }

      setOpenAutomationMenu(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenAutomationMenu(null)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openAutomationMenu])

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

  const sendMessage = useCallback((message: ClientMessage) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      statusRef.current = 'error'
      setStatus('error')
      setStatusDetail('The local WebSocket proxy is unavailable.')
      setIsHeaderVisible(true)
      return
    }

    socket.send(JSON.stringify(message))
  }, [])

  const sendInputLine = useCallback(
    (text: string) => {
      if (statusRef.current !== 'connected') {
        return
      }

      sendMessage({ type: 'input', text })
    },
    [sendMessage],
  )

  const rememberCommand = useCallback((text: string) => {
    const normalized = text.trim().toLowerCase()
    if (!normalized || MOVEMENT_COMMANDS.has(normalized)) {
      return
    }

    setCommandHistory((current) => [...current, text].slice(-COMMAND_HISTORY_LIMIT))
  }, [])

  const dispatchInputText = useCallback(
    (text: string, options?: { rememberInHistory?: boolean }) => {
      const trimmed = text.trim()
      if (!trimmed) {
        return
      }

      if (options?.rememberInHistory ?? true) {
        rememberCommand(trimmed)
      }

      const expandedCommands = expandAliasCommands(trimmed, aliasesRef.current)
      for (const expandedCommand of expandedCommands) {
        sendInputLine(expandedCommand)
      }
    },
    [rememberCommand, sendInputLine],
  )

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
      statusRef.current = 'error'
      setStatus('error')
      setStatusDetail('The local WebSocket proxy is unavailable.')
      setIsHeaderVisible(true)
      triggerBufferRef.current = ''
    })

    socket.addEventListener('message', (event) => {
      const message = parseServerMessage(event.data)
      if (!message) {
        return
      }

      if (message.type === 'terminal') {
        const triggerResult = consumeTriggerText(message.text, triggerBufferRef.current, triggersRef.current)
        triggerBufferRef.current = triggerResult.buffer
        for (const triggerCommand of triggerResult.commands) {
          dispatchInputText(triggerCommand, { rememberInHistory: false })
        }

        const html = ansiConverterRef.current.toHtml(message.text)
        setTerminalChunks((current) => {
          const next = [...current, html]
          return next.slice(-TERMINAL_CHUNK_LIMIT)
        })
        return
      }

      if (message.type === 'connection-status') {
        statusRef.current = message.status
        setStatus(message.status)
        setStatusDetail(message.detail)
        setIsHeaderVisible(message.status !== 'connected')

        if (message.status === 'connecting' || message.status === 'disconnected') {
          setMudState({})
        }

        if (message.status === 'connected') {
          ansiConverterRef.current = createAnsiConverter()
          triggerBufferRef.current = ''
          setTerminalChunks([
            '<span class="terminal-muted">Connected. Waiting for room text and MSDP updates...</span>',
          ])
        } else {
          triggerBufferRef.current = ''
        }

        return
      }

      setMudState((current) => ({ ...current, ...message.state }))
    })

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [dispatchInputText])

  useEffect(() => {
    if (terminalRef.current && clientSettings.terminal.autoScroll) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [clientSettings.terminal.autoScroll, terminalChunks])

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
  const activeMsdpVariables = useMemo(() => normalizeMsdpVariableMap(clientSettings.msdp), [clientSettings.msdp])
  const terminalOutputStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${clientSettings.terminal.fontSize}px`,
      lineHeight: clientSettings.terminal.lineHeight,
      whiteSpace: clientSettings.terminal.wrapLines ? 'pre-wrap' : 'pre',
      wordBreak: clientSettings.terminal.wrapLines ? 'break-word' : 'normal',
    }),
    [clientSettings.terminal.fontSize, clientSettings.terminal.lineHeight, clientSettings.terminal.wrapLines],
  )
  const minimapStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${clientSettings.minimap.fontSize}px`,
      height: `${clientSettings.minimap.paneHeight}rem`,
      minHeight: `${clientSettings.minimap.paneHeight}rem`,
    }),
    [clientSettings.minimap.fontSize, clientSettings.minimap.paneHeight],
  )
  const sidebarPanelStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily: SIDEBAR_FONT_FAMILIES[clientSettings.sidebar.fontFamily],
      fontSize: `${clientSettings.sidebar.fontSize}px`,
    }),
    [clientSettings.sidebar.fontFamily, clientSettings.sidebar.fontSize],
  )

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
  const savingThrows = useMemo(
    () => [
      { label: 'Fort', value: mudState.fortitude },
      { label: 'Refl', value: mudState.reflex },
      { label: 'Will', value: mudState.willpower },
    ],
    [mudState.fortitude, mudState.reflex, mudState.willpower],
  )
  const characterHeading = useMemo(
    () => formatCharacterHeading(mudState.characterName, mudState.title),
    [mudState.characterName, mudState.title],
  )

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
      if (event.target === commandInputRef.current || shouldPreservePointerFocus(event.target)) {
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

    sendMessage({ type: 'msdp-config', msdpVariables: activeMsdpVariables })
  }, [activeMsdpVariables, connected, sendMessage])

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
      setHistoryIndex(null)
      setHistoryDraft('')
      setCommand('')
      dispatchInputText(command)
      focusCommandInput(commandInputRef.current)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [connected, dispatchInputText])

  function handleConnectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (connected) {
      sendMessage({ type: 'disconnect' })
      return
    }

    statusRef.current = 'connecting'
    setStatus('connecting')
    setStatusDetail(`Connecting to ${host}:${port}...`)
    sendMessage({ type: 'connect', host, port, msdpVariables: activeMsdpVariables })
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

    const trimmedCommand = command.trim()

    setHistoryIndex(null)
    setHistoryDraft('')

    if (!trimmedCommand) {
      sendInputLine('')
    } else {
      dispatchInputText(command)
    }

    setCommand('')
    focusCommandInput(commandInputRef.current)
  }

  function handleCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    if (event.key === 'Tab') {
      const prefix = command.trim().toLowerCase()
      if (!prefix) {
        return
      }

      const matchingCommands = commandHistory.filter((entry) =>
        entry.trim().toLowerCase().startsWith(prefix),
      )
      if (matchingCommands.length === 0) {
        return
      }

      event.preventDefault()
      const completedCommand = matchingCommands[matchingCommands.length - 1]
      setCommand(completedCommand)
      setHistoryIndex(null)
      setHistoryDraft(completedCommand)
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

  function updateAlias(aliasId: string, updates: Partial<AliasDefinition>) {
    setAliases((current) => current.map((alias) => (alias.id === aliasId ? { ...alias, ...updates } : alias)))
  }

  function updateTrigger(triggerId: string, updates: Partial<TriggerDefinition>) {
    setTriggers((current) =>
      current.map((trigger) => (trigger.id === triggerId ? { ...trigger, ...updates } : trigger)),
    )
  }

  function toggleAutomationMenu(menuId: AutomationMenuId) {
    setOpenAutomationMenu((current) => (current === menuId ? null : menuId))
  }

  function handleAddAlias() {
    setAliases((current) => [...current, createEmptyAlias()])
    setAutomationNotice(null)
  }

  function handleAddTrigger() {
    setTriggers((current) => [...current, createEmptyTrigger()])
    setAutomationNotice(null)
  }

  function updateTerminalSettings(updates: Partial<ClientSettings['terminal']>) {
    setClientSettings((current) => ({
      ...current,
      terminal: {
        ...current.terminal,
        ...updates,
      },
    }))
    setAutomationNotice(null)
  }

  function updateMinimapSettings(updates: Partial<ClientSettings['minimap']>) {
    setClientSettings((current) => ({
      ...current,
      minimap: {
        ...current.minimap,
        ...updates,
      },
    }))
    setAutomationNotice(null)
  }

  function updateSidebarSettings(updates: Partial<ClientSettings['sidebar']>) {
    setClientSettings((current) => ({
      ...current,
      sidebar: {
        ...current.sidebar,
        ...updates,
      },
    }))
    setAutomationNotice(null)
  }

  function updateMsdpVariable(key: MsdpVariableKey, nextValue: string) {
    setClientSettings((current) => ({
      ...current,
      msdp: {
        ...current.msdp,
        [key]: nextValue,
      },
    }))
    setAutomationNotice(null)
  }

  function handleConfigExport() {
    downloadJsonFile('luminari-web-client-config.json', {
      type: 'luminari-web-client-config',
      version: CLIENT_CONFIG_EXPORT_VERSION,
      settings: normalizeClientSettings(clientSettings),
      aliases,
      triggers,
    })
    setOpenAutomationMenu(null)
    setAutomationNotice({
      kind: 'success',
      text: `Saved settings, ${aliases.length} alias${pluralize(aliases.length)}, and ${triggers.length} trigger${pluralize(triggers.length)} to file.`,
    })
  }

  async function handleConfigImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    try {
      const importedConfig = parseClientConfigImport(await file.text(), clientSettings, aliases, triggers)
      setClientSettings(importedConfig.settings)
      setAliases(importedConfig.aliases)
      setTriggers(importedConfig.triggers)
      setOpenAutomationMenu(null)
      setAutomationNotice({
        kind: 'success',
        text: `Loaded settings, ${importedConfig.aliases.length} alias${pluralize(importedConfig.aliases.length)}, and ${importedConfig.triggers.length} trigger${pluralize(importedConfig.triggers.length)} from ${file.name}.`,
      })
    } catch (error) {
      setAutomationNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to load configuration.',
      })
    }
  }

  function handleTerminalClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!connected || event.button !== 0 || hasExpandedSelection()) {
      return
    }

    focusCommandInput(commandInputRef.current)
  }

  return (
    <div className="app-shell">
      <div ref={menuBarRef} className="window-menu-bar panel" data-prevent-command-focus>
        <div className="window-menu-links" role="menubar" aria-label="Window menu">
          {connected ? (
            <button type="button" className="window-menu-link" onClick={() => setIsHeaderVisible((current) => !current)}>
              {isHeaderVisible ? 'Hide Header' : 'Show Header'}
            </button>
          ) : null}

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'aliases' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'aliases'}
              onClick={() => toggleAutomationMenu('aliases')}
            >
              Aliases
            </button>

            {openAutomationMenu === 'aliases' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>Aliases</h3>
                      <p>Literal aliases match the command name and put remaining text into %1.</p>
                    </div>

                    <div className="automation-actions">
                      <button type="button" onClick={handleAddAlias}>
                        Add
                      </button>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    Use <code>*</code> as a wildcard and <code>%1</code> through <code>%9</code> in expansions.
                  </p>

                  {aliases.length === 0 ? (
                    <p className="automation-empty">No aliases saved yet.</p>
                  ) : (
                    <div className="automation-list">
                      {aliases.map((alias) => (
                        <div key={alias.id} className="automation-item">
                          <div className="automation-item-header">
                            <label className="automation-toggle">
                              <input
                                type="checkbox"
                                checked={alias.enabled}
                                onChange={(event) => updateAlias(alias.id, { enabled: event.target.checked })}
                              />
                              <span>{alias.enabled ? 'Enabled' : 'Disabled'}</span>
                            </label>

                            <button
                              type="button"
                              className="automation-delete"
                              onClick={() => setAliases((current) => current.filter((entry) => entry.id !== alias.id))}
                            >
                              Delete
                            </button>
                          </div>

                          <div className="automation-fields">
                            <label>
                              <span>Pattern</span>
                              <input
                                value={alias.pattern}
                                onChange={(event) => updateAlias(alias.id, { pattern: event.target.value })}
                                placeholder="k *"
                              />
                            </label>

                            <label>
                              <span>Expansion</span>
                              <textarea
                                rows={2}
                                value={alias.expansion}
                                onChange={(event) => updateAlias(alias.id, { expansion: event.target.value })}
                                placeholder="kill %1"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'triggers' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'triggers'}
              onClick={() => toggleAutomationMenu('triggers')}
            >
              Triggers
            </button>

            {openAutomationMenu === 'triggers' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>Triggers</h3>
                      <p>Literal trigger patterns match anywhere in a line; wildcards let you capture text.</p>
                    </div>

                    <div className="automation-actions">
                      <button type="button" onClick={handleAddTrigger}>
                        Add
                      </button>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    Use <code>*</code> as a wildcard and <code>%1</code> through <code>%9</code> in actions.
                  </p>

                  {triggers.length === 0 ? (
                    <p className="automation-empty">No triggers saved yet.</p>
                  ) : (
                    <div className="automation-list">
                      {triggers.map((trigger) => (
                        <div key={trigger.id} className="automation-item">
                          <div className="automation-item-header">
                            <label className="automation-toggle">
                              <input
                                type="checkbox"
                                checked={trigger.enabled}
                                onChange={(event) => updateTrigger(trigger.id, { enabled: event.target.checked })}
                              />
                              <span>{trigger.enabled ? 'Enabled' : 'Disabled'}</span>
                            </label>

                            <button
                              type="button"
                              className="automation-delete"
                              onClick={() => setTriggers((current) => current.filter((entry) => entry.id !== trigger.id))}
                            >
                              Delete
                            </button>
                          </div>

                          <div className="automation-fields">
                            <label>
                              <span>Pattern</span>
                              <input
                                value={trigger.pattern}
                                onChange={(event) => updateTrigger(trigger.id, { pattern: event.target.value })}
                                placeholder="* tells you '*'"
                              />
                            </label>

                            <label>
                              <span>Action</span>
                              <textarea
                                rows={2}
                                value={trigger.action}
                                onChange={(event) => updateTrigger(trigger.id, { action: event.target.value })}
                                placeholder="tell %1 Thanks for the message."
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'msdpVars' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'msdpVars'}
              onClick={() => toggleAutomationMenu('msdpVars')}
            >
              MSDP Vars
            </button>

            {openAutomationMenu === 'msdpVars' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>MSDP Vars</h3>
                      <p>Rename the MSDP variable names this client requests and parses.</p>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    These mappings are saved with your client settings and sent to the proxy when you connect.
                  </p>

                  <div className="settings-list">
                    {MSDP_VARIABLE_GROUPS.map((group) => (
                      <section key={group.title} className="settings-group">
                        <div className="settings-group-header">
                          <h4>{group.title}</h4>
                          <p>{group.description}</p>
                        </div>

                        <div className="msdp-vars-grid">
                          {group.fields.map((field) => (
                            <label key={field.key}>
                              <span>{field.label}</span>
                              <input
                                value={clientSettings.msdp[field.key]}
                                onChange={(event) => updateMsdpVariable(field.key, event.target.value)}
                                placeholder={defaultMsdpVariables[field.key]}
                              />
                            </label>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="window-menu-item">
            <button
              type="button"
              className={`window-menu-link${openAutomationMenu === 'settings' ? ' window-menu-link-open' : ''}`}
              aria-expanded={openAutomationMenu === 'settings'}
              onClick={() => toggleAutomationMenu('settings')}
            >
              Settings
            </button>

            {openAutomationMenu === 'settings' ? (
              <div className="window-menu-dropdown">
                <div className="automation-menu-content">
                  <div className="automation-section-header">
                    <div>
                      <h3>Settings</h3>
                      <p>Adjust output behavior and save or load your full client configuration.</p>
                    </div>

                    <div className="automation-actions">
                      <button type="button" onClick={() => configFileInputRef.current?.click()}>
                        Load
                      </button>
                      <button type="button" onClick={handleConfigExport}>
                        Save
                      </button>
                    </div>
                  </div>

                  <p className="automation-menu-help">
                    Saved config files include display settings, MSDP variable mappings, aliases, and triggers.
                  </p>

                  <div className="settings-list">
                    <section className="settings-group">
                      <div className="settings-group-header">
                        <h4>Output window</h4>
                        <p>Fine-tune readability and scrolling in the main MUD output pane.</p>
                      </div>

                      <div className="settings-fields">
                        <label>
                          <span>Font size</span>
                          <select
                            value={String(clientSettings.terminal.fontSize)}
                            onChange={(event) =>
                              updateTerminalSettings({ fontSize: Number.parseInt(event.target.value, 10) })
                            }
                          >
                            {OUTPUT_FONT_SIZE_OPTIONS.map((fontSize) => (
                              <option key={fontSize} value={fontSize}>
                                {fontSize}px
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Line spacing</span>
                          <select
                            value={String(clientSettings.terminal.lineHeight)}
                            onChange={(event) =>
                              updateTerminalSettings({ lineHeight: Number.parseFloat(event.target.value) })
                            }
                          >
                            {OUTPUT_LINE_HEIGHT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="settings-toggle-list">
                        <label className="automation-toggle">
                          <input
                            type="checkbox"
                            checked={clientSettings.terminal.autoScroll}
                            onChange={(event) => updateTerminalSettings({ autoScroll: event.target.checked })}
                          />
                          <span>Auto-scroll when new output arrives</span>
                        </label>

                        <label className="automation-toggle">
                          <input
                            type="checkbox"
                            checked={clientSettings.terminal.wrapLines}
                            onChange={(event) => updateTerminalSettings({ wrapLines: event.target.checked })}
                          />
                          <span>Wrap long lines in the output window</span>
                        </label>
                      </div>
                    </section>

                    <section className="settings-group">
                      <div className="settings-group-header">
                        <h4>Minimap</h4>
                        <p>Control the map text size and how tall the map pane stays.</p>
                      </div>

                      <div className="settings-fields">
                        <label>
                          <span>Font size</span>
                          <input
                            type="number"
                            min={8}
                            max={48}
                            step={1}
                            inputMode="numeric"
                            value={clientSettings.minimap.fontSize}
                            onChange={(event) => {
                              const nextValue = parsePositiveIntegerInput(event.target.value)
                              if (nextValue !== null) {
                                updateMinimapSettings({ fontSize: nextValue })
                              }
                            }}
                          />
                        </label>

                        <label>
                          <span>Pane height</span>
                          <input
                            type="number"
                            min={6}
                            max={48}
                            step={1}
                            inputMode="numeric"
                            value={clientSettings.minimap.paneHeight}
                            onChange={(event) => {
                              const nextValue = parsePositiveIntegerInput(event.target.value)
                              if (nextValue !== null) {
                                updateMinimapSettings({ paneHeight: nextValue })
                              }
                            }}
                          />
                        </label>
                      </div>
                    </section>

                    <section className="settings-group">
                      <div className="settings-group-header">
                        <h4>Sidebar panels</h4>
                        <p>Use one shared font for character info, quests, group, and affects.</p>
                      </div>

                      <div className="settings-fields">
                        <label>
                          <span>Panel font</span>
                          <select
                            value={clientSettings.sidebar.fontFamily}
                            onChange={(event) => {
                              if (isSidebarFontFamily(event.target.value)) {
                                updateSidebarSettings({ fontFamily: event.target.value })
                              }
                            }}
                          >
                            {SIDEBAR_FONT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          <span>Panel font size</span>
                          <input
                            type="number"
                            min={8}
                            max={32}
                            step={1}
                            inputMode="numeric"
                            value={clientSettings.sidebar.fontSize}
                            onChange={(event) => {
                              const nextValue = parsePositiveIntegerInput(event.target.value)
                              if (nextValue !== null) {
                                updateSidebarSettings({ fontSize: nextValue })
                              }
                            }}
                          />
                        </label>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {automationNotice ? (
          <p className={`window-menu-status window-menu-status-${automationNotice.kind}`}>{automationNotice.text}</p>
        ) : null}

        <input
          ref={configFileInputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleConfigImport}
        />
      </div>

      {isHeaderVisible ? (
        <div className="app-header" data-prevent-command-focus>
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
          <div
            ref={terminalRef}
            className="terminal-output"
            data-prevent-command-focus
            onClick={handleTerminalClick}
            style={terminalOutputStyle}
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

            <pre className="minimap" style={minimapStyle} dangerouslySetInnerHTML={{ __html: renderMudHtml(mapOutput) }} />
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

            <div className="tab-panel" role="tabpanel" style={sidebarPanelStyle}>
              {activeSidebarTab === 'character' ? (
                <>
                  <div className="identity-block">
                    <strong
                      dangerouslySetInnerHTML={{
                        __html: renderMudHtml(characterHeading),
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

                  <div className="saving-throw-grid" aria-label="Saving throws">
                    {savingThrows.map((save) => (
                      <div key={save.label} className="saving-throw-cell">
                        <span className="saving-throw-label">{save.label}</span>
                        <span className="saving-throw-value">{formatSignedNumber(save.value)}</span>
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

function createEmptyAlias(): AliasDefinition {
  return {
    id: createAutomationId('alias'),
    pattern: '',
    expansion: '',
    enabled: true,
  }
}

function createEmptyTrigger(): TriggerDefinition {
  return {
    id: createAutomationId('trigger'),
    pattern: '',
    action: '',
    enabled: true,
  }
}

function createAutomationId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function expandAliasCommands(text: string, aliases: AliasDefinition[], depth = 0): string[] {
  const trimmedText = text.trim()
  if (!trimmedText) {
    return []
  }

  if (depth >= AUTOMATION_RECURSION_LIMIT) {
    return [trimmedText]
  }

  for (const alias of aliases) {
    if (!alias.enabled) {
      continue
    }

    const match = matchAliasPattern(trimmedText, alias.pattern)
    if (!match) {
      continue
    }

    const expandedText = substituteCaptures(alias.expansion, trimmedText, match.captures)
    const splitCommands = splitCommandSequence(expandedText)
    if (splitCommands.length === 0) {
      return []
    }

    return splitCommands.flatMap((command) => expandAliasCommands(command, aliases, depth + 1))
  }

  return [trimmedText]
}

function consumeTriggerText(text: string, buffer: string, triggers: TriggerDefinition[]) {
  const normalizedText = stripMudFormatting(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const combined = `${buffer}${normalizedText}`
  const segments = combined.split('\n')
  const nextBuffer = segments.pop() ?? ''
  const commands: string[] = []

  for (const segment of segments) {
    const line = segment.trim()
    if (!line) {
      continue
    }

    for (const trigger of triggers) {
      if (!trigger.enabled) {
        continue
      }

      const match = matchTriggerPattern(line, trigger.pattern)
      if (!match) {
        continue
      }

      const actionText = substituteCaptures(trigger.action, line, match.captures)
      commands.push(...splitCommandSequence(actionText))
    }
  }

  return { buffer: nextBuffer, commands }
}

function matchAliasPattern(text: string, pattern: string) {
  const trimmedPattern = pattern.trim()
  if (!trimmedPattern) {
    return null
  }

  if (trimmedPattern.includes('*')) {
    return matchWildcardPattern(text, trimmedPattern)
  }

  const normalizedText = text.toLowerCase()
  const normalizedPattern = trimmedPattern.toLowerCase()
  if (normalizedText === normalizedPattern) {
    return { captures: [''] }
  }

  if (normalizedText.startsWith(`${normalizedPattern} `)) {
    return { captures: [text.slice(trimmedPattern.length).trimStart()] }
  }

  return null
}

function matchTriggerPattern(text: string, pattern: string) {
  const trimmedPattern = pattern.trim()
  if (!trimmedPattern) {
    return null
  }

  if (trimmedPattern.includes('*')) {
    return matchWildcardPattern(text, trimmedPattern)
  }

  return text.toLowerCase().includes(trimmedPattern.toLowerCase()) ? { captures: [] } : null
}

function matchWildcardPattern(text: string, pattern: string) {
  const escapedSegments = pattern.trim().split('*').map(escapeRegExp)
  const matcher = new RegExp(`^${escapedSegments.join('(.*?)')}$`, 'i')
  const match = matcher.exec(text)
  if (!match) {
    return null
  }

  return { captures: match.slice(1).map((capture) => capture.trim()) }
}

function substituteCaptures(template: string, source: string, captures: string[]) {
  return template.replace(/%(\d)/g, (_match, indexText: string) => {
    const index = Number(indexText)
    if (index === 0) {
      return source
    }

    return captures[index - 1] ?? ''
  })
}

function splitCommandSequence(value: string) {
  return value
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripMudFormatting(value: string) {
  return convertLuminariColorCodes(value).replace(ANSI_ESCAPE_PATTERN, '')
}

function loadAliasesFromCookies() {
  return parsePersistedAliases(readChunkedCookie(ALIASES_COOKIE_NAME))
}

function loadTriggersFromCookies() {
  return parsePersistedTriggers(readChunkedCookie(TRIGGERS_COOKIE_NAME))
}

function loadClientSettingsFromCookies() {
  return parsePersistedClientSettings(readChunkedCookie(CLIENT_SETTINGS_COOKIE_NAME))
}

function saveAliasesToCookies(aliases: AliasDefinition[]) {
  writeChunkedCookie(ALIASES_COOKIE_NAME, JSON.stringify(aliases))
}

function saveTriggersToCookies(triggers: TriggerDefinition[]) {
  writeChunkedCookie(TRIGGERS_COOKIE_NAME, JSON.stringify(triggers))
}

function saveClientSettingsToCookies(settings: ClientSettings) {
  writeChunkedCookie(CLIENT_SETTINGS_COOKIE_NAME, JSON.stringify(settings))
}

function parsePersistedAliases(value: string | null) {
  if (!value) {
    return []
  }

  try {
    return normalizeAliases(JSON.parse(value))
  } catch {
    return []
  }
}

function parsePersistedTriggers(value: string | null) {
  if (!value) {
    return []
  }

  try {
    return normalizeTriggers(JSON.parse(value))
  } catch {
    return []
  }
}

function parsePersistedClientSettings(value: string | null) {
  if (!value) {
    return DEFAULT_CLIENT_SETTINGS
  }

  try {
    return normalizeClientSettings(JSON.parse(value))
  } catch {
    return DEFAULT_CLIENT_SETTINGS
  }
}

function parseAliasImport(content: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Alias file is not valid JSON.')
  }

  return normalizeAliases(extractImportedEntries(parsed, 'aliases'), 'Alias file must contain an aliases array.')
}

function parseTriggerImport(content: string) {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Trigger file is not valid JSON.')
  }

  return normalizeTriggers(extractImportedEntries(parsed, 'triggers'), 'Trigger file must contain a triggers array.')
}

function parseClientConfigImport(
  content: string,
  currentSettings: ClientSettings,
  currentAliases: AliasDefinition[],
  currentTriggers: TriggerDefinition[],
) {
  let parsed: unknown

  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Configuration file is not valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Configuration file must be a JSON object.')
  }

  const record = parsed as Record<string, unknown>
  const type = record.type

  if ('settings' in record) {
    return {
      settings: normalizeClientSettings(record.settings, 'Configuration file must contain a settings object.'),
      aliases: normalizeAliases(extractImportedEntries(record, 'aliases'), 'Configuration file must contain an aliases array.'),
      triggers: normalizeTriggers(
        extractImportedEntries(record, 'triggers'),
        'Configuration file must contain a triggers array.',
      ),
    }
  }

  if (type === 'luminari-web-client-aliases' || ('aliases' in record && !('triggers' in record))) {
    return {
      settings: currentSettings,
      aliases: parseAliasImport(content),
      triggers: currentTriggers,
    }
  }

  if (type === 'luminari-web-client-triggers' || ('triggers' in record && !('aliases' in record))) {
    return {
      settings: currentSettings,
      aliases: currentAliases,
      triggers: parseTriggerImport(content),
    }
  }

  throw new Error('Configuration file must include settings, aliases, and triggers.')
}

function extractImportedEntries(parsed: unknown, key: 'aliases' | 'triggers') {
  if (Array.isArray(parsed)) {
    return parsed
  }

  if (parsed && typeof parsed === 'object' && key in parsed) {
    const nestedEntries = (parsed as Record<string, unknown>)[key]
    if (Array.isArray(nestedEntries)) {
      return nestedEntries
    }
  }

  throw new Error(key === 'aliases' ? 'Alias file must contain an aliases array.' : 'Trigger file must contain a triggers array.')
}

function normalizeClientSettings(value: unknown, emptyStateMessage?: string): ClientSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (emptyStateMessage) {
      throw new Error(emptyStateMessage)
    }

    return DEFAULT_CLIENT_SETTINGS
  }

  const record = value as Record<string, unknown>
  const terminalValue = record.terminal
  if (!terminalValue || typeof terminalValue !== 'object' || Array.isArray(terminalValue)) {
    if (emptyStateMessage) {
      throw new Error('Configuration settings must include a terminal object.')
    }

    return DEFAULT_CLIENT_SETTINGS
  }

  const terminalRecord = terminalValue as Record<string, unknown>
  const minimapRecord = isObjectRecord(record.minimap) ? record.minimap : null
  const sidebarRecord = isObjectRecord(record.sidebar) ? record.sidebar : null

  return {
    terminal: {
      fontSize: clampNumber(readNumericSetting(terminalRecord.fontSize), 10, 32, DEFAULT_CLIENT_SETTINGS.terminal.fontSize),
      lineHeight: clampNumber(
        readNumericSetting(terminalRecord.lineHeight),
        1.2,
        2.2,
        DEFAULT_CLIENT_SETTINGS.terminal.lineHeight,
      ),
      autoScroll:
        typeof terminalRecord.autoScroll === 'boolean'
          ? terminalRecord.autoScroll
          : DEFAULT_CLIENT_SETTINGS.terminal.autoScroll,
      wrapLines:
        typeof terminalRecord.wrapLines === 'boolean'
          ? terminalRecord.wrapLines
          : DEFAULT_CLIENT_SETTINGS.terminal.wrapLines,
    },
    minimap: {
      fontSize: clampNumber(
        readNumericSetting(minimapRecord?.fontSize),
        10,
        32,
        DEFAULT_CLIENT_SETTINGS.minimap.fontSize,
      ),
      paneHeight: clampNumber(
        readNumericSetting(minimapRecord?.paneHeight),
        10,
        32,
        DEFAULT_CLIENT_SETTINGS.minimap.paneHeight,
      ),
    },
    sidebar: {
      fontFamily: isSidebarFontFamily(sidebarRecord?.fontFamily)
        ? sidebarRecord.fontFamily
        : DEFAULT_CLIENT_SETTINGS.sidebar.fontFamily,
      fontSize: clampNumber(readNumericSetting(sidebarRecord?.fontSize), 8, 32, DEFAULT_CLIENT_SETTINGS.sidebar.fontSize),
    },
    msdp: normalizeMsdpVariableMap(record.msdp),
  }
}

function normalizeAliases(value: unknown, emptyStateMessage?: string): AliasDefinition[] {
  if (!Array.isArray(value)) {
    if (emptyStateMessage) {
      throw new Error(emptyStateMessage)
    }

    return []
  }

  return value.map((entry, index) => normalizeAliasEntry(entry, index))
}

function normalizeTriggers(value: unknown, emptyStateMessage?: string): TriggerDefinition[] {
  if (!Array.isArray(value)) {
    if (emptyStateMessage) {
      throw new Error(emptyStateMessage)
    }

    return []
  }

  return value.map((entry, index) => normalizeTriggerEntry(entry, index))
}

function normalizeAliasEntry(value: unknown, index: number): AliasDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error(`Alias ${index + 1} is invalid.`)
  }

  const record = value as Record<string, unknown>
  const pattern = readOptionalString(record, ['pattern', 'name'])
  const expansion = readOptionalString(record, ['expansion', 'value', 'command'])

  if (!pattern?.trim() || !expansion?.trim()) {
    throw new Error(`Alias ${index + 1} must include both pattern and expansion.`)
  }

  return {
    id: readOptionalString(record, ['id'])?.trim() || createAutomationId('alias'),
    pattern,
    expansion,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
  }
}

function normalizeTriggerEntry(value: unknown, index: number): TriggerDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error(`Trigger ${index + 1} is invalid.`)
  }

  const record = value as Record<string, unknown>
  const pattern = readOptionalString(record, ['pattern', 'match'])
  const action = readOptionalString(record, ['action', 'command', 'expansion'])

  if (!pattern?.trim() || !action?.trim()) {
    throw new Error(`Trigger ${index + 1} must include both pattern and action.`)
  }

  return {
    id: readOptionalString(record, ['id'])?.trim() || createAutomationId('trigger'),
    pattern,
    action,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
  }
}

function readOptionalString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') {
      return value
    }
  }

  return undefined
}

function readNumericSetting(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return undefined
}

function clampNumber(value: number | undefined, minimum: number, maximum: number, fallback: number) {
  if (value === undefined) {
    return fallback
  }

  return Math.min(Math.max(value, minimum), maximum)
}

function parsePositiveIntegerInput(value: string) {
  if (!value.trim()) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isSidebarFontFamily(value: unknown): value is SidebarFontFamily {
  return value === 'sans' || value === 'mono' || value === 'serif'
}

function readChunkedCookie(name: string) {
  if (typeof document === 'undefined') {
    return null
  }

  const cookies = parseCookieMap(document.cookie)
  const singleValue = cookies.get(name)
  if (singleValue !== undefined) {
    return decodeURIComponent(singleValue)
  }

  const countText = cookies.get(`${name}.count`)
  if (!countText) {
    return null
  }

  const count = Number(countText)
  if (!Number.isInteger(count) || count < 1) {
    return null
  }

  let combined = ''
  for (let index = 0; index < count; index += 1) {
    const chunk = cookies.get(`${name}.${index}`)
    if (chunk === undefined) {
      return null
    }

    combined += chunk
  }

  return decodeURIComponent(combined)
}

function writeChunkedCookie(name: string, rawValue: string) {
  if (typeof document === 'undefined') {
    return
  }

  clearCookieGroup(name)

  const encodedValue = encodeURIComponent(rawValue)
  const chunks = []
  for (let index = 0; index < encodedValue.length; index += AUTOMATION_COOKIE_CHUNK_SIZE) {
    chunks.push(encodedValue.slice(index, index + AUTOMATION_COOKIE_CHUNK_SIZE))
  }

  if (chunks.length <= 1) {
    setCookieValue(name, encodedValue)
    return
  }

  setCookieValue(`${name}.count`, String(chunks.length))
  chunks.forEach((chunk, index) => {
    setCookieValue(`${name}.${index}`, chunk)
  })
}

function clearCookieGroup(name: string) {
  if (typeof document === 'undefined') {
    return
  }

  const cookies = parseCookieMap(document.cookie)
  for (const cookieName of cookies.keys()) {
    if (cookieName === name || cookieName === `${name}.count` || cookieName.startsWith(`${name}.`)) {
      expireCookie(cookieName)
    }
  }
}

function setCookieValue(name: string, value: string) {
  document.cookie = `${name}=${value}; max-age=${AUTOMATION_COOKIE_MAX_AGE}; path=/; SameSite=Lax`
}

function expireCookie(name: string) {
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`
}

function parseCookieMap(cookieHeader: string) {
  const cookies = new Map<string, string>()
  if (!cookieHeader.trim()) {
    return cookies
  }

  for (const entry of cookieHeader.split(/;\s*/)) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = entry.slice(0, separatorIndex)
    const value = entry.slice(separatorIndex + 1)
    cookies.set(key, value)
  }

  return cookies
}

function downloadJsonFile(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function pluralize(count: number) {
  return count === 1 ? '' : 's'
}

function formatCharacterHeading(characterName?: string, title?: string) {
  const trimmedName = characterName?.trim()
  const trimmedTitle = title?.trim()

  if (!trimmedTitle) {
    return trimmedName || 'Unknown adventurer'
  }

  if (!trimmedName) {
    return trimmedTitle
  }

  const normalizedName = trimmedName.toLowerCase()
  const normalizedTitle = trimmedTitle.toLowerCase()

  if (normalizedTitle.includes(normalizedName)) {
    return trimmedTitle
  }

  return `${trimmedName} ${trimmedTitle}`
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

  const compactQuests = parseQuestEntries(value)
  if (compactQuests.length > 0) {
    return (
      <div className="quest-compact-list">
        {compactQuests.map((quest, index) => (
          <div className="quest-compact-item" key={`${quest.name ?? 'quest'}-${index}`}>
            {quest.name ? (
              <div dangerouslySetInnerHTML={{ __html: renderMudHtml(quest.name) }} />
            ) : null}
            {quest.type ? (
              <div dangerouslySetInnerHTML={{ __html: renderMudHtml(quest.type) }} />
            ) : null}
            {quest.vnum ? <div>{quest.vnum}</div> : null}
            {quest.progress ? <div>{quest.progress}</div> : null}
            {quest.targets ? (
              <div dangerouslySetInnerHTML={{ __html: renderMudHtml(quest.targets) }} />
            ) : null}
          </div>
        ))}
      </div>
    )
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

type QuestEntry = {
  name?: string
  type?: string
  vnum?: string
  progress?: string
  targets?: string
}

function parseQuestEntries(value: MudValue): QuestEntry[] {
  const source = Array.isArray(value) ? value : isMudRecord(value) ? [value] : []

  return source.flatMap((entry) => {
    if (!isMudRecord(entry)) {
      return []
    }

    const name = asOptionalText(readAnyKey(entry, ['name', 'NAME']))
    const type = asOptionalText(readAnyKey(entry, ['type', 'TYPE']))

    const rawVnum = readAnyKey(entry, ['vnum', 'VNUM'])
    const vnum =
      rawVnum === undefined || rawVnum === null
        ? undefined
        : typeof rawVnum === 'number'
          ? String(Math.trunc(rawVnum))
          : String(rawVnum).replace(/,/g, '')

    const progress = formatQuestProgress(readAnyKey(entry, ['progress', 'PROGRESS']))
    const targets = formatQuestTargets(readAnyKey(entry, ['targets', 'TARGETS']))

    if (!name && !type && !vnum && !progress && !targets) {
      return []
    }

    return [
      {
        name,
        type,
        vnum,
        progress,
        targets,
      },
    ]
  })
}

function formatQuestProgress(value: MudValue | undefined): string | undefined {
  if (!isMudRecord(value)) {
    return undefined
  }

  const completed = asOptionalText(readAnyKey(value, ['completed', 'COMPLETED']))
  const required = asOptionalText(readAnyKey(value, ['required', 'REQUIRED']))
  if (!completed || !required) {
    return undefined
  }

  return `${completed}/${required}`
}

function formatQuestTargets(value: MudValue | undefined): string | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const names = value
    .map((target) => {
      if (isMudRecord(target)) {
        return asOptionalText(readAnyKey(target, ['name', 'NAME']))
      }

      return asOptionalText(target)
    })
    .filter((entry): entry is string => Boolean(entry))

  if (names.length === 0) {
    return undefined
  }

  return names.join(', ')
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

function isMudRecord(value: unknown): value is Record<string, MudValue> {
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

function formatSignedNumber(value: number | undefined) {
  if (value === undefined) {
    return '—'
  }

  if (value > 0) {
    return `+${value}`
  }

  return String(value)
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

function shouldPreservePointerFocus(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest(
      'input, textarea, select, button, label, a, summary, [data-prevent-command-focus], [contenteditable="true"]',
    ),
  )
}

function hasExpandedSelection() {
  if (typeof window === 'undefined') {
    return false
  }

  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed)
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
