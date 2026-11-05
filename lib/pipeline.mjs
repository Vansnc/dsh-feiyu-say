// dsh-feiyu-say · 合成管线
// 文本 → CosyVoice 合成 →（可选）RVC 换声 → ffmpeg 8kHz → 输出 WAV 文件
// 不投递、不接任何 IM：合成完把音频文件落盘并返回路径，其余交给会话自己的传输方式。

import { spawn } from 'node:child_process'
import { existsSync, unlinkSync, copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 插件目录 = dirname(fileURLToPath(import.meta.url))

/** 跑一个命令，等它结束；返回 { ok, 码, 出, 错 } */
function 跑(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let 出 = ''
    let 错 = ''
    let 子
    try {
      子 = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    } catch (e) {
      return resolve({ ok: false, 码: -1, 出: '', 错: '起不来 ' + cmd + '：' + String((e && e.message) || e) })
    }
    子.stdout && 子.stdout.on('data', (d) => { 出 += String(d) })
    子.stderr && 子.stderr.on('data', (d) => { 错 += String(d) })
    const 钟 = opts.timeout ? setTimeout(() => { try { 子.kill('SIGKILL') } catch {} }, opts.timeout) : null
    子.on('error', (e) => {
      if (钟) clearTimeout(钟)
      resolve({ ok: false, 码: -1, 出, 错: String((e && e.message) || e) })
    })
    子.on('close', (码) => {
      if (钟) clearTimeout(钟)
      resolve({ ok: 码 === 0, 码, 出, 错 })
    })
  })
}

/**
 * 合成一句语音，落盘成 WAV 文件。
 * @param 配置 读配置() 的合并结果
 * @param 文本 要念的话
 * @param 声线 当前选中的声线对象（{ id, name, noRvc?, model?, index?, indexRate?, protect? }）
 * @param 超时毫秒 单个阶段的最长等待
 * @returns { ok, 说, 路径? }
 */
export async function 合成(配置, 文本, 声线, 超时毫秒) {
  const 临时 = []
  const 清理 = () => {
    for (const f of 临时) {
      try { if (existsSync(f)) unlinkSync(f) } catch {}
    }
  }
  try {
    const 底 = join(tmpdir(), 'feiyu-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const wav0 = 底 + '.wav'
    const wav1 = 底 + '-rvc.wav'
    const wav8 = 底 + '-8k.wav'
    临时.push(wav0, wav1, wav8)

    // ① CosyVoice 合成基础声线
    const cosyArgs = [配置.cosy脚本, '--text', 文本, '--style', 配置.cosy风格, '--out', wav0]
    if (配置.cosy参考音频) cosyArgs.push('--ref', 配置.cosy参考音频)
    if (配置.cosy参考文字) cosyArgs.push('--ref-text', 配置.cosy参考文字)
    if (Number(配置.cosy语速) > 0) cosyArgs.push('--speed', String(配置.cosy语速))
    const r0 = await 跑(配置.cosyPython, cosyArgs, { timeout: 超时毫秒 })
    if (!r0.ok || !existsSync(wav0)) {
      return { ok: false, 说: 'CosyVoice 合成失败：' + String(r0.错 || '').slice(-200) }
    }

    let 当前 = wav0
    // ② RVC 换声（可选：声线是「原声」或没有 model 就跳过）
    if (声线 && !声线.noRvc && 声线.model) {
      const 模型路径 = join(配置.模型目录, 声线.model)
      const 索引路径 = 声线.index ? join(配置.模型目录, 声线.index) : ''
      if (existsSync(模型路径)) {
        const r1 = await 跑(
          配置.rvcPython,
          [join(插件目录, 'rvc_infer.py'), 当前, wav1, 模型路径, 索引路径, String(声线.indexRate ?? 0.75), String(声线.protect ?? 0.33)],
          { cwd: 配置.rvc目录, timeout: 超时毫秒 },
        )
        if (r1.ok && existsSync(wav1)) 当前 = wav1
        // 换声失败不硬拦：退回原声，继续
      }
    }

    // ③ ffmpeg 降到 8kHz 单声道（语音条统一按这个规格，24k 直发会转坏）
    const r2 = await 跑(配置.ffmpeg, ['-y', '-v', 'error', '-i', 当前, '-ar', '8000', '-ac', '1', '-c:a', 'pcm_s16le', wav8], { timeout: 60000 })
    if (!r2.ok || !existsSync(wav8)) {
      return { ok: false, 说: 'ffmpeg 转 8kHz 失败：' + String(r2.错 || '').slice(-200) }
    }

    // ④ 落盘到音频目录，返回路径
    const 目录 = String(配置.音频目录 || join(tmpdir(), 'feiyu-say'))
    try { mkdirSync(目录, { recursive: true }) } catch {}
    const 目标 = join(目录, 'feiyu-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.wav')
    copyFileSync(wav8, 目标)
    return { ok: true, 说: '语音合成好了', 路径: 目标 }
  } catch (e) {
    return { ok: false, 说: '合成出错：' + String((e && e.message) || e) }
  } finally {
    清理()
  }
}
