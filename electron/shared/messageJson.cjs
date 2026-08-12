// tdl 导出的 JSON 结构在不同命令下不完全一样（chat export / --reply / --raw），
// 所以识别「哪个对象是一条消息」只能靠启发式。这套逻辑原先在 main.cjs 和
// commentForwardWorker.cjs 里各有一份，改动时容易只改一边，这里合并为唯一实现。

function asSafeInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return null
  if (n < 0) return null
  return n
}

/** 从一个疑似消息对象上取消息 ID，取不到返回 null。 */
function messageIdOf(obj) {
  if (!obj || typeof obj !== 'object') return null
  return asSafeInteger(obj.id ?? obj.ID ?? obj.message_id ?? obj.messageID)
}

// 只要对象带 ID 且出现其中任意一个字段，就认为它是一条消息。
// 合并前 main.cjs 的列表少了 caption / content 两项，这里统一取并集：
// tdl 导出的消息都带 date，这两项在实践中不改变判定结果，但没有理由让两边不一致。
const MESSAGE_KEYS = [
  'date', 'message', 'text', 'raw', 'media', 'file', 'from_id', 'fromId', 'peer_id', 'peerId',
  'reply_to', 'replyTo', 'edit_date', 'editDate', 'entities', 'views', 'forwards', 'out', 'post',
  'grouped_id', 'groupedId', 'via_bot_id', 'viaBotId', 'ttl_period', 'ttlPeriod', 'caption', 'content'
]

// 处在这些键名下的数组，其元素只要带 ID 就直接认定是消息，不再要求命中 MESSAGE_KEYS。
const TRUSTED_ARRAY_KEYS = ['messages', 'message', 'items', 'list', 'data', 'result']

function isTrustedArrayKey(contextKey) {
  return TRUSTED_ARRAY_KEYS.includes(String(contextKey || '').toLowerCase())
}

function looksLikeMessageObject(obj, trustId = false) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  if (messageIdOf(obj) === null) return false
  if (trustId) return true
  return MESSAGE_KEYS.some(key => Object.prototype.hasOwnProperty.call(obj, key))
}

function collectMessageIds(node, ids = [], contextKey = '') {
  if (!node) return ids

  if (Array.isArray(node)) {
    const trustedArray = isTrustedArrayKey(contextKey)
    for (const item of node) {
      if (looksLikeMessageObject(item, trustedArray)) {
        const id = messageIdOf(item)
        if (id !== null) ids.push(id)
      }
      collectMessageIds(item, ids, contextKey)
    }
    return ids
  }

  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectMessageIds(value, ids, key)
    }
  }
  return ids
}

/** 去重并升序排列的消息 ID。 */
function extractMessageIds(json) {
  return Array.from(new Set(collectMessageIds(json))).sort((a, b) => a - b)
}

module.exports = {
  asSafeInteger,
  messageIdOf,
  looksLikeMessageObject,
  isTrustedArrayKey,
  collectMessageIds,
  extractMessageIds,
  MESSAGE_KEYS,
  TRUSTED_ARRAY_KEYS
}
