<script setup>
import { reactive, ref, watchEffect } from 'vue'
import { message } from '../ui/naive'
import { appState } from '../state'
import { loadChatCache } from '../chatCache'
const desktopApi = window.tdlApi

const form = reactive({
  forwardFilterEnabled: false,
  filterKeywordsText: '',
  filterKeywordAction: 'drop-message',
  filterKeywordReplacement: '',
  removeLinks: false,
  blockImages: false,
  blockVideos: false,
  blockTextOnly: false,
  keywordCaseSensitive: false,
  keywordRegexMode: false
})
const envLoading = ref(false)
const envResult = ref(null)
const chatCacheDayOptions = [
  { label: '1 天', value: 1 },
  { label: '7 天 / 一周', value: 7 },
  { label: '30 天 / 一个月', value: 30 }
]
const keywordActionOptions = [
  { label: '屏蔽整条消息', value: 'drop-message' },
  { label: '只删除命中的行', value: 'remove-segment' },
  { label: '替换命中内容', value: 'replace' }
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

async function exportMigration() {
  try {
    const localStorageData = Object.fromEntries(Object.keys(globalThis.localStorage)
      .filter(key => key.startsWith('hopetdl.') || ['theme', 'showLog'].includes(key))
      .map(key => [key, globalThis.localStorage.getItem(key)]))
    const result = await window.tdlApi.exportMigration(localStorageData)
    if (result?.ok) message.success('备份已导出')
  } catch (error) { message.error(String(error)) }
}
async function importMigration() {
  try {
    const result = await window.tdlApi.importMigration()
    if (result?.ok) {
      appState.config = await window.tdlApi.getConfig()
      message.success(result.message)
    }
  } catch (error) { message.error(String(error)) }
}
</script>

<template>
  <h1 class="page-title">设置</h1>
  <p class="page-desc">配置会自动应用到导出、转发、上传等任务。现在按基础、性能、缓存、界面分组。</p>

  <n-form label-width="110px" size="small" class="v2-settings-grid">
    <div class="section-card">
      <div class="section-title">主题与外观</div>
      <p class="mini-muted appearance-help">立即生效并自动保存，无需点击底部的保存按钮。</p>
      <div class="grid-2">
        <n-form-item label="主题">
          <n-radio-group v-model:value="appState.theme" aria-label="主题模式">
            <n-radio-button value="system">跟随系统</n-radio-button>
            <n-radio-button value="dark">深色</n-radio-button>
            <n-radio-button value="light">浅色</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="任务日志">
          <n-switch v-model:value="appState.showLog" aria-label="任务日志默认展开" />
          <span class="mini-muted" style="margin-left:10px">{{ appState.showLog ? '默认展开' : '默认收起' }}</span>
        </n-form-item>
      </div>
    </div>

    <div v-if="desktopApi?.exportMigration" class="section-card">
      <div class="section-title">数据备份与迁移</div>
      <div class="mini-muted">旧版先导出迁移文件，再在 Rust 版导入。导入前自动备份现有数据，导入后的定时计划保持暂停。</div>
      <div class="action-row section-actions">
        <n-button @click="exportMigration">导出备份 / 迁移文件</n-button>
        <n-button v-if="desktopApi?.importMigration" @click="importMigration">导入迁移文件</n-button>
      </div>
    </div>
    <div class="section-card">
      <div class="section-title">基础设置</div>
      <div class="grid-2">
        <n-form-item label="tdl 路径"><n-input v-model:value="form.tdlPath" placeholder="tdl" /></n-form-item>
        <n-form-item label="命名空间"><n-input v-model:value="form.ns" placeholder="hope" /></n-form-item>
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
        <n-form-item v-if="desktopApi?.nativeRuntime" label="同时运行任务">
          <n-input-number v-model:value="form.maxConcurrentTasks" :min="1" :max="8" placeholder="例如 2" />
          <span class="mini-muted">保存后即时生效；其余任务排队等待。</span>
        </n-form-item>
        <n-form-item label="并发数"><n-input-number v-model:value="form.limit" :min="1" :max="20" placeholder="例如 5" /></n-form-item>
        <n-form-item label="线程数"><n-input-number v-model:value="form.threads" :min="1" :max="32" placeholder="例如 4" /></n-form-item>
        <n-form-item label="延迟"><n-input v-model:value="form.delay" placeholder="例如 2s，可为空" /></n-form-item>
      </div>
    </div>

    <div class="section-card">
      <div class="section-title">转发过滤</div>
      <n-form-item label="全局启用">
        <n-switch v-model:value="form.forwardFilterEnabled" />
        <span class="mini-muted" style="margin-left:10px">普通转发、导出后转发和评论区转发都会在发送前执行。</span>
      </n-form-item>
      <template v-if="form.forwardFilterEnabled">
        <n-form-item label="关键词">
          <n-input
            v-model:value="form.filterKeywordsText"
            type="textarea"
            :rows="4"
            placeholder="一行一个关键词，例如：广告、推广、返佣"
          />
        </n-form-item>
        <div class="grid-2">
          <n-form-item label="命中动作">
            <n-select v-model:value="form.filterKeywordAction" :options="keywordActionOptions" />
          </n-form-item>
          <n-form-item v-if="form.filterKeywordAction === 'replace'" label="替换为">
            <n-input v-model:value="form.filterKeywordReplacement" placeholder="留空即删除命中内容" />
          </n-form-item>
        </div>
        <n-form-item label="内容清理">
          <n-checkbox v-model:checked="form.removeLinks">删除链接</n-checkbox>
          <n-checkbox v-model:checked="form.blockImages">屏蔽图片消息</n-checkbox>
          <n-checkbox v-model:checked="form.blockVideos">屏蔽视频消息</n-checkbox>
          <n-checkbox v-model:checked="form.blockTextOnly">屏蔽纯文字消息</n-checkbox>
        </n-form-item>
        <n-form-item label="匹配选项">
          <n-checkbox v-model:checked="form.keywordCaseSensitive">区分大小写</n-checkbox>
          <n-checkbox v-model:checked="form.keywordRegexMode">关键词按正则表达式处理</n-checkbox>
        </n-form-item>
      </template>
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


    <div class="action-row">
      <n-button type="primary" @click="save">保存设置</n-button>
    </div>
  </n-form>
</template>
