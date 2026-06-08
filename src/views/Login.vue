<script setup>
import { ref, computed } from 'vue'
import { commandText, runTask } from '../utils'
import CommandPreview from '../components/CommandPreview.vue'
const type = ref('qr')
const args = computed(() => ['login', '-T', type.value])
function run() { runTask('login', args.value, `登录：${type.value}`) }
</script>
<template>
  <h1 class="page-title">登录账号</h1>
  <p class="page-desc">二维码登录、验证码登录、Telegram Desktop 导入都可以从这里启动。</p>
  <div class="card">
    <el-radio-group v-model="type">
      <el-radio-button label="qr">二维码登录</el-radio-button>
      <el-radio-button label="code">手机号验证码</el-radio-button>
      <el-radio-button label="desktop">Desktop 导入</el-radio-button>
    </el-radio-group>
    <div style="height:16px"></div>
    <CommandPreview :command="commandText(args)" />
    <div style="height:16px"></div>
    <el-button type="primary" @click="run">开始登录</el-button>
  </div>
</template>
