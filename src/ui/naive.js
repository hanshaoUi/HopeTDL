import { computed, h } from 'vue'
import { createDiscreteApi, darkTheme } from 'naive-ui'
import { resolvedTheme } from '../theme'

export const themeOverrides = computed(() => {
  const dark = resolvedTheme.value === 'dark'
  const blue = dark ? '#5b9ef8' : '#3d8ef0'
  return {common: {
    primaryColor:blue,primaryColorHover:dark?'#7ab1fb':'#62a5f5',primaryColorPressed:dark?'#4287df':'#2878d5',
    bodyColor:dark?'#0d0f14':'#f3f5f9',baseColor:dark?'#141720':'#ffffff',
    cardColor:dark?'#141720':'#ffffff',modalColor:dark?'#141720':'#ffffff',popoverColor:dark?'#1a1e2a':'#ffffff',
    inputColor:dark?'#1a1e2a':'#f0f2f7',borderColor:dark?'#252a38':'#dcdfe6',
    textColor1:dark?'#eef1f8':'#2e3445',textColor2:dark?'#d7ddea':'#46516b',textColor3:dark?'#8a93a8':'#6c7a96',
    borderRadius:'6px',borderRadiusSmall:'6px',heightSmall:'32px',fontSizeSmall:'12px',
    fontFamily:'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  }}
})

export const naiveTheme = computed(() => resolvedTheme.value === 'dark' ? darkTheme : null)

const configProviderProps = computed(() => ({
  theme: naiveTheme.value,
  themeOverrides: themeOverrides.value
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
