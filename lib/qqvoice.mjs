// dsh-feiyu-say · QQ 语音条（子功能）
//
// 背景：QQ 桥（dsh-qq-link）只发文字 / 图片 / 文件，没有「语音条」这一路；
// send_voice 只是把 wav 合成到本地。两边都不管，于是她说「我发不了语音」。
//
// 做法：听 tools/result，看见 send_voice 成功就
//   ① ffmpeg 转 8kHz 单声道（QQ 会把 24k 直发转成卡带声）；
//   ② 直接调 NapCat 的 send_private_msg 发 record 段；
//   ③ 按「路径 + mtime」去重，同一段不发两遍。
//
// 不碰桥的收发流程，也不改别人的插件；桥的总开关 / 试运行照旧管用。

import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const 跑 = promisify(execFile)

const 桥配置路径 = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'qq-bridge-config.json')

function 读桥() {
  try { return JSON.parse(readFileSync(桥配置路径(), 'utf8')) } catch { return null }
}

const 归一 = (id) => String(id || '').replace(/^session-/, '')

export function 做QQ语音条({ 取配置, 日志 }) {
  const 已发过 = new Set()

  const 找私聊 = (桥) => {
    const 行们 = Array.isArray(桥.绑定) ? 桥.绑定 : []
    return 行们.find((x) => x && x.类型 === '私聊' && x.开 !== false && Number(x.号码)) || null
  }

  const 转8k = async (源, ffmpeg, 目录) => {
    try { mkdirSync(目录, { recursive: true }) } catch {}
    const 出 = join(目录, 'qq-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.wav')
    await 跑(ffmpeg || 'ffmpeg', ['-y', '-i', 源, '-ar', '8000', '-ac', '1', '-c:a', 'pcm_s16le', 出], { timeout: 20000 })
    return 出
  }

  const 发一段 = async (地址, 令牌, 号码, 文件) => {
    const 头 = { 'content-type': 'application/json' }
    if (令牌) 头.authorization = 'Bearer ' + 令牌
    const r = await fetch(String(地址).replace(/\/+$/, '') + '/send_private_msg', {
      method: 'POST',
      headers: 头,
      body: JSON.stringify({ user_id: Number(号码), message: [{ type: 'record', data: { file: 'file://' + 文件 } }] }),
    })
    return await r.json().catch(() => ({}))
  }

  /** 处理一条 tools/result；不是 send_voice 就直接返回。 */
  return async function 处理(exec, result) {
    try {
      if (!exec || exec.name !== 'send_voice') return
      if (!result || result.isError) return
      const 值 = result.value || {}
      const 源 = String(值.路径 || '')
      if (!值.ok || !源 || !existsSync(源)) return

      const 配置 = 取配置() || {}
      if (配置.发QQ语音条 === false) return

       const 桥 = 读桥()
      if (!桥 || !桥.总开关) return
      if (桥.试运行) { 日志('桥在试运行，语音条不发'); return }
      const 行 = 找私聊(桥)
      if (!行) { 日志('桥没有可用的私聊绑定，语音条不发'); return }

      if (配置.QQ语音条只在绑定会话 !== false) {
        const 语音会话 = 归一(exec.agent && exec.agent.session && exec.agent.session.id)
        const 绑定会话 = 归一(行.会话)
        if (绑定会话 && 语音会话 && 语音会话 !== 绑定会话) return
      }

      const 指纹 = 源 + '|' + (statSync(源).mtimeMs || 0)
      if (已发过.has(指纹)) return
      已发过.add(指纹)
      if (已发过.size > 200) 已发过.clear()

      const 地址 = String(配置.NapCat地址 || 桥.NapCat || '').trim()
      if (!地址) { 日志('没配 NapCat 地址，语音条不发'); return }
      const 发 = 配置.QQ语音条转8k === false ? 源 : await 转8k(源, 配置.ffmpeg, 配置.音频目录)
      const r = await 发一段(地址, 桥.令牌, 行.号码, 发)
      if (r && r.status === 'ok') 日志('语音条已发：' + 发)
      else 日志('发语音条失败：' + JSON.stringify(r || {}).slice(0, 160))
    } catch (e) {
      日志('发语音条出错：' + String(e?.message || e))
    }
  }
}
