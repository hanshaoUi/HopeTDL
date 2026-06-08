<script setup>
import { reactive, watchEffect } from 'vue'
import { ElMessage } from 'element-plus'
import { appState } from '../main'
import { loadChatCache } from '../chatCache'

const form = reactive({})
watchEffect(() => Object.assign(form, appState.config))

async function save() {
  appState.config = await window.tdlApi.setConfig({ ...form })
  try {
    await loadChatCache({ ensure: true })
  } catch (err) {
    ElMessage.warning('设置已保存，但读取对话缓存失败：' + (err?.message || err))
    return
  }
  ElMessage.success('设置已保存')
}

async function pickDir() {
  const dir = await window.tdlApi.openDirectory({ defaultPath: form.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir() })
  if (dir) form.defaultDownloadDir = dir
}

async function resetOutputDir() {
  form.defaultDownloadDir = await window.tdlApi.getDefaultOutputDir()
  ElMessage.success('已恢复为项目 output 目录')
}

async function refreshChatCache() {
  await loadChatCache({ refresh: true })
  ElMessage.success('对话缓存已更新')
}

async function openOutputDir() {
  const dir = form.defaultDownloadDir || await window.tdlApi.getDefaultOutputDir()
  const result = await window.tdlApi.openPath(dir)
  if (result && !result.ok) ElMessage.error(result.message || '打开失败')
}
</script>

<template>
  <h1 class="page-title">设置</h1>
  <p class="page-desc">配置会自动应用到导出、转发、上传等任务。现在按基础、性能、缓存、界面分组。</p>

  <el-form label-width="130px">
    <div class="section-card">
      <div class="section-title">基础设置</div>
      <div class="grid-2">
        <el-form-item label="tdl 路径"><el-input v-model="form.tdlPath" placeholder="tdl" /></el-form-item>
        <el-form-item label="命名空间 ns"><el-input v-model="form.ns" placeholder="hope" /></el-form-item>
        <el-form-item label="代理"><el-input v-model="form.proxy" placeholder="socks5://127.0.0.1:7890" /></el-form-item>
        <el-form-item label="默认输出目录">
          <div style="display:flex; gap:10px; align-items:center; width:100%">
            <el-input v-model="form.defaultDownloadDir" placeholder="默认使用项目根目录 output" style="flex:1" />
            <el-button @click="pickDir">选择</el-button>
          </div>
        </el-form-item>
      </div>
      <div class="action-row" style="margin-left:130px;">
        <el-button @click="resetOutputDir">恢复 output 目录</el-button>
        <el-button @click="openOutputDir">打开输出目录</el-button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">性能设置</div>
      <div class="grid-2">
        <el-form-item label="并发 limit"><el-input-number v-model="form.limit" :min="1" :max="20" /></el-form-item>
        <el-form-item label="线程 threads"><el-input-number v-model="form.threads" :min="1" :max="32" /></el-form-item>
        <el-form-item label="延迟"><el-input v-model="form.delay" placeholder="例如 2s，可为空" /></el-form-item>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">缓存设置</div>
      <div class="grid-2">
        <el-form-item label="对话缓存周期">
          <el-select v-model="form.chatCacheDays" placeholder="自动刷新周期">
            <el-option label="1 天" :value="1" />
            <el-option label="7 天 / 一周" :value="7" />
            <el-option label="30 天 / 一个月" :value="30" />
          </el-select>
        </el-form-item>
        <el-form-item label="缓存状态">
          <div class="mini-muted">
            {{ appState.chatCacheMeta?.count || 0 }} 条，更新时间：{{ appState.chatCacheMeta?.updatedAtText || '暂无' }}
          </div>
        </el-form-item>
      </div>
      <div class="action-row" style="margin-left:130px;">
        <el-button :loading="appState.chatCacheLoading" @click="refreshChatCache">手动更新对话缓存</el-button>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">界面设置</div>
      <div class="grid-2">
        <el-form-item label="主题">
          <el-radio-group v-model="appState.theme">
            <el-radio-button label="dark">深色</el-radio-button>
            <el-radio-button label="light">浅色</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="任务日志">
          <el-switch v-model="appState.showLog" active-text="默认展开" inactive-text="收起" />
        </el-form-item>
      </div>
    </div>

    <div class="action-row">
      <el-button type="primary" @click="save">保存设置</el-button>
    </div>
  </el-form>
</template>
