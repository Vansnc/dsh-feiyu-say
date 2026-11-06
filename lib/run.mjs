// dsh-feiyu-say · 命令执行器（只剩 ffmpeg 用）。

import { spawn } from 'node:child_process'

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
    } catch {
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
