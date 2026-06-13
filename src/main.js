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
import App from './App.vue'

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

app.mount('#app')
