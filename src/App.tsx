import React, { useState, useEffect, useRef } from 'react'

type WorkspaceTab = 'chat' | 'voice' | 'codex' | 'chess' | 'image'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

interface ChatSession {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

interface ModelConfig {
  chat: string
  voice: string
  codex: string
  chess: string
  image: string
}

interface GeneratedImage {
  id: string
  prompt: string
  url: string
  timestamp: string
}

const SESSIONS_KEY = 'luxvm_or_sessions_v2'
const ACTIVE_SESSION_KEY = 'luxvm_or_active_v2'
const SETTINGS_KEY = 'luxvm_or_settings_v2'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_IMAGE_URL = 'https://openrouter.ai/api/v1/images'

const DEFAULT_MODELS: ModelConfig = {
  chat: 'nvidia/nemotron-3.5-lightning:free',
  voice: 'nvidia/nemotron-3.5-super-vl:free',
  codex: 'cohere/north-mini-code:free',
  chess: 'nvidia/nemotron-3.5-lightning:free',
  image: 'recraft/recraft-v4.1-flash-v2:free',
}

function safeGetStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeSetStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.error(`Storage write failed for ${key}:`, err)
  }
}

// ==========================================
// SELF-CONTAINED CHESS ENGINE (ZERO DEPS)
// ==========================================
type PieceChar = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k' | null
type Board = PieceChar[][]

const PIECE_UNICODE: Record<string, string> = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
}

function createInitialBoard(): Board {
  return [
    ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
    ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
  ]
}

function cloneBoard(b: Board): Board {
  return b.map((row) => [...row])
}

function isWhitePiece(p: PieceChar): boolean {
  return p !== null && p === p.toUpperCase()
}

function isBlackPiece(p: PieceChar): boolean {
  return p !== null && p === p.toLowerCase()
}

function coordsToUci(r1: number, c1: number, r2: number, c2: number): string {
  const files = 'abcdefgh'
  return `${files[c1]}${8 - r1}${files[c2]}${8 - r2}`
}

function uciToCoords(uci: string): { r1: number; c1: number; r2: number; c2: number; promo?: string } | null {
  const clean = uci.trim().toLowerCase().replace(/[^a-h1-8qrbn]/g, '')
  if (clean.length < 4) return null
  const files = 'abcdefgh'
  const c1 = files.indexOf(clean[0])
  const r1 = 8 - parseInt(clean[1], 10)
  const c2 = files.indexOf(clean[2])
  const r2 = 8 - parseInt(clean[3], 10)
  if ([c1, r1, c2, r2].some((v) => isNaN(v) || v < 0 || v > 7)) return null
  return { r1, c1, r2, c2, promo: clean[4] }
}

function boardToFen(board: Board, turn: 'w' | 'b'): string {
  const rows = board.map((row) => {
    let empty = 0
    let str = ''
    for (const cell of row) {
      if (!cell) {
        empty++
      } else {
        if (empty > 0) {
          str += empty
          empty = 0
        }
        str += cell
      }
    }
    if (empty > 0) str += empty
    return str
  })
  return `${rows.join('/')} ${turn} KQkq - 0 1`
}

function getPseudoLegalMoves(board: Board, r: number, c: number): [number, number][] {
  const piece = board[r][c]
  if (!piece) return []
  const white = isWhitePiece(piece)
  const moves: [number, number][] = []
  const inBounds = (nr: number, nc: number) => nr >= 0 && nr < 8 && nc >= 0 && nc < 8
  const isAlly = (nr: number, nc: number) => {
    const target = board[nr][nc]
    return target !== null && (white ? isWhitePiece(target) : isBlackPiece(target))
  }
  const isEnemy = (nr: number, nc: number) => {
    const target = board[nr][nc]
    return target !== null && (white ? isBlackPiece(target) : isWhitePiece(target))
  }

  const type = piece.toUpperCase()

  if (type === 'P') {
    const dir = white ? -1 : 1
    const startRow = white ? 6 : 1
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      moves.push([r + dir, c])
      if (r === startRow && !board[r + 2 * dir][c]) {
        moves.push([r + 2 * dir, c])
      }
    }
    for (const dc of [-1, 1]) {
      if (inBounds(r + dir, c + dc) && isEnemy(r + dir, c + dc)) {
        moves.push([r + dir, c + dc])
      }
    }
  } else if (type === 'N') {
    const jumps = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
    for (const [dr, dc] of jumps) {
      if (inBounds(r + dr, c + dc) && !isAlly(r + dr, c + dc)) {
        moves.push([r + dr, c + dc])
      }
    }
  } else if (type === 'K') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        if (inBounds(r + dr, c + dc) && !isAlly(r + dr, c + dc)) {
          moves.push([r + dr, c + dc])
        }
      }
    }
    // Castling
    if (white && r === 7 && c === 4) {
      if (!board[7][5] && !board[7][6] && board[7][7] === 'R') moves.push([7, 6])
      if (!board[7][3] && !board[7][2] && !board[7][1] && board[7][0] === 'R') moves.push([7, 2])
    }
    if (!white && r === 0 && c === 4) {
      if (!board[0][5] && !board[0][6] && board[0][7] === 'r') moves.push([0, 6])
      if (!board[0][3] && !board[0][2] && !board[0][1] && board[0][0] === 'r') moves.push([0, 2])
    }
  } else {
    const dirs: [number, number][] = []
    if (type === 'R' || type === 'Q') dirs.push([-1, 0], [1, 0], [0, -1], [0, 1])
    if (type === 'B' || type === 'Q') dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1])
    for (const [dr, dc] of dirs) {
      let nr = r + dr
      let nc = c + dc
      while (inBounds(nr, nc)) {
        if (isAlly(nr, nc)) break
        moves.push([nr, nc])
        if (isEnemy(nr, nc)) break
        nr += dr
        nc += dc
      }
    }
  }
  return moves
}

