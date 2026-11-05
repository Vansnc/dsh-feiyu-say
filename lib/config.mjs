// dsh-feiyu-say · 配置模块：默认值、读写（原子）、合并、clamp、迁移、声线发现。

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename, resolve, sep, dirname } from 'node:path'

const 家 = () => process.env.DSH_HOME || join(homedir(), '.dsh')
export const 配置文件路径 = () => join(家(), 'feiyu-say-config.json')

// ── 旋钮（进插件 Config，§4.1）──
export const 旋钮默认值 = {
  enabled: true,
  sampleRate: 24000,
  hintEnabled: false,
  hintText: '想用声音说这句话就调 send_voice（短句 1–2 句，30–60 秒出音）。\n这条要发 QQ 语音条就传 sampleRate: 8000；只在网页/本地听用默认采样率。\n不想说就正常回文字。',
  timeoutMs: 240000,
}

// ── JSON 默认（§4.2）──
export const JSON默认值 = () => ({
  _版本: 2,
  cosyPython: '',
  cosy脚本: '',
  cosy仓库目录: '',
  cosy模式: 'sft',
  cosy说话人: '中文女',
  cosy参考音频: '',
  cosy参考文字: '',
  cosy风格: 'cute',
  cosy语速: 1.0,
  cosy仓库: 'https://github.com/FunAudioLLM/CosyVoice.git',
  cosy模型源: 'iic/CosyVoice2-0.5B',
  cosy模型目录: '',
  rvcPython: '',
  rvc目录: '',
  模型目录: '',
  ffmpeg: 'ffmpeg',
  音频目录: '',
  音频保留数: 200,
  部署目录: '',
  rvc模型地址: '',
  声线: [],
  当前声线: '原声',
})

const 采样率们 = [8000, 16000, 22050, 24000, 44100]

export function clamp旋钮(patch = {}) {
  const 出 = { ...旋钮默认值, ...patch }
  出.enabled = !!出.enabled
  if (!采样率们.includes(Number(出.sampleRate))) 出.sampleRate = 24000
  let t = Number(出.timeoutMs); 出.timeoutMs = Number.isFinite(t) && t >= 10000 && t <= 600000 ? Math.round(t) : 240000
  出.hintEnabled = !!出.hintEnabled
  出.hintText = typeof 出.hintText === 'string' ? 出.hintText : 旋钮默认值.hintText
  return 出
}

/** 路径类字段必须绝对路径、resolve 后不含 `..`；空值原样返回空字符串。ffmpeg 例外。 */
function 净路径(v, 允许命令名 = false) {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  if (允许命令名 && !s.includes('/') && !s.includes('\\') && s === 'ffmpeg') return s
  const r = resolve(s)
  if (!s.startsWith('/') || r.split(sep).includes('..')) return ''
  return r
}

function clamp配置(配置) {
  const c = { ...JSON默认值(), ...配置 }
  c._版本 = 2
  c.cosyPython = 净路径(c.cosyPython)
  c.cosy脚本 = 净路径(c.cosy脚本)
  c.cosy仓库目录 = 净路径(c.cosy仓库目录)
  c.cosy参考音频 = 净路径(c.cosy参考音频)
  c.cosy模型目录 = 净路径(c.cosy模型目录)
  c.rvcPython = 净路径(c.rvcPython)
  c.rvc目录 = 净路径(c.rvc目录)
  c.模型目录 = 净路径(c.模型目录)
  c.音频目录 = 净路径(c.音频目录)
  c.部署目录 = 净路径(c.部署目录)
  c.ffmpeg = 净路径(c.ffmpeg, true) || 'ffmpeg'
  const 速 = Number(c.cosy语速); c.cosy语速 = Number.isFinite(速) && 速 >= 0.5 && 速 <= 2 ? 速 : 1.0
  const 留 = Number(c.音频保留数); c.音频保留数 = Number.isInteger(留) && 留 >= 10 && 留 <= 2000 ? 留 : 200
  c.声线 = Array.isArray(c.声线)
    ? c.声线.filter((v) => v && typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v.id))
    : []
  c.当前声线 = typeof c.当前声线 === 'string' ? c.当前声线 : '原声'
  return c
}

