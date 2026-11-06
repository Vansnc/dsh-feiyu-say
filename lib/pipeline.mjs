// dsh-feiyu-say · 合成管线：阿里百炼 TTS → ffmpeg 转目标采样率 → 落盘。严格失败，不静默降级。
// 没有本地模型、没有 RVC。

import { existsSync, unlinkSync, copyFileSync, mkdirSync, readdirSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 跑命令 } from './run.mjs'
import { 百炼合成 } from './bailian.mjs'

const 采样率们 = [8000, 16000, 22050, 24000, 44100]

// 忙锁用「到期时间戳」：即使合成 promise 卡死/前端中断，到点也自动放行。
let 忙到 = 0

function 命名() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 8)
  return `feiyu-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}.wav`
}

function 裁剪(音频目录, 保留数) {
  try {
    const 文件 = readdirSync(音频目录)
      .filter((n) => /^feiyu-.*\.wav$/.test(n))
      .map((n) => ({ n, m: statSync(join(音频目录, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    for (const f of 文件.slice(保留数)) { try { rmSync(join(音频目录, f.n)) } catch {} }
  } catch {}
}

/**
 * 合成一句语音。
 * @param 配置 生效配置
 * @param 文本 要念的话
 * @param sampleRate 采样率（8000/16000/22050/24000/44100）
 * @param timeoutMs 超时
 * @returns { ok, 路径?, 文件名?, 音色?, 采样率?, 耗时ms? } | { ok:false, 说 }
 */
export async function 合成(配置, 文本, sampleRate, timeoutMs) {
  const 现在 = Date.now()
  if (现在 < 忙到) return { ok: false, 说: '上一条语音还在合成，等它出来再点。' }
  const 限 = Number(timeoutMs) > 0 ? Number(timeoutMs) : 240000
  忙到 = 现在 + 限 + 15000
  try {
    return await 合成内部(配置, 文本, sampleRate, 限)
  } finally {
    忙到 = 0
  }
}

async function 合成内部(配置, 文本, sampleRate, timeoutMs) {
  const 起 = Date.now()
  const 临时 = []
  const 清理 = () => { for (const f of 临时) { try { if (existsSync(f)) unlinkSync(f) } catch {} } }
  try {
    const 文 = String(文本 || '').trim()
    if (!文) return { ok: false, 说: '要给我一句要念的话' }
    const 正文 = 文.length > 200 ? 文.slice(0, 200) : 文
    const 率 = 采样率们.includes(Number(sampleRate)) ? Number(sampleRate) : 24000

    const apiKey = String(配置.百炼ApiKey || process.env.DASHSCOPE_API_KEY || '').trim()
    if (!apiKey) return { ok: false, 说: '百炼没配 API Key，去「鱼的声音」填好（或设 DASHSCOPE_API_KEY 环境变量）' }

    const r = await 百炼合成({
      地址: 配置.百炼地址,
      apiKey,
      模型: 配置.百炼模型,
      音色: 配置.百炼音色,
      文本: 正文,
      超时毫秒: timeoutMs,
    })
    if (!r.ok) return r

    const 底 = join(tmpdir(), 'feiyu-bl-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const 源 = 底 + '.mp3'
    const wav = 底 + '.wav'
    临时.push(源, wav)
    writeFileSync(源, r.音频)

    const ff = await 跑命令(配置.ffmpeg || 'ffmpeg', ['-y', '-v', 'error', '-i', 源, '-ar', String(率), '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeoutMs: 60000 })
    if (ff.code !== 0 || !existsSync(wav)) {
      return { ok: false, 说: 'ffmpeg 转码失败（' + 率 + 'Hz）：' + String(ff.stderr).slice(-200) }
    }

    const 音频目录 = String(配置.音频目录 || join(tmpdir(), 'feiyu-say'))
    try { mkdirSync(音频目录, { recursive: true }) } catch (e) {
      return { ok: false, 说: '音频目录建不了：' + 音频目录 + '（' + String(e?.message || e) + '）' }
    }
    const 文件名 = 命名()
    const 目标 = join(音频目录, 文件名)
    copyFileSync(wav, 目标)
    裁剪(音频目录, Number(配置.音频保留数) || 200)

    return {
      ok: true,
      路径: 目标,
      文件名,
      音色: 配置.百炼音色,
      采样率: 率,
      耗时ms: Date.now() - 起,
    }
  } catch (e) {
    return { ok: false, 说: '合成出错：' + String(e?.message || e) }
  } finally {
    清理()
  }
}
