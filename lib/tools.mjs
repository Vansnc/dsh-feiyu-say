// dsh-feiyu-say · 工具定义工厂。依赖一个 `取配置` getter 和 `取源`（webServer.getOrigin）。

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { 合成 } from './pipeline.mjs'
import { 声线列表, 取声线, 写JSON } from './config.mjs'
import { 下载 } from './run.mjs'
import { 自检 } from './deploy.mjs'

const 采样率们 = [8000, 16000, 22050, 24000, 44100]

function 文本输出() {
  return {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, 说: { type: 'string' } }, additionalProperties: true },
    render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
  }
}

export function 做工具({ 取配置, 取源 }) {
  const 回URL = (文件名) => { try { return 取源() + '/feiyu-say/audio/' + encodeURIComponent(文件名) } catch { return '' } }

  return [
    {
      name: 'send_voice',
      description:
        '合成一句语音（本机 CosyVoice + 可选 RVC 换声），输出 WAV 文件，约 30–60 秒出音。' +
        '想撒娇、认真说一句、有情绪的时候用它；短句 1–2 句最好。' +
        '要发 QQ 语音条时传 sampleRate: 8000（QQ 会把 24k 转坏）；只在网页/本地听用默认。' +
        '合成完返回文件路径和试听 URL，怎么发出去由当前会话的传输方式决定。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要念出来的话（1–2 句，短一点）' },
          sampleRate: { type: 'number', enum: 采样率们, description: '可选：这次输出的采样率。发 QQ 语音条用 8000；不传用全局默认' },
          noRvc: { type: 'boolean', description: '可选：这一条跳过换声，只用 CosyVoice 原声（快一点）' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, 说: { type: 'string' }, 路径: { type: 'string' }, url: { type: 'string' }, 声线: { type: 'string' }, 采样率: { type: 'number' }, 耗时ms: { type: 'number' } }, additionalProperties: true },
        render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') + ((值 && 值.路径) ? '\n文件：' + 值.路径 : '') + ((值 && 值.url) ? '\n试听：' + 值.url : '') }],
      },
      async execute(参数 = {}) {
        const 配置 = 取配置()
        if (配置.enabled === false) return { ok: false, 说: '语音功能被关了（设置 → 插件 → feiyu-say 的总开关）' }
        const 文本 = String(参数.text ?? '').trim()
        if (!文本) return { ok: false, 说: '要给我一句要念的话' }
        let 声线 = 取声线(配置)
        if (参数.noRvc) 声线 = { id: '原声', noRvc: true }
        const 率 = 参数.sampleRate != null ? Number(参数.sampleRate) : 配置.sampleRate
        const 结果 = await 合成(配置, 文本, 声线, 率, 配置.timeoutMs)
        if (!结果.ok) return 结果
        return { ok: true, 说: '语音合成好了', 路径: 结果.路径, url: 回URL(结果.文件名), 声线: 结果.声线, 采样率: 结果.采样率, 耗时ms: 结果.耗时ms }
      },
    },
    {
      name: 'voice_list',
      description: '列出可用的声线（哪个是当前用的、哪些缺模型）。想换嗓子前先看看有哪些。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: 文本输出(),
      async execute() {
        const 配置 = 取配置()
        const 列表 = 声线列表(配置)
        const 当 = 配置.当前声线
        const 行 = 列表.map((v) => '· ' + String(v.id) + (String(v.id) === String(当) ? '（当前）' : '') + (v.缺模型 ? '（缺模型）' : '') + '　' + String(v.name || ''))
        行.push('当前默认采样率：' + (配置.sampleRate || 24000) + 'Hz')
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
      output: 文本输出(),
      async execute(参数 = {}) {
        const 配置 = 取配置()
        const id = String(参数.id || '').trim()
        const 列表 = 声线列表(配置)
        const 目标 = 列表.find((v) => String(v.id) === id)
        if (!目标) return { ok: false, 说: '没有这条声线：' + id + '（先 voice_list 看有哪些）' }
        const 净 = { ...配置, 当前声线: id }
        if (!写JSON(净)) return { ok: false, 说: '配置没写进去，检查 ~/.dsh 写权限' }
        return 目标.缺模型
          ? { ok: true, 说: '已切到「' + id + '」，但它的模型文件不存在，下一次 send_voice 会报错。' }
          : { ok: true, 说: '切到声线「' + id + '」了，下次 send_voice 生效' }
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
      output: 文本输出(),
      async execute(参数 = {}) {
        const 配置 = 取配置()
        const 目录 = String(配置.模型目录 || '')
        if (!目录) return { ok: false, 说: '没配「模型目录」，去「鱼的声音 → 高级」填好才能下载' }
        const 名 = String(参数.name || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
        if (!名) return { ok: false, 说: '声线名字只能英文字母/数字/下划线/短横' }
        try { mkdirSync(目录, { recursive: true }) } catch (e) { return { ok: false, 说: '模型目录建不了：' + String(e?.message || e) } }
        const a = await 下载(参数.modelUrl, join(目录, 名 + '.pth'))
        if (!a.ok) return a
        let 索 = ''
        if (参数.indexUrl) {
          const b = await 下载(参数.indexUrl, join(目录, 名 + '.index'))
          if (!b.ok) return b
          索 = 名 + '.index'
        }
        const 现 = Array.isArray(配置.声线) ? 配置.声线.filter((v) => v && v.id !== 名) : []
        现.push({ id: 名, name: 名, model: 名 + '.pth', index: 索 })
        const 净 = { ...配置, 声线: 现, 当前声线: 名 }
        if (!写JSON(净)) return { ok: false, 说: '下载好了但配置没写进去' }
        return { ok: true, 说: '下好了，声线「' + 名 + '」已注册并切过去' }
      },
    },
    {
      name: 'voice_status',
      description: '看语音插件的状态与依赖是否就绪。传 test=true 会额外真合成一句。',
      parameters: {
        type: 'object',
        properties: { test: { type: 'boolean', description: '可选：跑一句 1 秒真合成，验证整条链' } },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, 就绪: { type: 'boolean' }, 说: { type: 'string' }, 项: { type: 'array' } }, additionalProperties: true },
        render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
      },
      async execute(参数 = {}) {
        const 配置 = 取配置()
        const r = await 自检(配置)
        if (参数.test) {
          const 烟 = await 合成(配置, '这是自检，一句话。', 取声线(配置), 24000, 配置.timeoutMs)
          r.说 += '\n\n[试合成] ' + (烟.ok ? ('通过：' + 烟.耗时ms + 'ms，' + (烟.路径 || '')) : '失败：' + 烟.说)
        }
        return r
      },
    },
  ]
}