function applyRawMove(board: Board, r1: number, c1: number, r2: number, c2: number, promo?: string): Board {
  const next = cloneBoard(board)
  const piece = next[r1][c1]
  next[r2][c2] = piece
  next[r1][c1] = null

  // Handle castling rook shift
  if (piece === 'K' && r1 === 7 && c1 === 4 && c2 === 6) {
    next[7][5] = 'R'
    next[7][7] = null
  } else if (piece === 'K' && r1 === 7 && c1 === 4 && c2 === 2) {
    next[7][3] = 'R'
    next[7][0] = null
  } else if (piece === 'k' && r1 === 0 && c1 === 4 && c2 === 6) {
    next[0][5] = 'r'
    next[0][7] = null
  } else if (piece === 'k' && r1 === 0 && c1 === 4 && c2 === 2) {
    next[0][3] = 'r'
    next[0][0] = null
  }

  // Handle pawn promotion
  if (piece === 'P' && r2 === 0) {
    next[r2][c2] = (promo ? promo.toUpperCase() : 'Q') as PieceChar
  } else if (piece === 'p' && r2 === 7) {
    next[r2][c2] = (promo ? promo.toLowerCase() : 'q') as PieceChar
  }
  return next
}

function isKingInCheck(board: Board, whiteKing: boolean): boolean {
  let kr = -1
  let kc = -1
  const targetKing = whiteKing ? 'K' : 'k'
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === targetKing) {
        kr = r
        kc = c
      }
    }
  }
  if (kr === -1) return true

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c]
      if (!p) continue
      if (whiteKing ? isBlackPiece(p) : isWhitePiece(p)) {
        const attacks = getPseudoLegalMoves(board, r, c)
        if (attacks.some(([ar, ac]) => ar === kr && ac === kc)) return true
      }
    }
  }
  return false
}

function getAllLegalMoves(board: Board, whiteTurn: boolean): string[] {
  const legalUcis: string[] = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c]
      if (!p) continue
      if (whiteTurn ? isWhitePiece(p) : isBlackPiece(p)) {
        const dests = getPseudoLegalMoves(board, r, c)
        for (const [nr, nc] of dests) {
          const testBoard = applyRawMove(board, r, c, nr, nc)
          if (!isKingInCheck(testBoard, whiteTurn)) {
            legalUcis.push(coordsToUci(r, c, nr, nc))
          }
        }
      }
    }
  }
  return legalUcis
}

