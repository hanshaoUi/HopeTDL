// Synchronous reads for existing Vue forms, with writes persisted by Rust.
// The WebView's localStorage is only a compatibility cache, not the task store.
const cache = new Map()
let native = false
export function hydrateStorage(snapshot) {
  native = true
  cache.clear()
  for (const [key, value] of Object.entries(snapshot.preferences || {})) cache.set(key, value)
  cache.set('hopetdl.tasks.v1', JSON.stringify(snapshot.tasks || []))
  cache.set('hopetdl.schedules.v1', JSON.stringify(snapshot.schedules || []))
}
export default {
  getItem(key) { return native ? (cache.get(key) ?? null) : globalThis.localStorage.getItem(key) },
  setItem(key, value) {
    if (!native) return globalThis.localStorage.setItem(key, value)
    cache.set(key, String(value))
    window.tdlApi.setPreference(key, String(value)).catch(error => window.tdlApi.reportError(error))
  },
  removeItem(key) {
    if (!native) return globalThis.localStorage.removeItem(key)
    cache.delete(key)
    window.tdlApi.setPreference(key, null).catch(error => window.tdlApi.reportError(error))
  }
}
