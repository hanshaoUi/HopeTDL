// 从文件名自动切出标签。
//
// 只按分隔符切，不做中文分词：影视资源的文件名本来就是用 . _ - 空格 [] 【】
// 拼起来的，按分隔符切已经能拿到绝大部分有用的词；而真正的中文分词需要内置词库，
// 包体积变大且没有领域词典时切出来的标签质量很差。

const SEPARATORS = /[.\-_+\s@#|/\\]+/
// 成对括号里的内容单独成词，例如 [1080p]、【国语】、(2019)
const BRACKET_GROUP = /[[\]【】()（）{}<>《》]/g

// 常见的画质 / 编码 / 来源标记，命中后统一大写，避免 4k / 4K 变成两个标签。
const CANONICAL = new Map([
  ['4k', '4K'], ['8k', '8K'], ['2k', '2K'], ['1080p', '1080P'], ['720p', '720P'],
  ['2160p', '2160P'], ['hdr', 'HDR'], ['sdr', 'SDR'], ['dv', 'DV'], ['hdr10', 'HDR10'],
  ['x264', 'X264'], ['x265', 'X265'], ['h264', 'H264'], ['h265', 'H265'], ['hevc', 'HEVC'],
  ['aac', 'AAC'], ['dts', 'DTS'], ['ac3', 'AC3'], ['flac', 'FLAC'],
  ['bluray', 'BluRay'], ['webrip', 'WebRip'], ['webdl', 'WebDL'], ['hdtv', 'HDTV'],
  ['remux', 'Remux'], ['uhd', 'UHD']
])

// 这些切出来没有信息量，直接丢掉。
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'mp4', 'mkv', 'avi', 'mov', 'ts', 'rmvb', 'wmv', 'flv',
  'mp3', 'm4a', 'wav', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'zip', 'rar', '7z', 'pdf'
])

const MEDIA_EXT = /\.[a-z0-9]{1,5}$/i

function canonical(token) {
  const lower = token.toLowerCase()
  return CANONICAL.get(lower) || token
}

function isYear(token) {
  return /^(19|20)\d{2}$/.test(token)
}

// S01E02 / 第3季 / 第12集 这类保持整体，不要被拆成 s01 和 e02。
function isEpisode(token) {
  return /^s\d{1,2}(e\d{1,3})?$/i.test(token) || /^ep?\d{1,3}$/i.test(token) ||
    /^第[0-9一二三四五六七八九十百]+[季集话話期]$/.test(token)
}

/**
 * 从一个文件路径或文件名切出标签。
 * @param {string} input 完整路径或文件名
 * @param {{max?: number, keepExtension?: boolean}} options
 * @returns {string[]} 去重后的标签，保持出现顺序
 */
export function tagsFromFilename(input, { max = 12 } = {}) {
  const raw = String(input || '').trim()
  if (!raw) return []

  // 只取最后一段路径，并去掉扩展名
  const base = raw.split(/[/\\]/).pop() || ''
  const name = base.replace(MEDIA_EXT, '')
  if (!name) return []

  const tokens = name
    .replace(BRACKET_GROUP, ' ')
    .split(SEPARATORS)
    .map(item => item.trim())
    .filter(Boolean)

  const seen = new Set()
  const result = []
  for (const token of tokens) {
    // 纯符号、单个字符的英文/数字碎片没有意义；但单个汉字可能有意义，予以保留。
    if (!/[\p{L}\p{N}]/u.test(token)) continue
    if (token.length === 1 && !/\p{Script=Han}/u.test(token)) continue
    if (STOP_WORDS.has(token.toLowerCase())) continue
    // 纯数字里只保留年份和集数，其余（分辨率碎片、随机编号）丢掉
    if (/^\d+$/.test(token) && !isYear(token) && token.length > 4) continue

    const value = isEpisode(token) ? token.toUpperCase() : canonical(token)
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= max) break
  }
  return result
}

/** 标签数组转成 Telegram caption 里的 #标签 串。 */
export function formatTags(tags) {
  return (tags || [])
    .map(tag => '#' + String(tag).replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(tag => tag.length > 1)
    .join(' ')
}
