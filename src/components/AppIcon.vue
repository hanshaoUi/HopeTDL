<script setup>
defineProps({ name: String, size: { type: [Number, String], default: 20 } });
const paths = {
  star: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z",
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2',
  tasks: 'M14 2H6v20h14V8l-6-6Zm0 0v6h6M8 13h8m-8 4h8',
  comments: 'm15 10 5 5-5 5M4 4v7a4 4 0 0 0 4 4h12',
  media: 'M3 3h18v18H3V3Zm3 14 5-5 4 4 3-3 3 3M8 7h1',
  copy: 'M8 8h13v13H8V8ZM4 16H2V2h14v2',
  history: 'M3 4v6h6M3 10a9 9 0 1 1 0 6M12 7v5l3 2',

  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z',
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  chats: "M4 4h16v13H9l-5 4V4Zm4 5h1m3 0h1m3 0h1M8 13h7",
  queue: "m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5",
  calendar: "M4 5h16v16H4V5Zm0 5h16M8 2v6m8-6v6",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm0 9a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  transfer: "M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  export: "M6 2h8l4 4v16H6V2Zm8 0v5h4M9 12h6m-6 4h6",
  upload: "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6",
  chevron: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  folder: "M3 6h7l2 3h9v11H3V6Z",
  info: "M12 11v6m0-10v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  play: "m8 4 13 8-13 8V4Z",
  stop: "M5 5h14v14H5V5Z",
  search: "M15 15l6 6M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0",
  plus: "M12 4v16M4 12h16",
};
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.info" />
  </svg>
</template>
