import React, { useState, useEffect, useRef } from 'react'

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

const SESSIONS_KEY = 'luxvm_sessions_v7'
const ACTIVE_SESSION_KEY = 'luxvm_active_id_v7'
const SETTINGS_KEY = 'luxvm_settings_v7'

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

export default function App() {
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
            content: 'Welcome to LuxVM Desktop. Just paste your API key in Settings—everything configures automatically!',
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

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const initialSettings = safeGetStorage(SETTINGS_KEY, {
    apiKey: '',
    systemPrompt: 'You are LuxVM, a helpful, precise, and direct AI desktop assistant.',
  })

  const [apiKey, setApiKey] = useState(initialSettings.apiKey || '')
  const [systemPrompt, setSystemPrompt] = useState(
    initialSettings.systemPrompt || 'You are LuxVM, a helpful, precise, and direct AI desktop assistant.'
  )

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const currentSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]

  useEffect(() => {
    safeSetStorage(SESSIONS_KEY, sessions)
  }, [sessions])

  useEffect(() => {
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentSession?.messages, isLoading])

  // Automatically maps key prefixes to the correct endpoint and active model
  const resolveConfigByKey = (key: string) => {
    const trimmed = key.trim()
    if (trimmed.startsWith('gsk_')) {
      return {
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'openai/gpt-oss-20b',
      }
    } else if (trimmed.startsWith('sk-or-')) {
      return {
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        model: 'openai/gpt-4o-mini',
      }
    } else if (trimmed.startsWith('xai-') || trimmed.startsWith('grok_')) {
      return {
        endpoint: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-2-latest',
      }
    } else {
      return {
        endpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
      }
    }
  }

  const saveSettings = () => {
    safeSetStorage(SETTINGS_KEY, {
      apiKey: apiKey.trim(),
      systemPrompt: systemPrompt.trim(),
    })
    setShowSettings(false)
  }

  const createNewChat = () => {
    const newSession: ChatSession = {
      id: String(Date.now()),
      title: 'New Chat',
      messages: [
        {
          id: 'welcome-new',
          role: 'assistant',
          content: 'Started a new session using your API key and behavior memory.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ],
      updatedAt: Date.now(),
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
  }

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (sessions.length <= 1) {
      createNewChat()
    }
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id)
      if (remaining.length > 0) setActiveSessionId(remaining[0].id)
    }
  }

  const sendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMsg: Message = {
      id: String(Date.now()),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    const updatedMessages = [...currentSession.messages, userMsg]
    const derivedTitle =
      currentSession.title === 'New Chat'
        ? trimmed.slice(0, 30) + (trimmed.length > 30 ? '...' : '')
        : currentSession.title

    setSessions((prev) =>
      prev.map((s) =>
        s.id === currentSession.id
          ? { ...s, title: derivedTitle, messages: updatedMessages, updatedAt: Date.now() }
          : s
      )
    )
    setInput('')
    setIsLoading(true)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    try {
      if (!apiKey.trim()) {
        await new Promise((r) => setTimeout(r, 300))
        const assistantMsg: Message = {
          id: String(Date.now() + 1),
          role: 'assistant',
          content: `[Offline Echo Mode] You said: "${trimmed}"\n\nOpen ⚙️ Settings to paste your API key.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === currentSession.id
              ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: Date.now() }
              : s
          )
        )
        return
      }

      const config = resolveConfigByKey(apiKey)

      const outboundMessages = [
        ...(systemPrompt.trim()
          ? [{ role: 'system' as const, content: systemPrompt.trim() }]
          : []),
        ...updatedMessages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content })),
      ]

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      }

      if (apiKey.trim().startsWith('sk-or-')) {
        headers['HTTP-Referer'] = 'https://luxvm.desktop'
        headers['X-Title'] = 'LuxVM Desktop'
      }

      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          messages: outboundMessages,
        }),
        signal: controller.signal,
      })

      const rawText = await response.text()
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 200)}`)
      }

      let data: any
      try {
        data = JSON.parse(rawText)
      } catch {
        throw new Error('Server returned invalid JSON.')
      }

      const replyContent =
        data?.choices?.[0]?.message?.content || 'Received an empty response from the API.'

      const assistantMsg: Message = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: replyContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSession.id
            ? { ...s, messages: [...s.messages, assistantMsg], updatedAt: Date.now() }
            : s
        )
      )
    } catch (err: any) {
      const errorMessage =
        err?.name === 'AbortError'
          ? 'Request timed out after 30 seconds.'
          : err?.message || 'Unknown network error'

      const systemMsg: Message = {
        id: String(Date.now() + 1),
        role: 'system',
        content: `Request failed safely: ${errorMessage}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === currentSession.id
            ? { ...s, messages: [...s.messages, systemMsg], updatedAt: Date.now() }
            : s
        )
      )
    } finally {
      clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  return (
    <div style={styles.appContainer}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <button type="button" onClick={createNewChat} style={styles.newChatBtn}>
            + New Chat
          </button>
        </div>
        <div style={styles.sessionList}>
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              style={{
                ...styles.sessionItem,
                backgroundColor: session.id === activeSessionId ? '#334155' : 'transparent',
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

      <div style={styles.mainContent}>
        <header style={styles.header}>
          <div style={styles.brand}>
            <span style={styles.dot} />
            <strong>LuxVM</strong>
            <span style={styles.badge}>Pure API Key Mode</span>
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

        {showSettings && (
          <div style={styles.settingsPanel}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>
              API Key & Behavior Memory
            </h3>

            <div style={styles.fieldRow}>
              <label style={styles.label}>API Key (Just paste it here — no models or URLs needed)</label>
              <input
                style={styles.input}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste any key (gsk_..., sk-or-..., xai-..., sk-...)"
              />
            </div>

            <div style={styles.fieldRow}>
              <label style={styles.label}>Permanent Behavior Memory (Applies globally)</label>
              <textarea
                style={{ ...styles.input, height: '72px', resize: 'vertical', fontFamily: 'inherit' }}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Tell LuxVM how to act across all chats..."
              />
            </div>

            <button type="button" onClick={saveSettings} style={styles.primaryBtn}>
              Save Settings
            </button>
          </div>
        )}

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
          {isLoading && (
            <div style={styles.messageRow}>
              <div style={{ ...styles.bubble, backgroundColor: '#1e293b', opacity: 0.8 }}>
                Thinking...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </main>

        <form
          onSubmit={sendMessage}
          style={styles.footer}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              sendMessage()
            }
          }}
        >
          <input
            style={styles.chatInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message to LuxVM... (Ctrl+Enter to send)"
            disabled={isLoading}
          />
          <button type="submit" style={styles.sendBtn} disabled={isLoading || !input.trim()}>
            Send
          </button>
        </form>
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
    width: '260px',
    backgroundColor: '#090d16',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarHeader: {
    padding: '14px',
    borderBottom: '1px solid #1e293b',
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
    fontSize: '13px',
  },
  sessionList: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sessionItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
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
    fontSize: '16px',
    padding: '0 4px',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '18px',
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#22c55e',
  },
  badge: {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '12px',
    backgroundColor: '#334155',
    color: '#94a3b8',
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
  settingsPanel: {
    padding: '16px 20px',
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  fieldRow: {
    marginBottom: '10px',
  },
  label: {
    display: 'block',
    fontSize: '12px',
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
}
