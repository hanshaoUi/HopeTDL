import { computed, ref, watch } from 'vue'
import { appState } from './state'
import storage from './storage'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(media.matches)
export const resolvedTheme = computed(() =>
  appState.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : appState.theme)

export function installTheme() {
  watch(resolvedTheme, value => {
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value
  }, { immediate: true, flush: 'sync' })
  watch(() => appState.theme, value => storage.setItem('theme', value), { flush: 'sync' })
  const update = event => { systemDark.value = event.matches }
  media.addEventListener('change', update)
  return () => media.removeEventListener('change', update)
}
