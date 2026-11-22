import { inject, onUnmounted, watch } from 'vue'

// The form owns its spec; the workbench only observes it for live previews.
export function useWorkbenchPreview(spec, execution = {}) {
  const preview = inject('workbenchPreview', null)
  if (!preview) return
  const owner = Symbol('form')
  watch(spec, value => preview.setSpec(owner, value, execution), { immediate: true, deep: true })
  onUnmounted(() => preview.clearSpec(owner))
  return preview
}
