// Bench-only preload: stands in for src/preload/index.ts so overlay.html mounts
// with no main process behind it. Loaded with contextIsolation off, so the
// Proxy below is the page's window.zanban.
const arg = process.argv.find((a) => a.startsWith('--bench-config='))
const config = JSON.parse(
  Buffer.from(arg.slice('--bench-config='.length), 'base64').toString('utf8')
)

const listeners = new Map()
const bench = { lastAsk: null, height: 0, settings: config.settings }

function defaults(path, args) {
  switch (path) {
    case 'getVersion':
      return '0.0.0-bench'
    case 'openExternal':
      return false
    case 'settings.get':
      return bench.settings
    case 'settings.set':
      bench.settings = { ...bench.settings, ...args[0] }
      return bench.settings
    case 'settings.hotkeyConflicts':
      return []
    case 'settings.pickFreeHotkeys':
      return { assigned: [], unresolved: [] }
    case 'overlay.getStealth':
      return true
    case 'overlay.setStealth':
      return args[0]
    case 'overlay.setContentHeight':
      bench.height = args[0]
      return undefined
    case 'ai.ask':
      bench.lastAsk = args[0]
      return { requestId: args[0].requestId }
    case 'ai.followUps':
      return []
    case 'transcription.speechModel':
      return { installed: true, missingBytes: 0 }
    case 'session.start':
      return { sessionId: 'bench' }
    case 'ollama.health':
      return { running: false, host: '', models: [] }
    case 'documents.list':
    case 'personas.list':
    case 'sessions.list':
      return []
    case 'rag.count':
      return 0
    default:
      return undefined
  }
}

function node(path) {
  const target = function () {}
  return new Proxy(target, {
    get(_t, key) {
      if (typeof key !== 'string') return undefined
      return node(path ? `${path}.${key}` : key)
    },
    apply(_t, _this, args) {
      const name = path.split('.').pop()
      if (/^on[A-Z]/.test(name)) {
        const set = listeners.get(path) ?? new Set()
        listeners.set(path, set)
        set.add(args[0])
        return () => set.delete(args[0])
      }
      return Promise.resolve(defaults(path, args))
    }
  })
}

bench.emit = (path, payload) => {
  for (const cb of listeners.get(path) ?? []) cb(payload)
}
bench.emitMany = (path, payloads) => {
  for (const p of payloads) bench.emit(path, p)
}
bench.has = (path) => (listeners.get(path)?.size ?? 0) > 0

window.zanban = node('')
window.__bench = bench
