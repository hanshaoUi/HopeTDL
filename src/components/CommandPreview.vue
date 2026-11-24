<script setup>
import { inject, onUnmounted, watch } from 'vue'
const props = defineProps({ command: { type: String, required: true } })
const preview = inject('workbenchPreview', null)
const owner = Symbol('command')
watch(() => props.command, value => preview?.setCommand(owner, value), { immediate: true })
onUnmounted(() => preview?.clearCommand(owner))
</script>
<template>
  <div v-if="!preview"><div class="card-title">命令预览</div><div class="command-preview">{{ command }}</div></div>
</template>
