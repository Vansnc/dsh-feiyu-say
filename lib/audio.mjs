// dsh-feiyu-say · 音频服务：安全解析文件名 + 带 Range 的文件流。

import { createReadStream, existsSync, statSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'

/** 从请求 URL 解析出安全的音频文件绝对路径；非法返回 null。 */
export function 音频路径(音频目录, url) {
  try {
    const 名 = decodeURIComponent(new URL(url, 'http://x').pathname.slice('/feiyu-say/audio/'.length))
    if (!/^[A-Za-z0-9._-]{1,80}\.wav$/.test(名) || 名.includes('..')) return null
    const 根 = realpathSync(音频目录)
    const 文件 = realpathSync(join(根, 名))
    if (!文件.startsWith(根 + sep)) return null
    return 文件
  } catch { return null }
}

/** 处理 GET/HEAD 音频请求（支持 Range，供 <audio> 拖动）。 */
export function 处理音频(req, res, 音频目录) {
  const 方法 = String(req.method || 'GET').toUpperCase()
  if (方法 !== 'GET' && 方法 !== 'HEAD') { res.statusCode = 405; res.end(); return }
  const 文件 = 音频目录 ? 音频路径(音频目录, req.url) : null
  if (!文件 || !existsSync(文件)) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ ok: false, 说: '音频不在了（可能被音频目录的保留数清掉了）' }))
    return
  }
  const 大小 = statSync(文件).size
  const range = req.headers && req.headers.range
  res.setHeader('content-type', 'audio/wav')
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'no-store')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(String(range))
    let 起 = 0, 止 = 大小 - 1
    if (m) { 起 = m[1] ? parseInt(m[1], 10) : 0; 止 = m[2] ? parseInt(m[2], 10) : 大小 - 1 }
    if (起 > 止 || 起 >= 大小) { res.statusCode = 416; res.setHeader('content-range', 'bytes */' + 大小); res.end(); return }
    止 = Math.min(止, 大小 - 1)
    res.statusCode = 206
    res.setHeader('content-range', 'bytes ' + 起 + '-' + 止 + '/' + 大小)
    res.setHeader('content-length', 止 - 起 + 1)
    if (方法 === 'HEAD') { res.end(); return }
    createReadStream(文件, { start: 起, end: 止 }).pipe(res)
  } else {
    res.setHeader('content-length', 大小)
    if (方法 === 'HEAD') { res.end(); return }
    createReadStream(文件).pipe(res)
  }
}
