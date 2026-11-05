// 测试替身：部署编排测试用的假执行器。
// 不真的起子进程，只按命令内容伪造返回值与产物，用来验证 跑部署() 的阶段编排本身。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const 造 = (p, 大小 = 8) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, Buffer.alloc(大小)); return p }
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '', 耗时: 1 })

export async function 下载(url, 目标) {
  mkdirSync(dirname(目标), { recursive: true })
  writeFileSync(目标, Buffer.alloc(2 * 1024 * 1024))
  return { ok: true }
}

export async function 跑命令(cmd, args = []) {
  const c = String(cmd)
  const 串 = args.join(' ')

  // ffmpeg 假装没装 → pipeline 必须走 resample.py 兜底
  if (c.includes('ffmpeg')) return { code: 1, stdout: '', stderr: 'not installed', 耗时: 1 }

  if (c.includes('python') || c === 'py') {
    if (串.includes('version_info')) return ok('[3,10,"C:\\\\fake\\\\python.exe"]\n')
    if (串.includes('resample.py')) { 造(args[2], 4000); return ok() }
    if (串.includes('cosy_say.py')) { 造(args[args.indexOf('--out') + 1], 12000); return ok() }
    if (串 === '-V' || 串.includes('--version')) return ok('Python 3.10.22\n')
    if (串.includes('-m venv')) { 造(join(args[args.indexOf('-m') + 2], 'Scripts', 'python.exe'), 100); return ok() }
    if (串.includes('-m pip')) return ok()
    if (串.includes('import cosyvoice')) return ok()
    if (串.includes('snapshot_download')) {
      const m = 串.match(/local_dir='([^']+)'/)
      if (m) 造(join(m[1], 'cosyvoice2.yaml'), 100)
      return ok()
    }
    return ok()
  }

  if (c === 'git') {
    if (串.startsWith('clone')) {
      const 目录 = args[args.length - 1]
      造(join(目录, '.git', 'HEAD'), 10)
      造(join(目录, 'third_party', 'Matcha-TTS', 'matcha', '__init__.py'), 10)
      return ok()
    }
    if (串.includes('submodule')) {
      const 仓库 = args[args.indexOf('-C') + 1]
      造(join(仓库, 'third_party', 'Matcha-TTS', 'matcha', '__init__.py'), 10)
      return ok()
    }
    return ok('git version 2.51.0\n')
  }

  return ok()
}
