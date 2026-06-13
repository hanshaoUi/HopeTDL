import { computed, h } from 'vue'
import { createDiscreteApi, darkTheme } from 'naive-ui'
import { appState } from '../state'

export const themeOverrides = {
  common: {
    primaryColor: '#6aa7ff',
    primaryColorHover: '#83b7ff',
    primaryColorPressed: '#4f8ee8',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  }
}

export const naiveTheme = computed(() => appState.theme === 'dark' ? darkTheme : null)

const configProviderProps = computed(() => ({
  theme: naiveTheme.value,
  themeOverrides
}))

export const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  configProviderProps
})

export function confirmHtml(html, title, options = {}) {
  const dialogType = options.type === 'error' ? 'error' : options.type === 'success' ? 'success' : 'warning'
  return new Promise((resolve, reject) => {
    dialog[dialogType]({
      title,
      content: () => h('div', { class: 'dialog-html', innerHTML: html }),
      positiveText: options.confirmButtonText || '确定',
      negativeText: options.cancelButtonText || '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => reject(new Error('cancel')),
      onClose: () => reject(new Error('cancel'))
    })
  })
}
