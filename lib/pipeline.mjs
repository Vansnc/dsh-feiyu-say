// dsh-feiyu-say · 合成管线：CosyVoice →（可选）RVC → ffmpeg → 落盘。严格失败，不静默降级。

import { existsSync, unlinkSync, copyFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 跑命令 } from './run.mjs'

const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 采样率们 = [8000, 16000, 22050, 24000, 44100]

let 忙 = false

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
 * @param 配置 生效配置（JSON 部分）
 * @param 文本 要念的话
 * @param 声线 当前声线对象（{ id, name, noRvc?, model?, index?, indexRate?, protect? }）
 * @param sampleRate 采样率（8000/16000/22050/24000/44100）
 * @param timeoutMs 单阶段超时
 * @returns { ok, 路径?, 文件名?, 声线?, 采样率?, 耗时ms? } | { ok:false, 说 }
 */
export async function 合成(配置, 文本, 声线, sampleRate, timeoutMs) {
  if (忙) return { ok: false, 说: '正在合成上一条语音，等它出来再试（约 30–60 秒）。' }
  忙 = true
  try {
    return await 合成内部(配置, 文本, 声线, sampleRate, timeoutMs)
  } finally {
    忙 = false
  }
}

async function 合成内部(配置, 文本, 声线, sampleRate, timeoutMs) {
  const 起 = Date.now()
  const 临时 = []
  const 清理 = () => { for (const f of 临时) { try { if (existsSync(f)) unlinkSync(f) } catch {} } }
  try {
    const 文 = String(文本 || '').trim()
    if (!文) return { ok: false, 说: '要给我一句要念的话' }
    const 正文 = 文.length > 200 ? 文.slice(0, 200) : 文
    const 率 = 采样率们.includes(Number(sampleRate)) ? Number(sampleRate) : 24000

    if (!配置.cosy脚本 || !existsSync(配置.cosy脚本)) return { ok: false, 说: '没配 CosyVoice 合成脚本（cosy脚本），去「鱼的声音 → 高级」填好，或先跑一次一键部署。' }
    if ((配置.cosy模式 || 'sft') !== 'custom' && (!配置.cosy模型目录 || !existsSync(配置.cosy模型目录))) return { ok: false, 说: '没配 cosy模型目录，先跑一次一键部署，或在「高级」里填好。' }

    const 底 = join(tmpdir(), 'feiyu-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    const wav0 = 底 + '.wav'
    const wav1 = 底 + '-rvc.wav'
    const wav8 = 底 + '-out.wav'
    临时.push(wav0, wav1, wav8)

    // ① CosyVoice
    const 模式 = 配置.cosy模式 || 'sft'
    const 仓库目录 = 配置.cosy仓库目录 || ''
    const 仓库路径 = 仓库目录 ? [仓库目录, join(仓库目录, 'third_party', 'Matcha-TTS'), process.env.PYTHONPATH].filter(Boolean).join(delimiter) : process.env.PYTHONPATH
    const env = 仓库路径 ? { PYTHONPATH: 仓库路径 } : {}
    let cosyArgs
    if (模式 === 'custom') {
      cosyArgs = [配置.cosy脚本, '--text', 正文, '--style', 配置.cosy风格, '--out', wav0]
      if (配置.cosy参考音频) cosyArgs.push('--ref', 配置.cosy参考音频)
      if (配置.cosy参考文字) cosyArgs.push('--ref-text', 配置.cosy参考文字)
      if (Number(配置.cosy语速) > 0) cosyArgs.push('--speed', String(配置.cosy语速))
    } else {
      cosyArgs = [配置.cosy脚本, '--model', 配置.cosy模型目录, '--text', 正文, '--out', wav0, '--mode', 模式, '--repo', 仓库目录]
      if (模式 === 'zero_shot') {
        if (配置.cosy参考音频) cosyArgs.push('--prompt-wav', 配置.cosy参考音频)
        if (配置.cosy参考文字) cosyArgs.push('--prompt-text', 配置.cosy参考文字)
      } else if (配置.cosy说话人) cosyArgs.push('--spk', 配置.cosy说话人)
      if (Number(配置.cosy语速) > 0) cosyArgs.push('--speed', String(配置.cosy语速))
    }
    const r0 = await 跑命令(配置.cosyPython, cosyArgs, { env, timeoutMs })
    if (r0.code !== 0 || !existsSync(wav0)) {
      return { ok: false, 说: 'CosyVoice 合成失败（模式 ' + 模式 + '）：' + String(r0.stderr).slice(-300) + '。voice_status 看哪项没就绪。' }
    }

    let 当前 = wav0
    // ② RVC（可选；有 model 但文件缺失 → 严格失败）
    if (声线 && !声线.noRvc && 声线.model) {
      const 模型路径 = join(配置.模型目录, 声线.model)
      const 索引路径 = 声线.index ? join(配置.模型目录, 声线.index) : ''
      if (!existsSync(模型路径)) {
        return { ok: false, 说: '声线「' + 声线.id + '」的模型文件不存在：' + 模型路径 + '。去设置页重新导入，或 voice_list 换一条。' }
      }
      const r1 = await 跑命令(配置.rvcPython, [join(插件目录, 'rvc_infer.py'), 当前, wav1, 模型路径, 索引路径, String(声线.indexRate ?? 0.75), String(声线.protect ?? 0.33)], { cwd: 配置.rvc目录 || undefined, timeoutMs, env: { KMP_DUPLICATE_LIB_OK: 'TRUE', OMP_NUM_THREADS: '1' } })
      if (r1.code !== 0 || !existsSync(wav1)) {
        return { ok: false, 说: 'RVC 换声失败（声线 ' + 声线.id + '）：' + String(r1.stderr).slice(-300) }
      }
      当前 = wav1
    }

    // ③ ffmpeg
    const r2 = await 跑命令(配置.ffmpeg || 'ffmpeg', ['-y', '-v', 'error', '-i', 当前, '-ar', String(率), '-ac', '1', '-c:a', 'pcm_s16le', wav8], { timeoutMs: 60000 })
    if (r2.code !== 0 || !existsSync(wav8)) {
      return { ok: false, 说: 'ffmpeg 转码失败（' + 率 + 'Hz）：' + String(r2.stderr).slice(-200) }
    }

    // ④ 落盘
    const 音频目录 = String(配置.音频目录 || join(tmpdir(), 'feiyu-say'))
    try { mkdirSync(音频目录, { recursive: true }) } catch (e) { return { ok: false, 说: '音频目录建不了：' + 音频目录 + '（' + String(e?.message || e) + '）' } }
    const 文件名 = 命名()
    const 目标 = join(音频目录, 文件名)
    copyFileSync(wav8, 目标)

    // ⑤ 裁剪
    裁剪(音频目录, Number(配置.音频保留数) || 200)

    return { ok: true, 路径: 目标, 文件名, 声线: 声线?.id || '原声', 采样率: 率, 耗时ms: Date.now() - 起 }
  } catch (e) {
    return { ok: false, 说: '合成出错：' + String(e?.message || e) }
  } finally {
    清理()
  }
}
