import { specKey } from '../../shared/specKey.mjs'
import { appState } from '../state'
import { inject, onUnmounted, watch, computed } from 'vue'

// The form owns its spec; the workbench only observes it for live previews.
export function useWorkbenchPreview(spec, execution = {}) {
  const preview = inject('workbenchPreview', null)
  if (!preview) return
  if(!execution.status) {
    const task=computed(()=>appState.tasks.find(t=>t.spec && specKey(t.spec)===specKey(spec.value)))
    execution={status:computed(()=>({success:'done',failed:'error',partial:'error',interrupted:'error',stopped:'stopped',queued:'queued',running:'running'})[task.value?.state]||'idle'),progress:computed(()=>task.value?.progress)}
  }
  const owner = Symbol('form')
  watch(spec, value => preview.setSpec(owner, { ...value }, execution), { immediate: true, deep: true })
  onUnmounted(() => preview.clearSpec(owner))
  return preview
}