export function 读JSON() {
  let 文件 = {}
  try {
    if (existsSync(配置文件路径())) 文件 = JSON.parse(readFileSync(配置文件路径(), 'utf8'))
  } catch (e) {
    console.warn('[feiyu-say] 读配置失败，用默认值：' + String(e?.message || e))
  }
  return clamp配置(文件)
}

/** 原子写：tmp + rename；写前备份 .bak。 */
export function 写JSON(配置) {
  const 路径 = 配置文件路径()
  const 净 = clamp配置(配置)
  try {
    mkdirSync(dirname(路径), { recursive: true })
    if (existsSync(路径)) {
      const bak = 路径 + '.bak-' + Date.now()
      try { writeFileSync(bak, readFileSync(路径)) } catch {}
    }
    const tmp = 路径 + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(净, null, 2), 'utf8')
    renameSync(tmp, 路径)
    return true
  } catch (e) {
    console.warn('[feiyu-say] 写配置失败：' + String(e?.message || e))
    return false
  }
}

/** 声线列表：原声 + 配置显式 + 模型目录自动发现；每条带 `缺模型` 标记。 */
export function 声线列表(配置) {
  const 出 = [{ id: '原声', name: '原声（不换声，CosyVoice 直出）', noRvc: true, 缺模型: false }]
  const 已有 = new Set(['原声'])
  const 显式 = Array.isArray(配置.声线) ? 配置.声线 : []
  for (const v of 显式) {
    if (!v || !v.id) continue
    const 模 = 配置.模型目录 && v.model ? join(配置.模型目录, v.model) : ''
    出.push({ ...v, 缺模型: !!(v.model && !(模 && existsSync(模))) })
    已有.add(String(v.id))
  }
  const 目录 = String(配置.模型目录 || '')
  if (目录 && existsSync(目录)) {
    try {
      for (const 名 of readdirSync(目录)) {
        if (!名.toLowerCase().endsWith('.pth')) continue
        const id = basename(名, '.pth')
        if (已有.has(id)) continue
        const 索引 = 名.slice(0, -4) + '.index'
        出.push({ id, name: id, model: 名, index: existsSync(join(目录, 索引)) ? 索引 : '', 缺模型: false })
        已有.add(id)
      }
    } catch {}
  }
  return 出
}

export function 取声线(配置) {
  const 列表 = 声线列表(配置)
  return 列表.find((v) => String(v.id) === String(配置.当前声线)) || 列表[0] || { id: '原声', noRvc: true, 缺模型: false }
}

/**
 * v1 → v2 迁移（幂等）。返回是否发生过迁移。
 * 旧键（JSON 里的 总开关/语音提示/语音提示文案/超时毫秒）在 Config 可用时搬进旋钮并从 JSON 删除；
 * Config 不可用则保留在 JSON（读取端按别名兜底）。
 */
export function 迁移(配置, 写旋钮) {
  if ((配置._版本 || 0) >= 2) return false
  const 旧键 = { 总开关: 'enabled', 语音提示: 'hintEnabled', 语音提示文案: 'hintText', 超时毫秒: 'timeoutMs' }
  const patch = {}
  let 有旧 = false
  for (const [旧, 新] of Object.entries(旧键)) {
    const v = 配置[旧]
    if (v !== undefined) { patch[新] = v; 有旧 = true }
  }
  const 净 = { ...配置 }
  for (const 旧 of Object.keys(旧键)) delete 净[旧]

  if (有旧) {
    let 写成功 = false
    if (typeof 写旋钮 === 'function') {
      try { 写旋钮(clamp旋钮(patch)); 写成功 = true } catch (e) { console.warn('[feiyu-say] 迁移写旋钮失败：' + String(e?.message || e)) }
    }
    if (!写成功) Object.assign(净, clamp旋钮(patch)) // 兜底：写 JSON 同名新键
  }
  净._版本 = 2
  写JSON(净)
  return true
}
