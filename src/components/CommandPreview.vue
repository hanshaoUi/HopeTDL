<script setup>
defineProps({ command: { type: String, required: true } })
</script>
<template>
  <div>
    <div class="card-title">命令预览</div>
    <div class="command-preview">{{ command }}</div>
  </div>
</template>
