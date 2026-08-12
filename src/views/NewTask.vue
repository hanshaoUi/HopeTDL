<script setup>
import { computed, defineAsyncComponent } from 'vue'
import { appState } from '../state'

// 五种任务原本是五个平级页面，用户得自己知道「转发要先去导出页产出 JSON」。
// 这里合成一个入口：左边选做什么，右边是这件事的表单，并在表单上方说明它和别的任务的关系。
const ExportForm = defineAsyncComponent(() => import('./forms/ExportForm.vue'))
const DownloadForm = defineAsyncComponent(() => import('./forms/DownloadForm.vue'))
const ForwardForm = defineAsyncComponent(() => import('./forms/ForwardForm.vue'))
const CommentForwardForm = defineAsyncComponent(() => import('./forms/CommentForwardForm.vue'))
const UploadForm = defineAsyncComponent(() => import('./forms/UploadForm.vue'))

const kinds = [
  {
    key: 'export',
    icon: '⤓',
    title: '导出消息',
    short: '把消息元数据存成 JSON',
    desc: '从一个对话导出消息记录到 JSON 文件。转发任务需要吃这个 JSON，所以通常先做这一步。',
    component: ExportForm
  },
  {
    key: 'download',
    icon: '⭳',
    title: '下载媒体',
    short: '把图片视频存到本地',
    desc: '从消息链接、导出的 JSON、或某条主消息的评论区批量下载媒体文件。和「导出消息」的区别：导出只存文字记录，这里存实际文件。',
    component: DownloadForm
  },
  {
    key: 'forward',
    icon: '➜',
    title: '转发消息',
    short: '把已导出的消息发到别处',
    desc: '来源是「导出消息」产出的 JSON 文件或一条消息链接。默认开启演练，确认无误再正式发送。',
    component: ForwardForm
  },
  {
    key: 'commentForward',
    icon: '⇉',
    title: '评论区顺序转发',
    short: '主消息和评论区按顺序搬运',
    desc: '自己完成导出和转发的全流程，不需要先跑「导出消息」。顺序是：主消息 1 → 评论区 1 → 主消息 2 → 评论区 2。支持关键词屏蔽和断点续跑。',
    component: CommentForwardForm
  },
  {
    key: 'upload',
    icon: '⤒',
    title: '上传文件',
    short: '把本地文件发到对话',
    desc: '上传单个文件或整个文件夹到指定对话，可指定话题和 caption。',
    component: UploadForm
  }
]

const activeKind = computed({
  get: () => kinds.some(item => item.key === appState.newTaskKind) ? appState.newTaskKind : 'export',
  set: val => { appState.newTaskKind = val }
})

const current = computed(() => kinds.find(item => item.key === activeKind.value) || kinds[0])
</script>

<template>
  <header class="page-head">
    <h1 class="page-title">新建任务</h1>
    <p class="page-desc">选择要做什么，右侧填参数。所有任务都会进入「任务」页，可以停止、重试或设成定时。</p>
  </header>

  <div class="new-task-layout">
    <nav class="kind-picker">
      <button
        v-for="kind in kinds"
        :key="kind.key"
        type="button"
        class="kind-item"
        :class="{ active: activeKind === kind.key }"
        @click="activeKind = kind.key"
      >
        <span class="kind-icon">{{ kind.icon }}</span>
        <span class="kind-text">
          <span class="kind-title">{{ kind.title }}</span>
          <span class="kind-short">{{ kind.short }}</span>
        </span>
      </button>
    </nav>

    <div class="kind-body">
      <p class="kind-desc">{{ current.desc }}</p>
      <component :is="current.component" />
    </div>
  </div>
</template>
