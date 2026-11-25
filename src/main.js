import { createApp } from 'vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NConfigProvider,
  NDialogProvider,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NMessageProvider,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
  NTabPane,
  NTable,
  NTabs,
  NTag
} from 'naive-ui'
import './style.css'
import './v2.css'
import { initializeDesktop } from './desktop'

async function bootstrap() {
await initializeDesktop()
const { appendLog } = await import('./logStore')
const { installTheme } = await import('./theme')
installTheme()
const { default: App } = await import('./App.vue')
const app = createApp(App)

const naiveComponents = [
  ['NAlert', NAlert],
  ['NButton', NButton],
  ['NCheckbox', NCheckbox],
  ['NConfigProvider', NConfigProvider],
  ['NDialogProvider', NDialogProvider],
  ['NForm', NForm],
  ['NFormItem', NFormItem],
  ['NInput', NInput],
  ['NInputNumber', NInputNumber],
  ['NMessageProvider', NMessageProvider],
  ['NProgress', NProgress],
  ['NRadioButton', NRadioButton],
  ['NRadioGroup', NRadioGroup],
  ['NSelect', NSelect],
  ['NSwitch', NSwitch],
  ['NTabPane', NTabPane],
  ['NTable', NTable],
  ['NTabs', NTabs],
  ['NTag', NTag]
]

for (const [name, component] of naiveComponents) {
  app.component(name, component)
}

const reportError=error=>{ console.error(error); appendLog({taskId:'app',level:'error',text:`[界面异常] ${error?.message||error}\n`}) }
app.config.errorHandler=reportError
window.addEventListener('unhandledrejection',event=>reportError(event.reason))
window.addEventListener('error',event=>reportError(event.error||event.message))
app.mount('#app')
}
bootstrap().catch(error => {
  console.error(error)
  document.getElementById('app').textContent = `HopeTDL 启动失败：${error}`
})
