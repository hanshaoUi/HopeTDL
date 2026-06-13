<script setup>
import { reactive, ref, watchEffect } from 'vue'
import { message } from '../ui/naive'
import { appState } from '../state'
import { loadChatCache } from '../chatCache'

const form = reactive({})
const envLoading = ref(false)
const envResult = ref(null)
const chatCacheDayOptions = [
  { label: '1 天', value: 1 },
  { label: '7 天 / 一周', value: 7 },
  { label: '30 天 / 一个月', value: 30 }
]
watchEffect(() => Object.assign(form, appState.config))

async function save() {
  appState.config = await window.tdlApi.setConfig({ ...form })
  try {
    await loadChatCache({ ensure: true })
  } catch (err) {
    message.warning('设置已保存，但读取对话缓存失败：' + (err?.message || err))
    return
  }
  message.success('设置已保存')
}

async function pickDir() {
  const dir = await window.tdlApi.openDirectory({ defaultPath: form.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir() })
  if (dir) form.defaultDownloadDir = dir
}

async function resetOutputDir() {
  form.defaultDownloadDir = await window.tdlApi.getDefaultOutputDir()
  message.success('已恢复为项目 output 目录')
}

async function refreshChatCache() {
  await loadChatCache({ refresh: true })
  message.success('对话缓存已更新')
}

async function openOutputDir() {
  const dir = form.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir()
  const result = await window.tdlApi.openPath(dir)
  if (result && !result.ok) message.error(result.message || '打开失败')
}

async function checkEnvironment() {
  envLoading.value = true
  try {
    envResult.value = await window.tdlApi.checkEnvironment()
    if (envResult.value?.ok) message.success('环境检查通过')
    else message.warning('环境检查发现需要处理的项目')
  } catch (err) {
    message.error('环境检查失败：' + (err?.message || err))
  } finally {
    envLoading.value = false
  }
}
</script>

<template>
  <h1 class="page-title">设置</h1>
  <p class="page-desc">配置会自动应用到导出、转发、上传等任务。现在按基础、性能、缓存、界面分组。</p>

  <n-form label-width="130px">
    <div class="section-card">
      <div class="section-title">基础设置</div>
      <div class="grid-2">
        <n-form-item label="tdl 路径"><n-input v-model:value="form.tdlPath" placeholder="tdl" /></n-form-item>
        <n-form-item label="命名空间 ns"><n-input v-model:value="form.ns" placeholder="hope" /></n-form-item>
        <n-form-item label="代理"><n-input v-model:value="form.proxy" placeholder="socks5://127.0.0.1:7890" /></n-form-item>
        <n-form-item label="默认输出目录">
          <div style="display:flex; gap:10px; align-items:center; width:100%">
            <n-input v-model:value="form.defaultDownloadDir" placeholder="默认使用项目根目录 output" style="flex:1" />
            <n-button @click="pickDir">选择</n-button>
          </div>
        </n-form-item>
      </div>
      <div class="action-row" style="margin-left:130px;">
        <n-button @click="resetOutputDir">恢复 output 目录</n-button>
        <n-button @click="openOutputDir">打开输出目录</n-button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">环境自检</div>
      <div class="env-check-grid" v-if="envResult">
        <div v-for="item in envResult.checks" :key="item.key" class="env-check-item" :class="{ ok: item.ok, fail: !item.ok }">
          <n-tag :type="item.ok ? 'success' : 'error'" size="small">{{ item.ok ? '正常' : '需处理' }}</n-tag>
          <div>
            <div class="status-main">{{ item.label }}</div>
            <div class="status-sub">{{ item.detail || item.meta || '-' }}</div>
          </div>
        </div>
      </div>
      <div v-else class="mini-muted">检查 tdl 是否可执行、输出目录是否可写，以及 ns / 代理配置是否完整。</div>
      <div class="action-row section-actions">
        <n-button :loading="envLoading" @click="checkEnvironment">开始环境检查</n-button>
        <span v-if="envResult" class="mini-muted">上次检查：{{ envResult.checkedAt }}</span>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">性能设置</div>
      <div class="grid-2">
        <n-form-item label="并发 limit"><n-input-number v-model:value="form.limit" :min="1" :max="20" /></n-form-item>
        <n-form-item label="线程 threads"><n-input-number v-model:value="form.threads" :min="1" :max="32" /></n-form-item>
        <n-form-item label="延迟"><n-input v-model:value="form.delay" placeholder="例如 2s，可为空" /></n-form-item>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">缓存设置</div>
      <div class="grid-2">
        <n-form-item label="对话缓存周期">
          <n-select v-model:value="form.chatCacheDays" :options="chatCacheDayOptions" placeholder="自动刷新周期" />
        </n-form-item>
        <n-form-item label="缓存状态">
          <div class="mini-muted">
            {{ appState.chatCacheMeta?.count || 0 }} 条，更新时间：{{ appState.chatCacheMeta?.updatedAtText || '暂无' }}
          </div>
        </n-form-item>
      </div>
      <div class="action-row" style="margin-left:130px;">
        <n-button :loading="appState.chatCacheLoading" @click="refreshChatCache">手动更新对话缓存</n-button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">界面设置</div>
      <div class="grid-2">
        <n-form-item label="主题">
          <n-radio-group v-model:value="appState.theme">
            <n-radio-button value="dark">深色</n-radio-button>
            <n-radio-button value="light">浅色</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="任务日志">
          <n-switch v-model:value="appState.showLog" active-text="默认展开" inactive-text="收起" />
        </n-form-item>
      </div>
    </div>

    <div class="action-row">
      <n-button type="primary" @click="save">保存设置</n-button>
    </div>
  </n-form>
</template>
