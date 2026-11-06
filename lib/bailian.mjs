// dsh-feiyu-say · 阿里百炼 TTS（WebSocket 直连，不依赖 Python / DashScope SDK）
//
// 协议（Qwen-Audio-TTS / CosyVoice 通用）：
//   连 wss://…/api-ws/v1/inference（Authorization: Bearer <key>）
//   → run-task（model / voice / format / sample_rate）
//   → 收到 task-started 后发 continue-task(text) + finish-task
//   → 二进制帧就是音频，task-finished 收尾
//
// 只做一件事：给一段文字，拿回音频 Buffer。落盘、转码、裁剪都在 pipeline.mjs。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

let ws模块 = null

/**
 * ws 是插件的直接依赖；但插件常用 `link:` 装在 profile 里，
 * 从源码目录裸 import 可能解析不到 —— 依次尝试「自己的依赖 → profile 树」。
 */
async function 载入ws() {
  if (ws模块) return ws模块
  const 试 = []
  try { 试.push(await import('ws')) } catch {}
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const 候选 = [
    process.env.DSH_PROFILE_DIR && join(process.env.DSH_PROFILE_DIR, 'node_modules', 'ws'),
    join(家, 'profiles', 'desktop', 'node_modules', 'ws'),
    join(家, 'profiles', 'web', 'node_modules', 'ws'),
    join(家, 'profiles', 'headless', 'node_modules', 'ws'),
  ].filter(Boolean)
  for (const 目录 of 候选) {
    try {
      if (!existsSync(join(目录, 'package.json'))) continue
      试.push(await import(pathToFileURL(join(目录, 'index.js')).href))
      break
    } catch {}
  }
  const m = 试.find(Boolean)
  ws模块 = m?.default || m?.WebSocket || m
  if (typeof ws模块 !== 'function') {
    throw new Error('找不到 ws 模块。重装插件（pnpm install）或重启 DSH 再试。')
  }
  return ws模块
}

/**
 * 合成一段文字。
 * @param {object} o
 * @param {string} o.地址    wss://…/api-ws/v1/inference
 * @param {string} o.apiKey  百炼 API Key
 * @param {string} o.模型    如 qwen-audio-3.1-tts-flash
 * @param {string} o.音色    如 longanhuan_v3.1
 * @param {string} o.文本
 * @param {number} [o.超时毫秒]
 * @returns {Promise<{ok:true, 音频:Buffer, 格式:string} | {ok:false, 说:string}>}
 */
export async function 百炼合成(o) {
  const 地址 = String(o?.地址 || '').trim()
  const apiKey = String(o?.apiKey || '').trim()
  const 模型 = String(o?.模型 || '').trim() || 'qwen-audio-3.1-tts-flash'
  const 音色 = String(o?.音色 || '').trim() || 'longanhuan_v3.1'
  const 文本 = String(o?.文本 || '').trim()
  const 超时毫秒 = Math.max(5000, Math.min(Number(o?.超时毫秒) || 60000, 600000))

  if (!apiKey) return { ok: false, 说: '百炼没配 API Key，去「鱼的声音 → 引擎」填好' }
  if (!文本) return { ok: false, 说: '要给我一句要念的话' }
  if (!/^wss?:\/\//i.test(地址)) return { ok: false, 说: '百炼地址不对，要 wss:// 开头（设置里能改）' }

  let WS
  try { WS = await 载入ws() }
  catch (e) { return { ok: false, 说: String(e?.message || e) } }

  const taskId = randomUUID()

  return await new Promise((resolve) => {
    let 已结束 = false
    let 定时 = null
    let ws = null
    const 音频 = []
    let 连接错 = ''

    const 收尾 = (结果) => {
      if (已结束) return
      已结束 = true
      if (定时) clearTimeout(定时)
      try { ws?.close() } catch {}
      resolve(结果)
    }

    try {
      ws = new WS(地址, {
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'User-Agent': 'dsh-feiyu-say/0.4',
        },
        handshakeTimeout: Math.min(超时毫秒, 20000),
      })
    } catch (e) {
      return resolve({ ok: false, 说: 'WebSocket 起不来：' + String(e?.message || e) })
    }

    定时 = setTimeout(() => 收尾({ ok: false, 说: '百炼合成超时（' + 超时毫秒 + 'ms）' }), 超时毫秒)

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({
          header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'tts',
            function: 'SpeechSynthesizer',
            model: 模型,
            parameters: {
              text_type: 'PlainText',
              voice: 音色,
              format: 'mp3',
              sample_rate: 22050,
              volume: 50,
              rate: 1,
              pitch: 1,
              enable_ssml: false,
            },
            input: {},
          },
        }))
      } catch (e) {
        收尾({ ok: false, 说: '百炼请求发不出去：' + String(e?.message || e) })
      }
    })

    ws.on('message', (data, isBinary) => {
      if (isBinary) { 音频.push(Buffer.from(data)); return }
      let 消息
      try { 消息 = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) } catch { return }
      const ev = 消息?.header?.event
      if (ev === 'task-started') {
        try {
          ws.send(JSON.stringify({
            header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: { text: 文本 } },
          }))
          ws.send(JSON.stringify({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          }))
        } catch (e) {
          收尾({ ok: false, 说: '百炼文本发不出去：' + String(e?.message || e) })
        }
      } else if (ev === 'task-finished') {
        const 全部 = Buffer.concat(音频)
        收尾(全部.length ? { ok: true, 音频: 全部, 格式: 'mp3' } : { ok: false, 说: '百炼返回了空音频' })
      } else if (ev === 'task-failed') {
        const 原因 = 消息?.header?.error_message || 消息?.header?.error_code || '未知错误'
        收尾({ ok: false, 说: '百炼合成失败：' + 原因 })
      }
    })

    ws.on('error', (e) => { 连接错 = String(e?.message || e) })
    ws.on('close', (码) => {
      收尾({
        ok: false,
        说: '百炼连接关闭（' + 码 + '）' +
          (连接错 ? '：' + 连接错 + '。检查 API Key、地址地域是否一致、模型是否开通' : ''),
      })
    })
  })
}

/** 百炼引擎的自检：不发网络请求，只看配置齐不齐。 */
export async function 百炼自检(配置) {
  const 项 = []
  let 就绪 = true
  const 加 = (名, ok, 详情) => { 项.push({ 名, ok, 详情 }); if (!ok) 就绪 = false }

  加('引擎', true, '阿里百炼（WebSocket）')
  加('API Key', !!String(配置.百炼ApiKey || '').trim(), 配置.百炼ApiKey ? '已配置' : '没填，去「鱼的声音 → 引擎」填')
  加('地址', /^wss?:\/\//i.test(String(配置.百炼地址 || '')), 配置.百炼地址 || '（空）')
  加('模型', !!String(配置.百炼模型 || '').trim(), 配置.百炼模型 || '（空）')
  加('音色', !!String(配置.百炼音色 || '').trim(), 配置.百炼音色 || '（空）')

  const { spawnSync } = await import('node:child_process')
  const ff = spawnSync(配置.ffmpeg || 'ffmpeg', ['-version'], { encoding: 'utf8', timeout: 5000 })
  加('ffmpeg', ff.status === 0, ff.status === 0 ? String(ff.stdout || '').split('\n')[0].slice(0, 60) : '找不到 ffmpeg')

  const 行 = 项.map((x) => (x.ok ? '✅ ' : '❌ ') + x.名 + '：' + x.详情)
  return { ok: 就绪, 就绪, 说: '百炼引擎自检\n' + 行.join('\n'), 项 }
}
