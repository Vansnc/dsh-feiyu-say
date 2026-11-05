// dsh-feiyu-say · 插件入口：Config、路由、agent 生命周期、配置协调。
// 本机 CosyVoice + RVC 合成语音 → 输出 WAV，可在线试听；不绑定任何 IM。

import { loadHostDeps } from './hostdeps.mjs'
import { 读JSON, 写JSON, JSON默认值, 旋钮默认值, clamp旋钮, 声线列表, 取声线, 迁移 } from './config.mjs'
import { 读部署状态, 开始部署, 自检 } from './deploy.mjs'
import { 处理音频 } from './audio.mjs'
import { 做工具 } from './tools.mjs'
import { 合成 } from './pipeline.mjs'

export const name = 'feiyu-say'
export const inject = ['agents', 'webServer']

const hostDeps = await loadHostDeps()
const z = hostDeps.z

export const Config = !z ? undefined : z.object({
  enabled: z.boolean().default(true).extra('volatile', true),
  sampleRate: z.number().default(24000).extra('volatile', true),
  hintEnabled: z.boolean().default(false).extra('volatile', true),
  hintText: z.string().default(旋钮默认值.hintText).extra('volatile', true),
  timeoutMs: z.number().default(240000).extra('volatile', true),
})

export function apply(ctx, config) {
  const 回 = (res, o) => {
    try { res.setHeader?.('content-type', 'application/json; charset=utf-8'); res.end?.(JSON.stringify(o)) } catch {}
  }
  const 读体 = async (req) => {
    let body = ''
    try { for await (const chunk of req) body += chunk } catch {}
    try { return JSON.parse(body || '{}') } catch { return {} }
  }
  const 取源 = () => { try { return ctx.webServer.getOrigin() } catch { return 'http://127.0.0.1' } }

  // ── 旋钮（Config 5 项）──
  const 设置行 = () => {
    try { return (ctx.get('settings')?.describe?.() || []).find((d) => String(d.ns) === 'feiyu-say') || null } catch { return null }
  }
  const 解 = (v) => (v != null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v)
  const 解对象 = (o) => { const r = {}; for (const [k, v] of Object.entries(o || {})) r[k] = 解(v); return r }
  const 旋钮 = () => {
    const j = 读JSON()
    const 别名 = {}
    for (const k of Object.keys(旋钮默认值)) if (j[k] !== undefined) 别名[k] = j[k]
    return clamp旋钮({ ...旋钮默认值, ...别名, ...解对象(config), ...解对象(设置行()?.value) })
  }
  const 等设置行 = (ms) => new Promise((resolve) => {
    const 到 = Date.now() + ms
    const 试 = () => { const 行 = 设置行(); if (行) return resolve(行); if (Date.now() < 到) return setTimeout(试, 100); resolve(null) }
    试()
  })
  const 写旋钮 = async (patch) => {
    const 洁 = clamp旋钮(patch)
    const 行 = 设置行() || await 等设置行(600)
    const svc = ctx.get('settings')
    if (行 && svc && typeof svc.update === 'function') {
      try { await svc.update(行.ns, 洁, 行.revision) }
      catch (e) {
        const 新 = 设置行() || await 等设置行(600)
        if (新 && typeof svc.update === 'function') await svc.update(新.ns, 洁, 新.revision)
        else throw e
      }
      if (config && typeof config === 'object') Object.assign(config, 洁)
    } else {
      const j = 读JSON(); 写JSON({ ...j, ...洁 })
    }
  }
  const 生效配置 = () => {
    const j = 读JSON()
    const 钮 = 旋钮()
    return { ...j, enabled: 钮.enabled, sampleRate: 钮.sampleRate, hintEnabled: 钮.hintEnabled, hintText: 钮.hintText, timeoutMs: 钮.timeoutMs }
  }

  // ── 迁移 v1 → v2 ──
  try { 迁移(读JSON(), (p) => { void 写旋钮(p) }) } catch (e) { console.warn('[feiyu-say] 迁移失败：' + String(e?.message || e)) }

  // ── 路由 ──
  const 路由 = (kind, path, handler) => {
    try { ctx.effect(() => ctx.webServer.register({ kind, path, handler })) } catch (e) { console.warn('[feiyu-say] 注册路由失败：' + path + ' ' + String(e?.message || e)) }
  }
  const 只认JSON = (handler) => async (req, res) => {
    if (String(req.method || 'GET').toUpperCase() === 'POST' && !(req.headers && String(req.headers['content-type'] || '').includes('application/json'))) {
      return 回(res, { ok: false, 说: '要用 application/json 提交' })
    }
    return handler(req, res)
  }

  路由('exact', '/feiyu-say/config', 只认JSON(async (req, res) => {
    try {
      if (String(req.method || 'GET').toUpperCase() === 'POST') {
        const 来 = await 读体(req)
        const 钮键 = Object.keys(旋钮默认值)
        const JSON键 = Object.keys(JSON默认值())
        const 允许 = new Set([...钮键, ...JSON键])
        const 未知 = Object.keys(来).filter((k) => !允许.has(k))
        if (未知.length) return 回(res, { ok: false, 说: '有未知字段被丢弃：' + 未知.join('、') })
        const 钮补丁 = {}; const 文件补丁 = {}
        for (const [k, v] of Object.entries(来)) { if (钮键.includes(k)) 钮补丁[k] = v; else 文件补丁[k] = v }
        let 旋钮结果 = '跳过', 文件结果 = '跳过'
        if (Object.keys(钮补丁).length) { try { await 写旋钮(钮补丁); 旋钮结果 = 'ok' } catch (e) { 旋钮结果 = '失败：' + String(e?.message || e) } }
        if (Object.keys(文件补丁).length) { 文件结果 = 写JSON({ ...读JSON(), ...文件补丁 }) ? 'ok' : '失败' }
        return 回(res, { ok: true, 说: '已保存', 写入: { 旋钮: 旋钮结果, 文件: 文件结果 } })
      }
      return 回(res, { ok: true, 配置: 生效配置() })
    } catch (e) { return 回(res, { ok: false, 说: String(e?.message || e) }) }
  }))

  路由('exact', '/feiyu-say/voices', 只认JSON(async (req, res) => {
    try {
      if (String(req.method || 'GET').toUpperCase() === 'POST') {
        const 来 = await 读体(req)
        const 配置 = 生效配置()
        const 目录 = String(配置.模型目录 || '')
        if (!目录) return 回(res, { ok: false, 说: '先配好「模型目录」（高级设置里）' })
        const 名 = String(来.name || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
        if (!名) return 回(res, { ok: false, 说: '声线名字只能英文/数字/下划线/短横' })
        const { mkdirSync, existsSync, copyFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        try { mkdirSync(目录, { recursive: true }) } catch {}
        const 落地 = async (源, 后缀) => {
          const 目标 = join(目录, 名 + 后缀)
          if (/^https?:\/\//i.test(源)) { const { 下载 } = await import('./run.mjs'); const r = await 下载(源, 目标); return r.ok }
          if (existsSync(源)) { copyFileSync(源, 目标); return true }
          return false
        }
        const 模源 = String(来.model || '').trim()
        if (!模源) return 回(res, { ok: false, 说: '要给模型文件（.pth 路径或 URL）' })
        if (!(await 落地(模源, '.pth'))) return 回(res, { ok: false, 说: '模型文件拿不到：' + 模源 })
        let 索 = ''
        const 索源 = String(来.index || '').trim()
        if (索源) { if (!(await 落地(索源, '.index'))) return 回(res, { ok: false, 说: 'index 文件拿不到：' + 索源 }); 索 = 名 + '.index' }
        const 现 = Array.isArray(配置.声线) ? 配置.声线.filter((v) => v && v.id !== 名) : []
        现.push({ id: 名, name: 名, model: 名 + '.pth', index: 索 })
        if (!写JSON({ ...配置, 声线: 现, 当前声线: 名 })) return 回(res, { ok: false, 说: '导入好了但配置写不进去' })
        return 回(res, { ok: true, 说: '已导入声线「' + 名 + '」并切过去' })
      }
      const 配置 = 生效配置()
      return 回(res, { ok: true, 声线: 声线列表(配置), 当前: 配置.当前声线 })
    } catch (e) { return 回(res, { ok: false, 说: String(e?.message || e) }) }
  }))

  路由('exact', '/feiyu-say/deploy', async (req, res) => {
    try {
      if (String(req.method || 'GET').toUpperCase() === 'POST') return 回(res, await 开始部署(生效配置()))
      return 回(res, { ok: true, 部署: 读部署状态() })
    } catch (e) { return 回(res, { ok: false, 说: String(e?.message || e) }) }
  })

  路由('exact', '/feiyu-say/selfcheck', 只认JSON(async (req, res) => {
    try { return 回(res, await 自检(生效配置())) } catch (e) { return 回(res, { ok: false, 说: String(e?.message || e) }) }
  }))

  路由('exact', '/feiyu-say/preview', 只认JSON(async (req, res) => {
    try {
      const 来 = await 读体(req)
      const 配置 = 生效配置()
      const 文本 = String(来.text || '这是试听，一二三四五。').slice(0, 120)
      const 声线 = 来.voice ? (声线列表(配置).find((v) => String(v.id) === String(来.voice)) || 取声线(配置)) : 取声线(配置)
      const 率 = 来.sampleRate != null ? Number(来.sampleRate) : 配置.sampleRate
      const 结果 = await 合成(配置, 文本, 声线, 率, 配置.timeoutMs)
      if (!结果.ok) return 回(res, 结果)
      return 回(res, { ok: true, url: 取源() + '/feiyu-say/audio/' + encodeURIComponent(结果.文件名), path: 结果.路径, 声线: 结果.声线, 采样率: 结果.采样率, 耗时ms: 结果.耗时ms })
    } catch (e) { return 回(res, { ok: false, 说: String(e?.message || e) }) }
  }))

  路由('prefix', '/feiyu-say/audio/', (req, res) => 处理音频(req, res, 生效配置().音频目录))

  // ── agent 生命周期（替换 5 秒轮询）──
  const agent注册 = new Map()
  const 取提示服务 = (agent) => {
    try { if (agent?.ctx?.systemPrompt && typeof agent.ctx.systemPrompt.section === 'function') return agent.ctx.systemPrompt } catch {}
    try { const sp = agent?.ctx?.get?.('systemPrompt'); if (sp && typeof sp.section === 'function') return sp } catch {}
    return null
  }

  function 装到(agent) {
    const sid = String(agent.id || agent.session?.id || '')
    if (!sid || agent注册.has(sid)) return
    const 配置 = 生效配置()
    try {
      const off = agent.ctx.effect(() => {
        const 卸 = []
        if (配置.enabled) {
          for (const 工具 of 做工具({ 取配置: 生效配置, 取源 })) {
            try { const f = agent.ctx.tools.register(工具); if (typeof f === 'function') 卸.push(f) } catch (e) { console.warn('[feiyu-say] 工具注册失败：' + 工具.name + ' ' + String(e?.message || e)) }
          }
        }
        if (配置.hintEnabled) {
          const sp = 取提示服务(agent)
          if (sp) {
            try { const f = sp.section({ name: 'feiyu-say.hint', order: 90, text: () => 生效配置().hintText }); if (typeof f === 'function') 卸.push(f) } catch (e) { console.warn('[feiyu-say] 提示注入失败：' + String(e?.message || e)) }
          }
        }
        return () => { for (const f of 卸) { try { f() } catch {} } }
      })
      agent注册.set(sid, off)
    } catch (e) { console.warn('[feiyu-say] 给 agent 装卸失败：' + String(e?.message || e)) }
  }

  ctx.on('agent/created', ({ agent }) => { if (agent) 装到(agent) })
  ctx.on('agent/disposed', ({ agent }) => {
    const sid = String(agent?.id || '')
    const off = agent注册.get(sid); agent注册.delete(sid)
    try { off?.() } catch {}
  })
  ctx.on('settings/document-updated', (ns) => {
    if (String(ns) !== 'feiyu-say') return
    for (const agent of (ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() : [])) {
      const sid = String(agent.id || '')
      try { agent注册.get(sid)?.() } catch {}
      agent注册.delete(sid)
      装到(agent)
    }
  })

  ctx.effect(() => () => {
    for (const [, off] of agent注册) { try { off() } catch {} }
    agent注册.clear()
  })
}
