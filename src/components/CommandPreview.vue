<script setup>
import { message } from '../ui/naive'
import { inject, onUnmounted, watch } from 'vue'
const props = defineProps({ command: { type: String, required: true } })
const preview = inject('workbenchPreview', null)
const owner = Symbol('command')
async function copy(){try{await navigator.clipboard.writeText(props.command);message.success('命令已复制')}catch(error){message.error(String(error))}}
watch(() => props.command, value => preview?.setCommand(owner, value), { immediate: true })
onUnmounted(() => preview?.clearCommand(owner))
</script>
<template>
  <div v-if="!preview"><div class="card-title">命令预览 <button class="btn sm ghost" @click="copy">复制</button></div><div class="command-preview">{{ command }}</div></div>
</template>