// ==========================================
// MAIN APPLICATION
// ==========================================
export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('chat')
  const [showSettings, setShowSettings] = useState(false)

  // Persistent Global Settings
  const initialSettings = safeGetStorage(SETTINGS_KEY, {
    apiKey: '',
    systemPrompt: 'You are LuxVM, a helpful, precise, and direct AI desktop assistant.',
    models: DEFAULT_MODELS,
  })

  const [apiKey, setApiKey] = useState<string>(initialSettings.apiKey || '')
  const [systemPrompt, setSystemPrompt] = useState<string>(
    initialSettings.systemPrompt || 'You are LuxVM, a helpful, precise, and direct AI desktop assistant.'
  )
  const [models, setModels] = useState<ModelConfig>({
    ...DEFAULT_MODELS,
    ...(initialSettings.models || {}),
  })

  useEffect(() => {
    safeSetStorage(SETTINGS_KEY, {
      apiKey: apiKey.trim(),
      systemPrompt: systemPrompt.trim(),
      models,
    })
  }, [apiKey, systemPrompt, models])

  const openRouterHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey.trim()}`,
    'HTTP-Referer': 'https://luxvm.desktop',
    'X-Title': 'LuxVM Desktop',
  })

  // ==========================================
  // 1. GENERAL CHAT STATE & LOGIC
  // ==========================================
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const saved = safeGetStorage<ChatSession[]>(SESSIONS_KEY, [])
    if (Array.isArray(saved) && saved.length > 0) return saved
    return [
      {
        id: 'default-session',
        title: 'New Chat',
        messages: [
          {
            id: 'welcome-1',
            role: 'assistant',
            content: 'Welcome to LuxVM Desktop. Paste your OpenRouter key in Settings to unlock Chat, Voice, Codex, Chess, and Image Studio!',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ],
        updatedAt: Date.now(),
      },
    ]
  })

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const savedId = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (savedId && sessions.some((s) => s.id === savedId)) return savedId
    return sessions[0]?.id || 'default-session'
  })

  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement | null>(null)
  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]

  useEffect(() => {
    safeSetStorage(SESSIONS_KEY, sessions)
  }, [sessions])

  useEffect(() => {
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentSession?.messages, isChatLoading, activeTab])

  const createNewChat = () => {
    const newSession: ChatSession = {
      id: String(Date.now()),
      title: 'New Chat',
      messages: [
        {
          id: 'welcome-new',
          role: 'assistant',
          content: 'Started a new session using your persistent personality and OpenRouter key.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ],
      updatedAt: Date.now(),
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
    setActiveTab('chat')
  }

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (sessions.length <= 1) createNewChat()
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id)
      if (remaining.length > 0) setActiveSessionId(remaining[0].id)
    }
  }

  const sendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = chatInput.trim()
    if (!trimmed || isChatLoading) return

    const userMsg: Message = {
      id: String(Date.now()),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    const updatedMessages = [...currentSession.messages, userMsg]
    const derivedTitle =
      currentSession.title === 'New Chat'
        ? trimmed.slice(0, 28) + (trimmed.length > 28 ? '...' : '')
        : currentSession.title

    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSession.id
          ? { ...s, title: derivedTitle, messages: updatedMessages, updatedAt: Date.now() }
          : s
      )
    )
    setChatInput('')
    setIsChatLoading(true)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 45000)

    try {
      if (!apiKey.trim()) {
        throw new Error('Missing OpenRouter API Key. Click ⚙️ Settings in the top right to paste it.')
      }

      const outboundMessages = [
        ...(systemPrompt.trim() ? [{ role: 'system' as const, content: systemPrompt.trim() }] : []),
        ...updatedMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content })),
      ]

      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify({
          model: models.chat,
          messages: outboundMessages,
        }),
        signal: controller.signal,
      })

      const rawText = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 220)}`)

      const data = JSON.parse(rawText)
      const reply = data?.choices?.[0]?.message?.content || 'Empty response from OpenRouter.'

      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSession.id
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: String(Date.now() + 1),
                    role: 'assistant',
                    content: reply,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ],
                updatedAt: Date.now(),
              }
            : s
        )
      )
    } catch (err: any) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSession.id
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  {
                    id: String(Date.now() + 1),
                    role: 'system',
                    content: `Error: ${err?.name === 'AbortError' ? 'Timed out after 45s' : err?.message}`,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ],
              }
            : s
        )
      )
    } finally {
      clearTimeout(timeoutId)
      setIsChatLoading(false)
    }
  }

  // ==========================================
  // 2. VOICE ASSISTANT STATE & LOGIC
  // ==========================================
  const [voiceHistory, setVoiceHistory] = useState<Message[]>([
    {
      id: 'v-init',
      role: 'assistant',
      content: 'Voice Assistant ready (powered by Gemini 2.5 Flash). Press the Microphone button to speak or type below.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ])
  const [voiceInput, setVoiceInput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isVoiceLoading, setIsVoiceLoading] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const recognitionRef = useRef<any>(null)

  const speakText = (text: string) => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const cleanText = text.replace(/[*#`]/g, '')
    const utterance = new SpeechSynthesisUtterance(cleanText)
    utterance.rate = 1.05
    utterance.pitch = 1.0
    window.speechSynthesis.speak(utterance)
  }

  const sendVoicePrompt = async (spokenText: string) => {
    const trimmed = spokenText.trim()
    if (!trimmed || isVoiceLoading) return

    const userMsg: Message = {
      id: String(Date.now()),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    const nextHist = [...voiceHistory, userMsg]
    setVoiceHistory(nextHist)
    setVoiceInput('')
    setIsVoiceLoading(true)

    try {
      if (!apiKey.trim()) throw new Error('Please paste your OpenRouter API key in ⚙️ Settings.')

      const voiceSystem = `${systemPrompt.trim()} Respond conversationally, concisely, and naturally as a spoken voice assistant without markdown formatting or code blocks unless asked.`

      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify({
          model: models.voice,
          messages: [
            { role: 'system', content: voiceSystem },
            ...nextHist
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .slice(-10)
              .map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      })

      const rawText = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`)

      const data = JSON.parse(rawText)
      const reply = data?.choices?.[0]?.message?.content || 'I did not catch a response.'

      setVoiceHistory((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: 'assistant',
          content: reply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])

      if (autoSpeak) speakText(reply)
    } catch (err: any) {
      setVoiceHistory((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          role: 'system',
          content: `Voice Error: ${err?.message}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])
    } finally {
      setIsVoiceLoading(false)
    }
  }

  const toggleMicrophone = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this environment. You can still type in the box below!')
      return
    }

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || ''
      if (transcript) {
        sendVoicePrompt(transcript)
      }
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
  }

  // ==========================================
  // 3. CODEX STUDIO STATE & LOGIC
  // ==========================================
  const [codexPrompt, setCodexPrompt] = useState('')
  const [codexLang, setCodexLang] = useState('TypeScript / React')
  const [codexOutput, setCodexOutput] = useState('// Your generated code will appear here...\n')
  const [isCodexLoading, setIsCodexLoading] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  const generateCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!codexPrompt.trim() || isCodexLoading) return

    setIsCodexLoading(true)
    setCopiedCode(false)

    try {
      if (!apiKey.trim()) throw new Error('Paste your OpenRouter API key in ⚙️ Settings first.')

      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify({
          model: models.codex,
          messages: [
            {
              role: 'system',
              content: `You are LuxVM Codex, an elite software engineer. Write clean, complete, production-ready ${codexLang} code. Output ONLY the code itself without markdown backticks or conversational filler unless briefly needed inside code comments.`,
            },
            { role: 'user', content: codexPrompt.trim() },
          ],
        }),
      })

      const rawText = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`)

      const data = JSON.parse(rawText)
      let code: string = data?.choices?.[0]?.message?.content || '// No code generated.'
      // Strip wrapping markdown fences if model included them
      code = code.replace(/^```[\w-]*\n?/i, '').replace(/\n?```$/i, '')
      setCodexOutput(code)
    } catch (err: any) {
      setCodexOutput(`// Generation Error:\n// ${err?.message}`)
    } finally {
      setIsCodexLoading(false)
    }
  }

  const copyCodeToClipboard = () => {
    navigator.clipboard.writeText(codexOutput)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
  }

  const downloadCodeFile = () => {
    const extMap: Record<string, string> = {
      'TypeScript / React': 'tsx',
      JavaScript: 'js',
      Python: 'py',
      'HTML / CSS': 'html',
      'C++': 'cpp',
      Rust: 'rs',
    }
    const ext = extMap[codexLang] || 'txt'
    const blob = new Blob([codexOutput], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `luxvm-codex-${Date.now()}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ==========================================
  // 4. CHESS BOT STATE & LOGIC
  // ==========================================
  const [board, setBoard] = useState<Board>(() => createInitialBoard())
  const [selectedSq, setSelectedSq] = useState<[number, number] | null>(null)
  const [legalTargets, setLegalTargets] = useState<[number, number][]>([])
  const [moveHistory, setMoveHistory] = useState<string[]>([])
  const [chessStatus, setChessStatus] = useState('Your turn (White). Click a piece to move.')
  const [isChessThinking, setIsChessThinking] = useState(false)

  const resetChess = () => {
    setBoard(createInitialBoard())
    setSelectedSq(null)
    setLegalTargets([])
    setMoveHistory([])
    setChessStatus('New game started. Your turn (White).')
    setIsChessThinking(false)
  }

  const handleSquareClick = async (r: number, c: number) => {
    if (isChessThinking) return

    const clickedPiece = board[r][c]

    // Select a white piece
    if (clickedPiece && isWhitePiece(clickedPiece)) {
      setSelectedSq([r, c])
      const allWhiteMoves = getAllLegalMoves(board, true)
      const targets: [number, number][] = []
      for (const uci of allWhiteMoves) {
        const parsed = uciToCoords(uci)
        if (parsed && parsed.r1 === r && parsed.c1 === c) {
          targets.push([parsed.r2, parsed.c2])
        }
      }
      setLegalTargets(targets)
      return
    }

    // Attempt move if a square is already selected
    if (selectedSq) {
      const [sr, sc] = selectedSq
      const isTarget = legalTargets.some(([tr, tc]) => tr === r && tc === c)
      if (!isTarget) {
        setSelectedSq(null)
        setLegalTargets([])
        return
      }

      const playerUci = coordsToUci(sr, sc, r, c)
      const afterPlayerBoard = applyRawMove(board, sr, sc, r, c)
      const nextHistory = [...moveHistory, playerUci]

      setBoard(afterPlayerBoard)
      setSelectedSq(null)
      setLegalTargets([])
      setMoveHistory(nextHistory)

      // Check Black legal moves
      const blackLegalMoves = getAllLegalMoves(afterPlayerBoard, false)
      if (blackLegalMoves.length === 0) {
        setChessStatus(
          isKingInCheck(afterPlayerBoard, false)
            ? 'Checkmate! You win! 🎉'
            : 'Stalemate! Draw.'
        )
        return
      }

      // Ask OpenRouter Chess Model for Black's move
      setIsChessThinking(true)
      setChessStatus('LuxVM Chess Bot is calculating...')

      try {
        let chosenUci = blackLegalMoves[Math.floor(Math.random() * blackLegalMoves.length)]

        if (apiKey.trim()) {
          const fen = boardToFen(afterPlayerBoard, 'b')
          const res = await fetch(OPENROUTER_CHAT_URL, {
            method: 'POST',
            headers: openRouterHeaders(),
            body: JSON.stringify({
              model: models.chess,
              messages: [
                {
                  role: 'system',
                  content:
                    'You are a chess grandmaster playing Black. Reply ONLY with a single legal UCI move (e.g. e7e5, g8f6) from the provided legal moves list. Do not include any other words or punctuation.',
                },
                {
                  role: 'user',
                  content: `Current FEN: ${fen}\nMove history: ${nextHistory.join(' ')}\nLegal moves for Black: ${blackLegalMoves.join(', ')}\nChoose the strongest move from the legal moves list:`,
                },
              ],
            }),
          })

          if (res.ok) {
            const data = await res.json()
            const rawReply: string = data?.choices?.[0]?.message?.content || ''
            const matched = blackLegalMoves.find((m) => rawReply.toLowerCase().includes(m))
            if (matched) chosenUci = matched
          }
        }

        const aiParsed = uciToCoords(chosenUci)!
        const afterAiBoard = applyRawMove(
          afterPlayerBoard,
          aiParsed.r1,
          aiParsed.c1,
          aiParsed.r2,
          aiParsed.c2,
          aiParsed.promo
        )
        const updatedHist = [...nextHistory, chosenUci]
        setBoard(afterAiBoard)
        setMoveHistory(updatedHist)

        const whiteLegalAfter = getAllLegalMoves(afterAiBoard, true)
        if (whiteLegalAfter.length === 0) {
          setChessStatus(
            isKingInCheck(afterAiBoard, true)
              ? `Checkmate! LuxVM wins with ${chosenUci}.`
              : 'Stalemate! Draw.'
          )
        } else if (isKingInCheck(afterAiBoard, true)) {
          setChessStatus(`AI played ${chosenUci}. Check! Your turn.`)
        } else {
          setChessStatus(`AI played ${chosenUci}. Your turn (White).`)
        }
      } catch {
        setChessStatus('AI move error. Reset or try again.')
      } finally {
        setIsChessThinking(false)
      }
    }
  }

  // ==========================================
  // 5. IMAGE STUDIO STATE & LOGIC
  // ==========================================
  const [imagePrompt, setImagePrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const [isImageLoading, setIsImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')

  const generateImage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!imagePrompt.trim() || isImageLoading) return

    setIsImageLoading(true)
    setImageError('')

    try {
      if (!apiKey.trim()) throw new Error('Please enter your OpenRouter API key in ⚙️ Settings.')

      const res = await fetch(OPENROUTER_IMAGE_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify({
          model: models.image,
          prompt: imagePrompt.trim(),
          aspect_ratio: aspectRatio,
        }),
      })

      const rawText = await res.text()
      if (!res.ok) {
        throw new Error(`OpenRouter Image HTTP ${res.status}: ${rawText.slice(0, 240)}`)
      }

      const data = JSON.parse(rawText)
      const item = data?.data?.[0]
      let imgUrl = ''
      if (item?.b64_json) {
        imgUrl = `data:image/png;base64,${item.b64_json}`
      } else if (item?.url) {
        imgUrl = item.url
      } else {
        throw new Error('No image data returned by model.')
      }

      setGeneratedImages((prev) => [
        {
          id: String(Date.now()),
          prompt: imagePrompt.trim(),
          url: imgUrl,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        ...prev,
      ])
    } catch (err: any) {
      setImageError(err?.message || 'Failed to generate image.')
    } finally {
      setIsImageLoading(false)
    }
  }

  // ==========================================
  // RENDER UI
  // ==========================================
  return (
    <div style={styles.appContainer}>
      {/* LEFT NAVIGATION & CHAT SIDEBAR */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarBrand}>
          <span style={styles.dot} />
          <strong>LuxVM Studio</strong>
        </div>

        <nav style={styles.navMenu}>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            style={{ ...styles.navBtn, ...(activeTab === 'chat' ? styles.navBtnActive : {}) }}
          >
            💬 General Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('voice')}
            style={{ ...styles.navBtn, ...(activeTab === 'voice' ? styles.navBtnActive : {}) }}
          >
            🎙️ Voice Assistant
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('codex')}
            style={{ ...styles.navBtn, ...(activeTab === 'codex' ? styles.navBtnActive : {}) }}
          >
            💻 Codex Studio
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chess')}
            style={{ ...styles.navBtn, ...(activeTab === 'chess' ? styles.navBtnActive : {}) }}
          >
            ♟️ Chess Bot
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('image')}
            style={{ ...styles.navBtn, ...(activeTab === 'image' ? styles.navBtnActive : {}) }}
          >
            🎨 Image Studio
          </button>
        </nav>

        <div style={styles.divider} />

        <div style={styles.sidebarHeader}>
          <button type="button" onClick={createNewChat} style={styles.newChatBtn}>
            + New Chat Thread
          </button>
        </div>

        <div style={styles.sessionList}>
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => {
                setActiveSessionId(session.id)
                setActiveTab('chat')
              }}
              style={{
                ...styles.sessionItem,
                backgroundColor:
                  activeTab === 'chat' && session.id === activeSessionId ? '#334155' : 'transparent',
              }}
            >
              <span style={styles.sessionTitle}>{session.title}</span>
              <button
                type="button"
                onClick={(e) => deleteSession(session.id, e)}
                style={styles.deleteBtn}
                title="Delete Chat"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* MAIN WORKSPACE */}
      <div style={styles.mainContent}>
        <header style={styles.header}>
          <div style={styles.brand}>
            <strong>
              {activeTab === 'chat' && '💬 General Chat'}
              {activeTab === 'voice' && '🎙️ Voice Assistant'}
              {activeTab === 'codex' && '💻 Codex Code Studio'}
              {activeTab === 'chess' && '♟️ Grandmaster Chess Bot'}
              {activeTab === 'image' && '🎨 Image Generation Studio'}
            </strong>
            <span style={styles.badge}>
              {models[activeTab]}
            </span>
          </div>
          <div style={styles.actions}>
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              style={styles.primaryBtn}
            >
              {showSettings ? 'Close Settings' : '⚙️ Settings'}
            </button>
          </div>
        </header>

        {/* GLOBAL SETTINGS DRAWER */}
        {showSettings && (
          <div style={styles.settingsPanel}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '15px' }}>
              OpenRouter API Key, Models & Personality Memory
            </h3>

            <div style={styles.fieldRow}>
              <label style={styles.label}>Global OpenRouter API Key (sk-or-...)</label>
              <input
                style={styles.input}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
              />
            </div>

            <div style={styles.grid2}>
              <div>
                <label style={styles.label}>Chat & Chess Model</label>
                <input
                  style={styles.input}
                  value={models.chat}
                  onChange={(e) =>
                    setModels({ ...models, chat: e.target.value, chess: e.target.value })
                  }
                />
              </div>
              <div>
                <label style={styles.label}>Voice Assistant Model</label>
                <input
                  style={styles.input}
                  value={models.voice}
                  onChange={(e) => setModels({ ...models, voice: e.target.value })}
                />
              </div>
              <div>
                <label style={styles.label}>Codex Studio Model</label>
                <input
                  style={styles.input}
                  value={models.codex}
                  onChange={(e) => setModels({ ...models, codex: e.target.value })}
                />
              </div>
              <div>
                <label style={styles.label}>Image Studio Model</label>
                <input
                  style={styles.input}
                  value={models.image}
                  onChange={(e) => setModels({ ...models, image: e.target.value })}
                />
              </div>
            </div>

            <div style={{ ...styles.fieldRow, marginTop: '10px' }}>
              <label style={styles.label}>Permanent Personality / System Prompt</label>
              <textarea
                style={{ ...styles.input, height: '60px', resize: 'vertical', fontFamily: 'inherit' }}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>

            <button type="button" onClick={() => setShowSettings(false)} style={styles.primaryBtn}>
              Done
            </button>
          </div>
        )}

        {/* TAB 1: GENERAL CHAT */}
        {activeTab === 'chat' && (
          <>
            <main style={styles.chatArea}>
              {currentSession?.messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    ...styles.messageRow,
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      ...styles.bubble,
                      backgroundColor:
                        msg.role === 'user'
                          ? '#2563eb'
                          : msg.role === 'system'
                          ? '#7f1d1d'
                          : '#1e293b',
                    }}
                  >
                    <div style={styles.meta}>
                      <span>{msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'LuxVM'}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div style={styles.content}>{msg.content}</div>
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div style={styles.messageRow}>
                  <div style={{ ...styles.bubble, backgroundColor: '#1e293b', opacity: 0.8 }}>
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </main>

            <form onSubmit={sendChatMessage} style={styles.footer}>
              <input
                style={styles.chatInput}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Message Nemotron 3.5 Lightning..."
                disabled={isChatLoading}
              />
              <button type="submit" style={styles.sendBtn} disabled={isChatLoading || !chatInput.trim()}>
                Send
              </button>
            </form>
          </>
        )}

        {/* TAB 2: VOICE ASSISTANT */}
        {activeTab === 'voice' && (
          <>
            <div style={styles.voiceTopBar}>
              <button
                type="button"
                onClick={toggleMicrophone}
                style={{
                  ...styles.micBtn,
                  backgroundColor: isListening ? '#dc2626' : '#2563eb',
                }}
              >
                {isListening ? '🛑 Listening... (Click to Stop)' : '🎙️ Speak to Gemini 2.5 Flash'}
              </button>
              <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoSpeak}
                  onChange={(e) => setAutoSpeak(e.target.checked)}
                />
                Auto-Speak Replies (TTS)
              </label>
              <button
                type="button"
                onClick={() => window.speechSynthesis?.cancel()}
                style={styles.secondaryBtn}
              >
                🔇 Mute Voice
              </button>
            </div>

            <main style={styles.chatArea}>
              {voiceHistory.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    ...styles.messageRow,
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      ...styles.bubble,
                      backgroundColor:
                        msg.role === 'user'
                          ? '#2563eb'
                          : msg.role === 'system'
                          ? '#7f1d1d'
                          : '#1e293b',
                    }}
                  >
                    <div style={styles.meta}>
                      <span>{msg.role === 'user' ? 'You' : 'Gemini Voice'}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div style={styles.content}>{msg.content}</div>
                  </div>
                </div>
              ))}
              {isVoiceLoading && (
                <div style={styles.messageRow}>
                  <div style={{ ...styles.bubble, backgroundColor: '#1e293b', opacity: 0.8 }}>
                    Processing voice response...
                  </div>
                </div>
              )}
            </main>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendVoicePrompt(voiceInput)
              }}
              style={styles.footer}
            >
              <input
                style={styles.chatInput}
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
                placeholder="Or type a message to Gemini 2.5 Flash..."
                disabled={isVoiceLoading}
              />
              <button type="submit" style={styles.sendBtn} disabled={isVoiceLoading || !voiceInput.trim()}>
                Speak / Send
              </button>
            </form>
          </>
        )}

        {/* TAB 3: CODEX STUDIO */}
        {activeTab === 'codex' && (
          <div style={styles.codexContainer}>
            <form onSubmit={generateCode} style={styles.codexLeft}>
              <label style={styles.label}>Target Language / Stack</label>
              <select
                style={styles.input}
                value={codexLang}
                onChange={(e) => setCodexLang(e.target.value)}
              >
                <option>TypeScript / React</option>
                <option>JavaScript</option>
                <option>Python</option>
                <option>HTML / CSS</option>
                <option>C++</option>
                <option>Rust</option>
              </select>

              <label style={{ ...styles.label, marginTop: '12px' }}>What should Codex build?</label>
              <textarea
                style={{ ...styles.input, flex: 1, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
                value={codexPrompt}
                onChange={(e) => setCodexPrompt(e.target.value)}
                placeholder="Describe the function, component, script, or algorithm you want generated..."
              />

              <button
                type="submit"
                style={{ ...styles.primaryBtn, marginTop: '12px', padding: '10px' }}
                disabled={isCodexLoading || !codexPrompt.trim()}
              >
                {isCodexLoading ? '⚡ Generating Code...' : '⚡ Generate Code'}
              </button>
            </form>

            <div style={styles.codexRight}>
              <div style={styles.codexToolbar}>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>{codexLang} Output</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" onClick={copyCodeToClipboard} style={styles.secondaryBtn}>
                    {copiedCode ? '✅ Copied!' : '📋 Copy Code'}
                  </button>
                  <button type="button" onClick={downloadCodeFile} style={styles.secondaryBtn}>
                    💾 Save File
                  </button>
                </div>
              </div>
              <pre style={styles.codeBlock}>
                <code>{codexOutput}</code>
              </pre>
            </div>
          </div>
        )}

        {/* TAB 4: CHESS BOT */}
        {activeTab === 'chess' && (
          <div style={styles.chessContainer}>
            <div style={styles.chessBoardWrapper}>
              <div style={styles.chessStatusBar}>
                <span>{chessStatus}</span>
                <button type="button" onClick={resetChess} style={styles.secondaryBtn}>
                  🔄 New Game
                </button>
              </div>

              <div style={styles.chessBoard}>
                {board.map((row, r) =>
                  row.map((cell, c) => {
                    const isDark = (r + c) % 2 === 1
                    const isSelected = selectedSq?.[0] === r && selectedSq?.[1] === c
                    const isLegalDest = legalTargets.some(([tr, tc]) => tr === r && tc === c)

                    return (
                      <div
                        key={`${r}-${c}`}
                        onClick={() => handleSquareClick(r, c)}
                        style={{
                          ...styles.chessSquare,
                          backgroundColor: isSelected
                            ? '#2563eb'
                            : isDark
                            ? '#334155'
                            : '#94a3b8',
                          color: cell && isWhitePiece(cell) ? '#ffffff' : '#090d16',
                        }}
                      >
                        {isLegalDest && <div style={styles.legalDot} />}
                        {cell ? PIECE_UNICODE[cell] : ''}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div style={styles.chessSidebar}>
              <h4 style={{ margin: '0 0 10px 0' }}>Move History (UCI)</h4>
              <div style={styles.moveList}>
                {moveHistory.length === 0 ? (
                  <span style={{ color: '#64748b', fontSize: '13px' }}>No moves yet. You play White.</span>
                ) : (
                  moveHistory.map((m, idx) => (
                    <div key={idx} style={{ fontSize: '13px', padding: '3px 0' }}>
                      {idx % 2 === 0 ? `${Math.floor(idx / 2) + 1}. ` : '   '}
                      <strong>{m}</strong> ({idx % 2 === 0 ? 'You' : 'AI'})
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: IMAGE GENERATION STUDIO */}
        {activeTab === 'image' && (
          <div style={styles.imageContainer}>
            <form onSubmit={generateImage} style={styles.imageControls}>
              <input
                style={{ ...styles.chatInput, flex: 1 }}
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Describe the image you want Recraft V4.1 Flash V2 to create..."
                disabled={isImageLoading}
              />
              <select
                style={{ ...styles.input, width: '110px' }}
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
              >
                <option value="1:1">1:1 Square</option>
                <option value="16:9">16:9 Wide</option>
                <option value="9:16">9:16 Tall</option>
                <option value="4:3">4:3 Photo</option>
              </select>
              <button
                type="submit"
                style={styles.sendBtn}
                disabled={isImageLoading || !imagePrompt.trim()}
              >
                {isImageLoading ? 'Generating...' : '🎨 Generate'}
              </button>
            </form>

            {imageError && (
              <div style={{ padding: '12px 20px', backgroundColor: '#7f1d1d', fontSize: '13px' }}>
                {imageError}
              </div>
            )}

            <div style={styles.imageGallery}>
              {generatedImages.length === 0 && !isImageLoading && (
                <div style={{ color: '#64748b', textAlign: 'center', marginTop: '60px' }}>
                  Enter a prompt above to generate images using {models.image}
                </div>
              )}
              {generatedImages.map((img) => (
                <div key={img.id} style={styles.imageCard}>
                  <img src={img.url} alt={img.prompt} style={styles.generatedImg} />
                  <div style={styles.imageCardFooter}>
                    <span style={{ fontSize: '12px', color: '#cbd5e1', flex: 1 }}>{img.prompt}</span>
                    <a
                      href={img.url}
                      download={`luxvm-image-${img.id}.png`}
                      style={{ ...styles.secondaryBtn, textDecoration: 'none' }}
                    >
                      💾 Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    overflow: 'hidden',
  },
  sidebar: {
    width: '250px',
    backgroundColor: '#090d16',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '16px',
    fontSize: '16px',
    borderBottom: '1px solid #1e293b',
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '10px',
  },
  navBtn: {
    textAlign: 'left',
    backgroundColor: 'transparent',
    color: '#cbd5e1',
    border: 'none',
    padding: '9px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  navBtnActive: {
    backgroundColor: '#1e293b',
    color: '#ffffff',
    borderLeft: '3px solid #2563eb',
  },
  divider: {
    height: '1px',
    backgroundColor: '#1e293b',
    margin: '4px 0',
  },
  sidebarHeader: {
    padding: '10px',
  },
  newChatBtn: {
    width: '100%',
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    padding: '8px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: '12px',
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 10px 10px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sessionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '7px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#cbd5e1',
  },
  sessionTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '15px',
    padding: '0 4px',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '16px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#22c55e',
  },
  badge: {
    fontSize: '11px',
    padding: '3px 8px',
    borderRadius: '12px',
    backgroundColor: '#0f172a',
    color: '#94a3b8',
    border: '1px solid #334155',
  },
  actions: {
    display: 'flex',
    gap: '10px',
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    padding: '7px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    color: '#f8fafc',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  settingsPanel: {
    padding: '16px 20px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '10px',
  },
  fieldRow: {
    marginBottom: '10px',
  },
  label: {
    display: 'block',
    fontSize: '11px',
    color: '#94a3b8',
    marginBottom: '4px',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    borderRadius: '6px',
    border: '1px solid #475569',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontSize: '13px',
  },
  chatArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  messageRow: {
    display: 'flex',
    width: '100%',
  },
  bubble: {
    maxWidth: '75%',
    padding: '12px 16px',
    borderRadius: '12px',
    lineHeight: 1.5,
    fontSize: '14px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  meta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '16px',
    fontSize: '11px',
    opacity: 0.7,
    marginBottom: '4px',
  },
  content: {
    margin: 0,
  },
  footer: {
    display: 'flex',
    gap: '10px',
    padding: '14px 20px',
    backgroundColor: '#1e293b',
    borderTop: '1px solid #334155',
  },
  chatInput: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #475569',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    fontSize: '14px',
    outline: 'none',
  },
  sendBtn: {
    backgroundColor: '#2563eb',
    color: '#fff',
    border: 'none',
    padding: '0 20px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '14px',
  },
  voiceTopBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '12px 20px',
    backgroundColor: '#090d16',
    borderBottom: '1px solid #1e293b',
  },
  micBtn: {
    color: '#fff',
    border: 'none',
    padding: '10px 18px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '13px',
  },
  codexContainer: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  codexLeft: {
    width: '320px',
    padding: '16px',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#090d16',
  },
  codexRight: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  codexToolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  codeBlock: {
    flex: 1,
    margin: 0,
    padding: '16px',
    overflow: 'auto',
    backgroundColor: '#0b1120',
    color: '#e2e8f0',
    fontSize: '13px',
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    lineHeight: 1.5,
  },
  chessContainer: {
    display: 'flex',
    flex: 1,
    padding: '20px',
    gap: '24px',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
  },
  chessBoardWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  chessStatusBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 500,
  },
  chessBoard: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 56px)',
    gridTemplateRows: 'repeat(8, 56px)',
    border: '3px solid #334155',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  chessSquare: {
    width: '56px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '36px',
    cursor: 'pointer',
    position: 'relative',
    userSelect: 'none',
  },
  legalDot: {
    position: 'absolute',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: 'rgba(34, 197, 94, 0.65)',
    pointerEvents: 'none',
  },
  chessSidebar: {
    width: '220px',
    height: '490px',
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
  },
  moveList: {
    flex: 1,
    overflowY: 'auto',
  },
  imageContainer: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
  },
  imageControls: {
    display: 'flex',
    gap: '10px',
    padding: '14px 20px',
    backgroundColor: '#090d16',
    borderBottom: '1px solid #1e293b',
  },
  imageGallery: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px',
    alignContent: 'start',
  },
  imageCard: {
    backgroundColor: '#1e293b',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '1px solid #334155',
  },
  generatedImg: {
    width: '100%',
    display: 'block',
  },
  imageCardFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
  },
}
