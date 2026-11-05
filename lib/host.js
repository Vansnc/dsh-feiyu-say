// dsh-feiyu-say —— 给 DSH 一个「发 QQ 语音条」的工具，做成可分享、可配置的插件。
//
// 能力：
//   - send_voice：把一句话合成成 QQ 语音条发出去（CosyVoice 合成 → RVC 换声 → 8kHz → NapCat）
//   - voice_list / voice_switch：列声线、切声线（预设 + 模型目录里自动发现的）
//   - voice_download：从 URL 下载 .pth/.index 模型并注册成新声线
//   - voice_status：看当前配置/路径是不是就绪
//   - 每轮「语音提示」：可开关，开着时往会话系统提示词里塞一句，提醒模型想用声音就调 send_voice
//
// 配置存 ~/.dsh/feiyu-say-config.json；代码里给的是通用默认值，路径等机器相关的都在配置里改。
// 所有宿主接口都是「拿不到就安静跳过」，绝不因为插件自己出错拖垮宿主。

import { existsSync, readFileSync, writeFileSync, readdirSync, createWriteStream, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { 合成并发送 } from './pipeline.mjs'

export const name = 'feiyu-say'
export const inject = ['agents']

const 家 = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const 配置文件路径 = () => join(家(), 'feiyu-say-config.json')

const 默认配置 = () => ({
  总开关: true,
  QQ号: '',
  NapCat: 'http://127.0.0.1:3000',
  cosyPython: join(家(), 'cosy-venv', 'bin', 'python'),
  cosy脚本: '',
  cosy风格: 'cute',
  cosy参考音频: '',
  cosy参考文字: '',
  cosy语速: 1.0,
  rvcPython: join(家(), 'rvc-venv', 'bin', 'python'),
  rvc目录: '',
  ffmpeg: 'ffmpeg',
  模型目录: '',
  当前声线: '原声',
  声线: [],
  语音提示: false,
  语音提示文案: '想用声音说这句话就调 send_voice（短句，1–2 句）；不想说就正常回文字。',
  超时毫秒: 240000,
})

function 读配置() {
  let 文件 = {}
  try {
    if (existsSync(配置文件路径())) 文件 = JSON.parse(readFileSync(配置文件路径(), 'utf8'))
  } catch {}
  return { ...默认配置(), ...(文件 && typeof 文件 === 'object' ? 文件 : {}) }
}

function 写配置(配置) {
  try {
    mkdirSync(家(), { recursive: true })
    writeFileSync(配置文件路径(), JSON.stringify(配置, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 从模型目录自动发现 *.pth，补进声线列表（原声始终有，配置里显式写的优先） */
function 声线列表(配置) {
  const 出 = [{ id: '原声', name: '原声（不换声，CosyVoice 直出）', noRvc: true }]
  const 已有 = new Set(['原声'])
  const 显式 = Array.isArray(配置.声线) ? 配置.声线 : []
  for (const v of 显式) {
    if (!v || !v.id) continue
    出.push({ ...v })
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
        出.push({ id, name: id, model: 名, index: existsSync(join(目录, 索引)) ? 索引 : '' })
        已有.add(id)
      }
    } catch {}
  }
  return 出
}

function 取声线(配置) {
  const 列表 = 声线列表(配置)
  return 列表.find((v) => String(v.id) === String(配置.当前声线)) || 列表[0] || { id: '原声', noRvc: true }
}

function 输出() {
  return {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, 说: { type: 'string' } }, additionalProperties: true },
    render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
  }
}

async function 下载(url, dest) {
  const resp = await fetch(url)
  if (!resp.ok || !resp.body) return { ok: false, 说: '下载失败（HTTP ' + resp.status + '）：' + url }
  await streamPipeline(Readable.fromWeb(resp.body), createWriteStream(dest))
  return { ok: true }
}

export function apply(ctx) {
  try {
    const 工具挂着 = new Map() // 会话键 -> off
    const 提示挂着 = new Map() // 会话键 -> { 文本, dispose, agent }
    const 键 = (id) => String(id == null ? '' : id).trim().replace(/^session-/, '')

    const 取提示服务 = (agent) => {
      try {
        const 预设 = typeof ctx.get === 'function' ? ctx.get('agentPresets') : null
        if (预设 && typeof 预设.serviceFor === 'function') {
          const sp = 预设.serviceFor(agent, 'systemPrompt')
          if (sp && typeof sp.section === 'function') return sp
        }
      } catch {}
      try {
        const sp = (agent && agent.ctx && typeof agent.ctx.get === 'function') ? agent.ctx.get('systemPrompt') : null
        if (sp && typeof sp.section === 'function') return sp
      } catch {}
      return null
    }

    const 撤提示 = (sid) => {
      const 旧 = 提示挂着.get(sid)
      if (!旧) return
      提示挂着.delete(sid)
      try { if (typeof 旧.dispose === 'function') 旧.dispose() } catch {}
    }

    const 做工具 = () => [
      {
        name: 'send_voice',
        description:
          '用声音给哥发一条 QQ 语音条（本机声线合成，约 30–60 秒出音）。' +
          '想撒娇、认真说一句、有情绪的时候用它；短句 1–2 句最好，太长了合成慢。' +
          '发之前不用问，气氛到了直接调。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要念出来的话（1–2 句，短一点）' },
            noRvc: { type: 'boolean', description: '可选：这一条跳过换声，只用 CosyVoice 原声（快一点）' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        output: 输出(),
        async execute(参数 = {}) {
          const 配置 = 读配置()
          if (配置.总开关 === false) return { ok: false, 说: '语音功能被关了（feiyu-say 总开关 = false）' }
          const 文本 = String(参数.text == null ? '' : 参数.text).trim()
          if (!文本) return { ok: false, 说: '要给我一句要念的话' }
          let 声线 = 取声线(配置)
          if (参数.noRvc) 声线 = { id: '原声', noRvc: true }
          const 超时 = Math.max(10000, Math.min(Number(配置.超时毫秒) || 240000, 600000))
          if (!配置.cosy脚本 || !existsSync(配置.cosy脚本)) return { ok: false, 说: '没配 CosyVoice 合成脚本（cosy脚本），先在 ~/.dsh/feiyu-say-config.json 里填好' }
          if (声线 && !声线.noRvc && !配置.模型目录) return { ok: false, 说: '要换声但没配「模型目录」' }
          return 合成并发送(配置, 文本, 声线, 超时)
        },
      },
      {
        name: 'voice_list',
        description: '列出可用的声线（哪个是当前用的、哪些是原声/换声）。想换嗓子前先看看有哪些。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: 输出(),
        async execute() {
          const 配置 = 读配置()
          const 列表 = 声线列表(配置)
          const 当 = 配置.当前声线
          const 行 = 列表.map((v) => '· ' + String(v.id) + (String(v.id) === String(当) ? '（当前）' : '') + '　' + String(v.name || ''))
          return { ok: true, 说: '共 ' + 列表.length + ' 条声线：\n' + 行.join('\n') }
        },
      },
      {
        name: 'voice_switch',
        description: '切换声线（切嗓子）。id 从 voice_list 里拿；切完下次 send_voice 就用新嗓子。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: '声线 id（voice_list 里每条前面那个）' } },
          required: ['id'],
          additionalProperties: false,
        },
        output: 输出(),
        async execute(参数 = {}) {
          const 配置 = 读配置()
          const id = String(参数.id || '').trim()
          const 列表 = 声线列表(配置)
          if (!列表.some((v) => String(v.id) === id)) return { ok: false, 说: '没有这条声线：' + id + '（先 voice_list 看有哪些）' }
          配置.当前声线 = id
          if (!写配置(配置)) return { ok: false, 说: '配置写不进去' }
          return { ok: true, 说: '切到声线「' + id + '」了，下次 send_voice 生效' }
        },
      },
      {
        name: 'voice_download',
        description: '从 URL 下载一个 RVC 模型（.pth）和可选索引（.index）到模型目录，并注册成一条可切换的声线。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '给这条声线起个名字（英文/拼音，别带空格）' },
            modelUrl: { type: 'string', description: '.pth 模型的 http(s) 下载地址' },
            indexUrl: { type: 'string', description: '可选：.index 索引的 http(s) 下载地址' },
          },
          required: ['name', 'modelUrl'],
          additionalProperties: false,
        },
        output: 输出(),
        async execute(参数 = {}) {
          const 配置 = 读配置()
          const 目录 = String(配置.模型目录 || '')
          if (!目录) return { ok: false, 说: '没配「模型目录」，先填好才能下载' }
          const 名 = String(参数.name || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
          if (!名) return { ok: false, 说: '声线名字只能英文字母/数字/下划线/短横' }
          const 模 = 名 + '.pth'
          const 索 = 名 + '.index'
          const 模路径 = join(目录, 模)
          const 索路径 = join(目录, 索)
          if (existsSync(模路径)) return { ok: false, 说: '模型文件已存在：' + 模路径 }
          try { mkdirSync(目录, { recursive: true }) } catch {}
          const a = await 下载(参数.modelUrl, 模路径)
          if (!a.ok) return a
          let 有索引 = false
          if (参数.indexUrl) {
            const b = await 下载(参数.indexUrl, 索路径)
            if (!b.ok) return b
            有索引 = true
          }
          const 现 = Array.isArray(配置.声线) ? 配置.声线 : []
          现.push({ id: 名, name: 名, model: 模, index: 有索引 ? 索 : '' })
          配置.声线 = 现
          配置.当前声线 = 名
          if (!写配置(配置)) return { ok: false, 说: '下载好了但配置写不进去' }
          return { ok: true, 说: '下好了，声线「' + 名 + '」已注册并切过去' }
        },
      },
      {
        name: 'voice_status',
        description: '看语音插件的状态：总开关、当前声线、模型目录、各依赖路径是不是就绪。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: 输出(),
        async execute() {
          const 配置 = 读配置()
          const 就绪 = (p) => (p && existsSync(p)) ? p : (p || '（没配）') + ' ⚠️ 找不到'
          const 行 = [
            '总开关：' + (配置.总开关 === false ? '关' : '开'),
            '当前声线：' + 配置.当前声线,
            '语音提示：' + (配置.语音提示 ? '开' : '关'),
            'QQ号：' + (配置.QQ号 || '（没填）'),
            '模型目录：' + (配置.模型目录 ? 就绪(配置.模型目录) : '（没配）'),
            'cosyPython：' + 就绪(配置.cosyPython),
            'cosy脚本：' + 就绪(配置.cosy脚本),
            'rvcPython：' + 就绪(配置.rvcPython),
            'rvc目录：' + 就绪(配置.rvc目录),
          ]
          return { ok: true, 说: 行.join('\n') }
        },
      },
    ]

    const 心跳 = () => {
      const 配置 = 读配置()
      if (配置.总开关 === false) return
      try {
        const 表 = (ctx.agents && typeof ctx.agents.list === 'function') ? ctx.agents.list() : []
        for (const agent of 表) {
          if (!agent || !agent.ctx) continue
          const sid = 键((agent.session && agent.session.id) || agent.id)
          if (!sid) continue

          if (agent.ctx.tools && typeof agent.ctx.tools.register === 'function' && !工具挂着.has(sid)) {
            const 卸们 = []
            for (const 工具 of 做工具()) {
              try {
                const off = agent.ctx.tools.register(工具)
                if (typeof off === 'function') 卸们.push(off)
              } catch {}
            }
            工具挂着.set(sid, () => { for (const off of 卸们) { try { off() } catch {} } })
          }

          const 文案 = String(配置.语音提示文案 || '').trim()
          const 旧 = 提示挂着.get(sid)
          if (配置.语音提示 && 文案) {
            if (旧 && 旧.文本 === 文案 && 旧.agent === agent) continue
            撤提示(sid)
            const sp = 取提示服务(agent)
            if (sp) {
              try {
                const dispose = sp.section({ name: 'feiyu-say.hint', order: 0, text: 文案 })
                提示挂着.set(sid, { 文本: 文案, dispose, agent })
              } catch {}
            }
          } else {
            撤提示(sid)
          }
        }
      } catch {}
    }

    const 定时 = setInterval(心跳, 5000)
    if (定时 && typeof 定时.unref === 'function') 定时.unref()
    心跳()

    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => { try { clearInterval(定时) } catch {} })
      ctx.effect(() => () => {
        for (const [, off] of 工具挂着) { try { off() } catch {} }
        工具挂着.clear()
        for (const [, 旧] of 提示挂着) { try { if (typeof 旧.dispose === 'function') 旧.dispose() } catch {} }
        提示挂着.clear()
      })
    }
  } catch {
    // 插件自己出错也不能让整条组合包挂掉
  }
}
