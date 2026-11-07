// dsh-feiyu-say · 工具定义工厂（百炼单引擎）。依赖 `取配置` getter 和 `取源`（webServer.getOrigin）。

import { 合成 } from './pipeline.mjs'
import { 百炼自检 } from './bailian.mjs'
import { 音频绝对地址 } from './urls.mjs'

const 采样率们 = [8000, 16000, 22050, 24000, 44100]

function 文本输出() {
  return {
    schema: { type: 'object', properties: { ok: { type: 'boolean' }, 说: { type: 'string' } }, additionalProperties: true },
    render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
  }
}

export function 做工具({ 取配置, 取源 }) {
  // 聊天文本里给完整 URL（本机 / 转发都能直接打开）；页面里的 <audio> 不用它。
  const 回URL = (文件名) => 音频绝对地址(取源, 文件名)

  return [
    {
      name: 'send_voice',
      description:
        '合成一句语音（阿里百炼 TTS，约 1–3 秒），输出 WAV 文件。' +
        '想撒娇、认真说一句、有情绪的时候用它；短句 1–2 句最好。' +
        '要发 QQ 语音条时传 sampleRate: 8000（QQ 会把 24k 转坏）；只在网页/本地听用默认。' +
        '合成完返回文件路径和试听 URL。' +
        '若设置里开了「发 QQ 语音条」，合成完会自动转成 8k 语音条发到绑定的那个 QQ 私聊。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要念出来的话（1–2 句，短一点）' },
          sampleRate: { type: 'number', enum: 采样率们, description: '可选：这次输出的采样率。发 QQ 语音条用 8000；不传用全局默认' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' }, 说: { type: 'string' },
            路径: { type: 'string' }, url: { type: 'string' },
            音色: { type: 'string' }, 采样率: { type: 'number' }, 耗时ms: { type: 'number' },
          },
          additionalProperties: true,
        },
        render: (_参数, 值) => [{
          type: 'text',
          text: String((值 && 值.说) || '') + ((值 && 值.路径) ? '\n文件：' + 值.路径 : '') + ((值 && 值.url) ? '\n试听：' + 值.url : ''),
        }],
      },
      async execute(参数 = {}) {
        const 配置 = 取配置()
        if (配置.enabled === false) return { ok: false, 说: '语音功能被关了（设置 → 插件 → feiyu-say 的总开关）' }
        const 文本 = String(参数.text ?? '').trim()
        if (!文本) return { ok: false, 说: '要给我一句要念的话' }
        const 率 = 参数.sampleRate != null ? Number(参数.sampleRate) : 配置.sampleRate
        const 结果 = await 合成(配置, 文本, 率, 配置.timeoutMs)
        if (!结果.ok) return 结果
        return {
          ok: true,
          说: '语音合成好了',
          路径: 结果.路径,
          url: 回URL(结果.文件名),
          音色: 结果.音色,
          采样率: 结果.采样率,
          耗时ms: 结果.耗时ms,
        }
      },
    },
    {
      name: 'voice_list',
      description: '看当前用的是哪个百炼音色 / 模型 / 接口。想换音色去设置页改，或直接让用户改。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: 文本输出(),
      async execute() {
        const 配置 = 取配置()
        return {
          ok: true,
          说: [
            '引擎：阿里百炼（WebSocket）',
            '当前音色：' + (配置.百炼音色 || '（未填）'),
            '模型：' + (配置.百炼模型 || '（未填）'),
            '接口：' + (配置.百炼地址 || '（未填）'),
            '默认采样率：' + (配置.sampleRate || 24000) + 'Hz',
          ].join('\n'),
        }
      },
    },
    {
      name: 'voice_status',
      description: '看语音插件的状态：API Key / 模型 / 音色 / 接口 / ffmpeg 是否就绪。传 test=true 会额外真合成一句。',
      parameters: {
        type: 'object',
        properties: { test: { type: 'boolean', description: '可选：跑一句真合成，验证整条链' } },
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, 就绪: { type: 'boolean' }, 说: { type: 'string' }, 项: { type: 'array' } }, additionalProperties: true },
        render: (_参数, 值) => [{ type: 'text', text: String((值 && 值.说) || '') }],
      },
      async execute(参数 = {}) {
        const 配置 = 取配置()
        const r = await 百炼自检(配置)
        if (参数.test) {
          const 烟 = await 合成(配置, '这是自检，一句话。', 24000, 配置.timeoutMs)
          r.说 += '\n\n[试合成] ' + (烟.ok ? ('通过：' + 烟.耗时ms + 'ms，' + (烟.路径 || '')) : '失败：' + 烟.说)
        }
        return r
      },
    },
  ]
}
