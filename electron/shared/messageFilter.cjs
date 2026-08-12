const fs = require('fs')
const path = require('path')
const { isTrustedArrayKey, looksLikeMessageObject, messageIdOf } = require('./messageJson.cjs')

const TEXT_KEYS = new Set(['message', 'text', 'caption', 'content', 'raw_text', 'rawText', 'body', 'title', 'description'])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'flv', 'wmv', 'mpeg', 'mpg', 'ts'])
const LINK_PATTERN = /(?:https?:\/\/|tg:\/\/|www\.|(?:^|\s)t\.me\/)[^\s<>()\[\]{}]+/giu

function parseKeywords(input) {
  if (!input) return []
  if (Array.isArray(input)) return input.map(item => String(item).trim()).filter(Boolean)
  return String(input).split(/\r?\n|,|，/).map(item => item.trim()).filter(Boolean)
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function keywordRules(config = {}) {
  const globalRules = config.forwardFilterEnabled === false ? [] : parseKeywords(config.filterKeywordsText)
  const localRules = parseKeywords(config.blockKeywordsText || config.blockKeywords)
  const values = Array.from(new Set([...globalRules, ...localRules]))
  const flags = config.keywordCaseSensitive ? 'gm' : 'gim'
  return values.map(raw => {
    const source = config.keywordRegexMode ? raw : escapeRegExp(raw)
    try {
      return { raw, regex: new RegExp(source, flags) }
    } catch {
      return { raw, regex: new RegExp(escapeRegExp(raw), flags) }
    }
  })
}

function collectText(node, depth = 0) {
  if (!node || depth > 5) return []
  if (Array.isArray(node)) return node.flatMap(item => collectText(item, depth + 1))
  if (typeof node !== 'object') return []
  const output = []
  for (const [key, value] of Object.entries(node)) {
    if (TEXT_KEYS.has(key) && typeof value === 'string') output.push(value)
    else if (value && typeof value === 'object' && /message|text|caption|content|raw/i.test(key)) {
      output.push(...collectText(value, depth + 1))
    }
  }
  return output
}

function firstKeywordHit(text, rules) {
  for (const rule of rules) {
    rule.regex.lastIndex = 0
    if (rule.regex.test(text)) return rule.raw
  }
  return ''
}

function keywordAction(config) {
  return config.forwardFilterEnabled === false ? 'drop-message' : (config.filterKeywordAction || 'drop-message')
}

function cleanText(text, config, rules, stats) {
  let value = String(text || '')
  const action = keywordAction(config)
  if (action === 'remove-segment' && rules.length) {
    value = value.split(/\r?\n/).filter(line => !firstKeywordHit(line, rules)).join('\n')
  } else if (action === 'replace' && rules.length) {
    const replacement = String(config.filterKeywordReplacement || '')
    for (const rule of rules) {
      rule.regex.lastIndex = 0
      value = value.replace(rule.regex, replacement)
    }
  }
  if (config.forwardFilterEnabled !== false && config.removeLinks) {
    const before = value
    value = value.replace(LINK_PATTERN, '')
    if (value !== before) stats.linksRemoved += 1
  }
  return value
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .join('\n')
    .trim()
}

function rewriteTextFields(node, config, rules, stats, depth = 0) {
  if (!node || depth > 5 || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach(item => rewriteTextFields(item, config, rules, stats, depth + 1))
    return
  }
  for (const [key, value] of Object.entries(node)) {
    if (TEXT_KEYS.has(key) && typeof value === 'string') node[key] = cleanText(value, config, rules, stats)
    else if (value && typeof value === 'object' && /message|text|caption|content|raw/i.test(key)) {
      rewriteTextFields(value, config, rules, stats, depth + 1)
    }
  }
}

function mediaKindOf(message) {
  const candidates = []
  function visit(node, depth = 0) {
    if (!node || depth > 4 || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && /file|path|name|mime|type|media/i.test(key)) candidates.push(value)
      else if (value && typeof value === 'object' && /file|media|document|photo|video|content/i.test(key)) visit(value, depth + 1)
    }
  }
  visit(message)
  const joined = candidates.join(' ').toLowerCase()
  if (/image\//.test(joined) || /(?:^|[^a-z])(photo|image)(?:[^a-z]|$)/.test(joined)) return 'image'
  if (/video\//.test(joined) || /(?:^|[^a-z])video(?:[^a-z]|$)/.test(joined)) return 'video'
  for (const value of candidates) {
    const ext = path.extname(value.split(/[?#]/)[0]).slice(1).toLowerCase()
    if (IMAGE_EXTENSIONS.has(ext)) return 'image'
    if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  }
  return candidates.length ? 'other' : 'text'
}

function activeRules(config = {}) {
  const globalEnabled = config.forwardFilterEnabled !== false
  const rules = keywordRules(config)
  return {
    rules,
    enabled: Boolean(
      rules.length || (globalEnabled && (config.removeLinks || config.blockImages || config.blockVideos || config.blockTextOnly))
    ),
    globalEnabled
  }
}

function filterMessageJson(json, config = {}) {
  const { rules, enabled, globalEnabled } = activeRules(config)
  const stats = {
    json,
    enabled,
    removed: 0,
    removedByType: { image: 0, video: 0, text: 0 },
    linksRemoved: 0,
    hitKeywords: [],
    count: 0
  }
  const hits = new Set()
  const ids = new Set()

  function visit(node, contextKey = '') {
    if (Array.isArray(node)) {
      const trustedArray = isTrustedArrayKey(contextKey)
      let write = 0
      for (const item of node) {
        let keep = true
        if (looksLikeMessageObject(item, trustedArray)) {
          const mediaKind = mediaKindOf(item)
          const blockType = globalEnabled && (
            (mediaKind === 'image' && config.blockImages) ||
            (mediaKind === 'video' && config.blockVideos) ||
            (mediaKind === 'text' && config.blockTextOnly)
          )
          const text = collectText(item).join('\n')
          const hit = firstKeywordHit(text, rules)
          if (blockType) {
            keep = false
            stats.removedByType[mediaKind] += 1
          } else if (hit && keywordAction(config) === 'drop-message') {
            keep = false
            hits.add(hit)
          } else {
            if (hit) hits.add(hit)
            rewriteTextFields(item, config, rules, stats)
            const id = messageIdOf(item)
            if (id !== null) ids.add(id)
          }
          if (!keep) stats.removed += 1
        }
        if (!keep) continue
        visit(item, contextKey)
        node[write] = item
        write += 1
      }
      node.length = write
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) visit(value, key)
    }
  }

  visit(json)
  stats.hitKeywords = Array.from(hits)
  stats.count = ids.size
  return stats
}

function filterAndCount(sourceFile, targetFile, config = {}) {
  const { enabled } = activeRules(config)
  let json
  try {
    json = JSON.parse(fs.readFileSync(sourceFile, 'utf8'))
  } catch {
    return { file: sourceFile, enabled: false, filterError: true, removed: 0, removedByType: { image: 0, video: 0, text: 0 }, linksRemoved: 0, hitKeywords: [], count: 0 }
  }
  const result = filterMessageJson(json, config)
  if (result.enabled) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.writeFileSync(targetFile, JSON.stringify(result.json, null, 2), 'utf8')
  }
  return { ...result, file: result.enabled ? targetFile : sourceFile, hasKeywordRules: keywordRules(config).length > 0 }
}

function shouldSkipForward(result) {
  return Boolean(result?.enabled && result.count === 0)
}

module.exports = { filterMessageJson, filterAndCount, mediaKindOf, parseKeywords, shouldSkipForward }
