import test from 'node:test'
import assert from 'node:assert/strict'
import { after } from 'node:test'
import { createServer } from 'vite'

const storage = new Map()
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null },
  setItem(key, value) { storage.set(key, String(value)) },
  removeItem(key) { storage.delete(key) },
  clear() { storage.clear() }
}

const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false }
})
after(() => vite.close())

const {
  createChatCategory,
  deleteChatCategory,
  getChatCategories,
  getChatCategoryIds,
  getExportRecords,
  getForwardRecords,
  invalidateStorageCache,
  renameChatCategory,
  saveForwardRecord,
  setChatCategoryIds,
  setExportMemory
} = await vite.ssrLoadModule('/src/historyStore.js')

function resetStorage() {
  storage.clear()
  invalidateStorageCache()
}

test('Given identical forward parameters, when saved repeatedly, then history keeps only the newest record', () => {
  resetStorage()
  const command = 'tdl forward --from messages.json --to 123 --mode clone'

  saveForwardRecord({ command, time: 'first' }, 'hope')
  saveForwardRecord({ command, time: 'second' }, 'hope')

  assert.deepEqual(getForwardRecords('hope').map(row => row.time), ['second'])
})

test('Given legacy duplicate exports for one output, when history is read, then only the newest record is shown', () => {
  resetStorage()
  setExportMemory({
    last: null,
    chats: {},
    records: [
      { output: '/tmp/export.json', input: '101,200', time: 'finalized' },
      { output: '/tmp/export.json', input: '1,100', time: 'draft' }
    ]
  }, 'hope')

  assert.deepEqual(getExportRecords('hope').map(row => row.time), ['finalized'])
})

test('Given a namespace, when categories are created and renamed, then they stay local to that namespace', () => {
  resetStorage()

  const category = createChatCategory(' 影视资源 ', 'hope')
  createChatCategory('待整理', 'hope')
  renameChatCategory(category.id, '精选资源', 'hope')

  assert.deepEqual(getChatCategories('hope').map(item => item.name), ['精选资源', '待整理'])
  assert.deepEqual(getChatCategories('work'), [])
  assert.throws(() => createChatCategory(' 精选资源 ', 'hope'), /已存在/)
})

test('Given chat category assignments, when a category is deleted, then its assignments are removed without affecting others', () => {
  resetStorage()

  const movies = createChatCategory('影视', 'hope')
  const archive = createChatCategory('归档', 'hope')
  setChatCategoryIds('-123', [movies.id, archive.id, 'missing'], 'hope')
  setChatCategoryIds({ id: '456', VisibleName: '测试频道' }, [movies.id], 'hope')

  assert.deepEqual(getChatCategoryIds('123', 'hope'), [movies.id, archive.id])
  assert.deepEqual(getChatCategoryIds('456', 'hope'), [movies.id])

  deleteChatCategory(movies.id, 'hope')

  assert.deepEqual(getChatCategoryIds('123', 'hope'), [archive.id])
  assert.deepEqual(getChatCategoryIds('456', 'hope'), [])
  assert.deepEqual(getChatCategories('hope').map(item => item.name), ['归档'])
})
