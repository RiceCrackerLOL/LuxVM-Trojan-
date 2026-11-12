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

type ProviderType = 'auto' | 'openai' | 'openrouter' | 'xai' | 'custom'

const SESSIONS_KEY = 'luxvm_sessions_v3'
const ACTIVE_SESSION_KEY = 'luxvm_active_id_v3'
const SETTINGS_KEY = 'luxvm_settings_v3'

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
            content: 'Welcome to LuxVM Desktop. Paste your API key in Settings—endpoints and models will configure automatically!',
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
    provider: 'auto' as ProviderType,
    apiKey: '',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    modelName: 'gpt-4o-mini',
  })

  const [provider, setProvider] = useState<ProviderType>(initialSettings.provider || 'auto')
  const [apiKey, setApiKey] = useState(initialSettings.apiKey || '')
  const [apiEndpoint, setApiEndpoint] = useState(initialSettings.apiEndpoint || 'https://api.openai.com/v1/chat/completions')
  const [modelName, setModelName] = useState(initialSettings.modelName || 'gpt-4o-mini')

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

  // Smart Auto-detection based on API key prefix if provider is 'auto'
  const handleApiKeyChange = (newKey: string) => {
    setApiKey(newKey)
    if (provider === 'auto') {
      const trimmed = newKey.trim()
      if (trimmed.startsWith('sk-or-')) {
        setApiEndpoint('https://openrouter.ai/api/v1/chat/completions')
        setModelName('openai/gpt-4o-mini')
      } else if (trimmed.startsWith('grok_')) {
        setApiEndpoint('https://api.x.ai/v1/chat/completions')
        setModelName('grok-beta')
      } else if (trimmed.startsWith('sk-')) {
        setApiEndpoint('https://api.openai.com/v1/chat/completions')
        setModelName('gpt-4o-mini')
      }
    }
  }

  const handleProviderChange = (newProvider: ProviderType) => {
    setProvider(newProvider)
    if (newProvider === 'openai') {
      setApiEndpoint('https://api.openai.com/v1/chat/completions')
      setModelName('gpt-4o-mini')
    } else if (newProvider === 'openrouter') {
      setApiEndpoint('https://openrouter.ai/api/v1/chat/completions')
      setModelName('openai/gpt-4o-mini')
    } else if (newProvider === 'xai') {
      setApiEndpoint('https://api.x.ai/v1/chat/completions')
      setModelName('grok-beta')
    }
  }

  const saveSettings = () => {
    safeSetStorage(SETTINGS_KEY, {
      provider,
      apiKey: apiKey.trim(),
      apiEndpoint: apiEndpoint.trim(),
      modelName: modelName.trim(),
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
          content: 'Started a new session. How can I help you today?',
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
      currentSession.title === 'New Chat' ? trimmed.slice(0, 30) + (trimmed.length > 30 ? '...' : '') : currentSession.title

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
          content: `[Offline Echo Mode] You said: "${trimmed}"\n\nOpen ⚙️ Settings to enter your API key.`,
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

      const outboundMessages = updatedMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }))

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      }

      // Add OpenRouter specific optional rankings headers if applicable
      if (provider === 'openrouter' || apiEndpoint.includes('openrouter.ai')) {
        headers['HTTP-Referer'] = 'https://luxvm.desktop'
        headers['X-Title'] = 'LuxVM Desktop'
      }

      const response = await fetch(apiEndpoint.trim(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelName.trim(),
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
            <span style={styles.badge}>Desktop v1.2</span>
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
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>AI Provider & Key Configuration</h3>
            
            <div style={styles.fieldRow}>
              <label style={styles.label}>Provider Selection</label>
              <select
                style={styles.select}
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
              >
                <option value="auto">Auto-Detect from API Key (Recommended)</option>
                <option value="openrouter">OpenRouter</option>
                <option value="openai">OpenAI</option>
                <option value="xai">xAI (Grok)</option>
                <option value="custom">Custom URL</option>
              </select>
            </div>

            <div style={styles.fieldRow}>
              <label style={styles.label}>API Key (Just paste your key here)</label>
              <input
                style={styles.input}
                type="password"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="sk-or-... or grok_... or sk-..."
              />
            </div>

            {(provider === 'custom' || provider !== 'auto') && (
              <div style={styles.fieldRow}>
                <label style={styles.label}>API Endpoint URL (Auto-filled)</label>
                <input
                  style={styles.input}
                  value={apiEndpoint}
                  onChange={(e) => setApiEndpoint(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}

            <div style={styles.fieldRow}>
              <label style={styles.label}>Model Name</label>
              <input
                style={styles.input}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="openai/gpt-4o-mini or grok-beta"
              />
            </div>

            <button type="button" onClick={saveSettings} style={styles.primaryBtn}>
              Save Configuration
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
  select: {
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
