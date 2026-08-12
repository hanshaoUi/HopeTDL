import { watch } from 'vue'
import { appState } from './state'

/**
 * 消费一条「套用」过来的历史记录。
 *
 * 套用的做法是：历史面板把记录塞进 appState.selectedXxxRecord，再切到表单页。
 * 各表单原来在 onMounted 里取这个字段，但顶层视图是被 KeepAlive 缓存的：
 * 表单实例如果已经存在（比如「新建任务」当前正好就停在同一个任务类型上），
 * onMounted 不会再触发，记录就没人消费——表现为「套用有时管用、有时点了没反应」。
 *
 * 改成监听字段本身，取到就立刻消费并清空，跟组件是新建还是复用无关。
 *
 * @param {string} field appState 上的字段名，例如 'selectedForwardRecord'
 * @param {(record: object) => void} apply 把记录填进表单
 */
export function useAppliedRecord(field, apply) {
  watch(
    () => appState[field],
    record => {
      if (!record) return
      // 先清空再填充：避免 apply 里再触发这个 watch 造成重入。
      appState[field] = null
      apply(record)
    },
    { immediate: true }
  )
}

/**
 * 消费从对话列表带过来的「选中对话」。
 * 同样存在上面的挂载时机问题。
 *
 * @param {(row: object) => void} apply
 */
export function useSelectedChat(apply) {
  watch(
    () => appState.selectedChat,
    row => {
      if (!row) return
      appState.selectedChat = null
      apply(row)
    },
    { immediate: true }
  )
}
