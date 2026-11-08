// dsh-feiyu-say · 配置：百炼接口 + 输出。没有本地模型相关字段了。

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep, dirname } from 'node:path'

const 家 = () => process.env.DSH_HOME || join(homedir(), '.dsh')
export const 配置文件路径 = () => join(家(), 'feiyu-say-config.json')

export const 提示文案表 = {
  off: '',
  auto: '想用声音说这句话就调 send_voice（短句，1–2 句）；不想说就正常回文字。',
  always: '每轮回复前先想：这句话用声音说出来是不是更像人？合适就调 send_voice 发语音条（短句 1–2 句），再用文字接一句。不想说就正常回文字。',
}

export const 旋钮默认值 = {
  enabled: true,
  sampleRate: 24000,
  hintMode: 'auto',
  timeoutMs: 240000,
}

export const 百炼默认地址 = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

export const JSON默认值 = () => ({
  百炼ApiKey: '',
  百炼模型: 'qwen-audio-3.1-tts-flash',
  百炼音色: 'longanhuan_v3.1',
  百炼地址: 百炼默认地址,
  ffmpeg: 'ffmpeg',
  音频目录: join(家(), 'feiyu-say', 'audio'),
  音频保留数: 200,
  // ── QQ 语音条（子功能）：合成完顺手发成语音条 ──
  发QQ语音条: true,
  QQ语音条只在绑定会话: true,
  QQ语音条转8k: true,
  QQ语音条最短间隔秒: 600,
  QQ语音条每日上限: 5,
  NapCat地址: '',
})

const 采样率们 = [8000, 16000, 22050, 24000, 44100]

export function clamp旋钮(patch = {}) {
  const 出 = { ...旋钮默认值, ...patch }
  出.enabled = !!出.enabled
  if (!采样率们.includes(Number(出.sampleRate))) 出.sampleRate = 24000
  const t = Number(出.timeoutMs)
  出.timeoutMs = Number.isFinite(t) && t >= 10000 && t <= 600000 ? Math.round(t) : 240000
  if (!['off', 'auto', 'always'].includes(出.hintMode)) 出.hintMode = 'auto'
  delete 出.hintEnabled
  delete 出.hintText
  return 出
}

/** 路径必须绝对、resolve 后不含 `..`；空值返回空。ffmpeg 允许裸命令名。 */
function 净路径(v, 允许命令名 = false) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (允许命令名 && s === 'ffmpeg') return s
  const r = resolve(s)
  if (!s.startsWith('/') || r.split(sep).includes('..')) return ''
  return r
}

function clamp配置(配置) {
  const c = { ...JSON默认值(), ...配置 }

  c.百炼ApiKey = String(c.百炼ApiKey == null ? '' : c.百炼ApiKey).trim()
  c.百炼模型 = String(c.百炼模型 == null ? '' : c.百炼模型).trim().slice(0, 100) || 'qwen-audio-3.1-tts-flash'
  c.百炼音色 = String(c.百炼音色 == null ? '' : c.百炼音色).trim().slice(0, 100) || 'longanhuan_v3.1'
  const 地 = String(c.百炼地址 == null ? '' : c.百炼地址).trim()
  c.百炼地址 = /^wss?:\/\/\S+$/i.test(地) ? 地 : 百炼默认地址

  c.ffmpeg = 净路径(c.ffmpeg, true) || 'ffmpeg'
  c.音频目录 = 净路径(c.音频目录) || join(家(), 'feiyu-say', 'audio')
  const 留 = Number(c.音频保留数)
  c.音频保留数 = Number.isInteger(留) && 留 >= 10 && 留 <= 2000 ? 留 : 200

  const 间 = Number(c.QQ语音条最短间隔秒)
  c.QQ语音条最短间隔秒 = Number.isFinite(间) && 间 >= 0 && 间 <= 86400 ? Math.round(间) : 600
  const 每 = Number(c.QQ语音条每日上限)
  c.QQ语音条每日上限 = Number.isFinite(每) && 每 >= 1 && 每 <= 200 ? Math.round(每) : 5
  c.发QQ语音条 = c.发QQ语音条 !== false
  c.QQ语音条只在绑定会话 = c.QQ语音条只在绑定会话 !== false
  c.QQ语音条转8k = c.QQ语音条转8k !== false
  const 网 = String(c.NapCat地址 == null ? '' : c.NapCat地址).trim()
  c.NapCat地址 = /^https?:\/\/\S+$/i.test(网) ? 网 : ''
  return c
}

/** 只保留认识的键 —— 旧版本的本地路径字段读不进来，下次保存也就清掉了。 */
function 只保留(文件) {
  const 出 = {}
  for (const k of Object.keys(JSON默认值())) if (文件[k] !== undefined) 出[k] = 文件[k]
  return 出
}

export function 读JSON() {
  let 文件 = {}
  try {
    if (existsSync(配置文件路径())) 文件 = JSON.parse(readFileSync(配置文件路径(), 'utf8'))
  } catch (e) {
    console.warn('[feiyu-say] 读配置失败，用默认值：' + String(e?.message || e))
  }
  return clamp配置(只保留(文件))
}

/** 原子写：tmp + rename；写前备份；0600（里面有 API Key）。 */
export function 写JSON(配置) {
  const 路径 = 配置文件路径()
  const 净 = clamp配置(只保留(配置))
  try {
    mkdirSync(dirname(路径), { recursive: true })
    if (existsSync(路径)) {
      try { writeFileSync(路径 + '.bak-' + Date.now(), readFileSync(路径)) } catch {}
    }
    const tmp = 路径 + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(净, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, 路径)
    return true
  } catch (e) {
    console.warn('[feiyu-say] 写配置失败：' + String(e?.message || e))
    return false
  }
}
