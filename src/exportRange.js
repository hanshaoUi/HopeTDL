/**
 * 增量导出的起始 ID。
 *
 * 优先级：你已经填在「消息范围」里的起始值 > 这个聊天上次导出记录里的下一个 ID。
 * 记录本身有三种新旧写法（`nextStartId` / `maxId` / 直接存的 `input`），
 * 都得认，否则换过版本的老记录会读不出来。
 *
 * @param {string} typedInput 当前输入框里的 -i，例如 "501,1500"
 * @param {object|null} record 该聊天的上次导出记录
 * @returns {number} 起始 ID；无从判断时返回 0
 */
export function resolveRangeStart(typedInput, record) {
  const typed = Number(String(typedInput || '').split(',')[0].trim())
  if (Number.isSafeInteger(typed) && typed > 0) return typed
  if (!record) return 0

  const remembered = Number(record.nextStartId)
  if (Number.isSafeInteger(remembered) && remembered > 0) return remembered

  const maxId = Number(record.maxId)
  if (Number.isSafeInteger(maxId) && maxId > 0) return maxId + 1

  const rememberedStart = Number(String(record.input || '').split(',')[0].trim())
  return Number.isSafeInteger(rememberedStart) && rememberedStart > 0 ? rememberedStart : 0
}
