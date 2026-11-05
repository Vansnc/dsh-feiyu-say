// dsh-feiyu-say · 共享命令执行器 + 下载器（deploy / pipeline / tools 共用）。

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline as streamPipeline } from 'node:stream/promises'
import { dirname } from 'node:path'

/** 跑一个命令，等它结束；返回 { code, stdout, stderr, 耗时 }。code!==0 由调用方决定怎么处理。 */
export async function 跑命令(cmd, args, { cwd, env, timeoutMs = 600000 } = {}) {
  const 起 = Date.now()
  return new Promise((resolve) => {
    let 子
    try {
      子 = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: cwd || undefined,
        env: { ...process.env, ...(env || {}) },
        ...(process.platform === 'win32' ? {} : { detached: true }),
      })
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: '命令不存在：' + cmd, 耗时: 0 })
    }
    let 出 = '', 错 = ''
    子.stdout?.on('data', (d) => { 出 = (出 + String(d)).slice(-40000) })
    子.stderr?.on('data', (d) => { 错 = (错 + String(d)).slice(-40000) })
    const 钟 = setTimeout(() => {
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(子.pid), '/T', '/F'])
        else if (子.pid) process.kill(-子.pid, 'SIGKILL')
      } catch {}
    }, timeoutMs)
    子.on('error', (e) => { clearTimeout(钟); resolve({ code: -1, stdout: 出, stderr: String(e?.message || e), 耗时: Date.now() - 起 }) })
    子.on('close', (code) => { clearTimeout(钟); resolve({ code: code ?? -1, stdout: 出, stderr: 错, 耗时: Date.now() - 起 }) })
  })
}

/** 流式下载到目标（先写 .part，成功后 rename）。返回 { ok, 说? }。 */
export async function 下载(url, 目标) {
  const 是HTTP = /^https?:\/\//i.test(url)
  if (!是HTTP) return { ok: false, 说: '只支持 http(s) 下载：' + url }
  try {
    const resp = await fetch(url, { redirect: 'follow' })
    if (!resp.ok || !resp.body) return { ok: false, 说: '下载失败（HTTP ' + resp.status + '）：' + url }
    mkdirSync(dirname(目标), { recursive: true })
    const part = 目标 + '.part'
    await streamPipeline(Readable.fromWeb(resp.body), createWriteStream(part))
    renameSync(part, 目标)
    return { ok: true }
  } catch (e) {
    try { if (existsSync(目标 + '.part')) unlinkSync(目标 + '.part') } catch {}
    return { ok: false, 说: '下载出错：' + String(e?.message || e) }
  }
}
