// dsh-feiyu-say · Python 运行时解析：先找系统 Python，找不到就自己下一个托管运行时。
//
// 为什么要这段：一键部署的「一键」不能靠用户先手动装好 Python 3.10。
// macOS / Linux 一般自带 python3，直接用；Windows 全新机器连 python 都没有
// （`python` / `python3` 常常只是微软商店的 0 字节占位符，跑起来 exit 9009），
// 所以兜底走 uv 拉一份 python-build-standalone，落在部署目录里，不污染系统。

import { existsSync, readdirSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { 跑命令, 下载 } from './run.mjs'

const WIN = process.platform === 'win32'
const MAC = process.platform === 'darwin'

/** 最低可用版本：依赖清单里 transformers / torch 都要求 3.9+。 */
export const 最低版本 = [3, 9]
/** 首选版本：CosyVoice2 官方验证过 3.10；托管运行时优先拉这个。 */
export const 首选版本 = [3, 10]

// 只打印一行 JSON，避免各版本 python 的 banner / 编码差异
const 探针 = 'import sys,json;print(json.dumps([sys.version_info[0],sys.version_info[1],sys.executable]))'

function 比版本(a, b) {
  return (a?.[0] || 0) - (b?.[0] || 0) || (a?.[1] || 0) - (b?.[1] || 0)
}

function 版本串(v) { return Array.isArray(v) ? v.join('.') : String(v || '') }

/** 跑一次解释器：能跑通、能拿到版本和真实路径，才算这个候选可用。 */
async function 探(命令, 参数 = [], timeoutMs = 30000) {
  const r = await 跑命令(命令, [...参数, '-c', 探针], { timeoutMs })
  if (r.code !== 0) return null
  const 行 = String(r.stdout).trim().split(/\r?\n/).filter(Boolean).pop()
  if (!行) return null
  let 数据
  try { 数据 = JSON.parse(行) } catch { return null }
  if (!Array.isArray(数据) || 数据.length < 3) return null
  const 版本 = [Number(数据[0]), Number(数据[1])]
  if (!Number.isFinite(版本[0]) || !Number.isFinite(版本[1])) return null
  return { 版本, 路径: String(数据[2] || ''), 命令 }
}

/** 常见安装位置（PATH 没配好时的兜底；Windows 装机器默认路径 + Homebrew / 发行版路径）。 */
function 常见路径() {
  const 出 = []
  const 家 = process.env.USERPROFILE || process.env.HOME || ''
  if (WIN) {
    for (const v of ['3.10', '3.11', '3.9', '3.12']) {
      const 短 = v.replace('.', '')
      const 根们 = [
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python' + 短),
        process.env.ProgramFiles && join(process.env.ProgramFiles, 'Python' + 短),
        process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Python' + 短),
        'C:\\Python' + 短,
      ]
      for (const 根 of 根们) if (根) 出.push(join(根, 'python.exe'))
    }
  } else {
    for (const v of ['3.10', '3.11', '3.9', '3.12']) {
      if (MAC) 出.push(join('/opt/homebrew/bin', 'python' + v), join('/usr/local/bin', 'python' + v))
      出.push(join('/usr/bin', 'python' + v), join('/usr/local/bin', 'python' + v))
    }
    if (MAC) 出.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3')
    if (家) 出.push(join(家, '.pyenv', 'shims', 'python3'))
  }
  return 出
}

/** 候选清单：按「越靠前越优先」排，Windows 上 `py -3.10` 先试。 */
function 候选表(覆盖) {
  const 出 = []
  const 加 = (命令, 参数 = []) => {
    if (!命令) return
    if (出.some((x) => x.命令 === 命令 && x.参数.join(' ') === 参数.join(' '))) return
    出.push({ 命令, 参数 })
  }

  if (覆盖) 加(覆盖)
  // 保持旧行为：PYTHON 环境变量优先（老用户就是靠它绕过去的）
  if (process.env.PYTHON) 加(process.env.PYTHON)

  if (WIN) {
    for (const v of ['3.10', '3.11', '3.9', '3.12']) 加('py', ['-' + v])
    加('py', ['-3']); 加('py', [])
  } else {
    for (const v of ['3.10', '3.11', '3.9', '3.12']) 加('python' + v)
  }
  加('python3'); 加('python')
  for (const p of 常见路径()) 加(p)
  return 出
}

/** Windows 上从注册表读官方装机器登记的 InstallPath（PATH 里没有时最后一道兜底）。 */
async function 注册表Python() {
  if (!WIN) return []
  const 出 = []
  for (const v of ['3.10', '3.11', '3.9', '3.12']) {
    for (const 根 of ['HKCU', 'HKLM']) {
      const r = await 跑命令('reg', ['query', `${根}\\SOFTWARE\\Python\\PythonCore\\${v}\\InstallPath`, '/ve'], { timeoutMs: 15000 })
      if (r.code !== 0) continue
      const m = String(r.stdout).match(/REG_SZ\s+(.+?)\s*$/m)
      if (m) 出.push(join(m[1].trim(), 'python.exe'))
    }
  }
  return 出
}

/** uv 的平台包名（GitHub 固定 latest 下载路径，避免自己钉版本）。 */
function uv包名() {
  const 架构 = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (WIN) return `uv-${架构}-pc-windows-msvc.zip`
  if (MAC) return `uv-${架构}-apple-darwin.tar.gz`
  return `uv-${架构}-unknown-linux-gnu.tar.gz`
}

function 找uv(目录) {
  const 名 = WIN ? 'uv.exe' : 'uv'
  const 试 = [join(目录, 名)]
  try {
    for (const 子 of readdirSync(目录, { withFileTypes: true })) {
      if (子.isDirectory()) 试.push(join(目录, 子.name, 名), join(目录, 子.name, 'bin', 名))
    }
  } catch {}
  return 试.find((p) => existsSync(p)) || ''
}

/** 把 uv 解压到部署目录；解压失败就退回 PowerShell（Windows 上 tar 理论上够用，但不能假设）。 */
async function 解压(包, 目录) {
  const a = await 跑命令('tar', ['-xf', 包, '-C', 目录], { timeoutMs: 300000 })
  if (a.code === 0) return true
  if (!WIN) return false
  const 引 = (s) => "'" + String(s).replace(/'/g, "''") + "'"
  const b = await 跑命令('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${引(包)} -DestinationPath ${引(目录)} -Force`], { timeoutMs: 300000 })
  return b.code === 0
}

async function 备好uv(部署目录, 记) {
  const 目录 = join(部署目录, 'uv')
  mkdirSync(目录, { recursive: true })
  const 已有 = 找uv(目录)
  if (已有) return 已有
  const 名 = uv包名()
  const 包 = join(目录, 名)
  记('下载 uv（约 20MB，用来装托管 Python）')
  const r = await 下载('https://github.com/astral-sh/uv/releases/latest/download/' + 名, 包)
  if (!r.ok) throw new Error('下载 uv 失败：' + (r.说 || '网络不通'))
  if (!(await 解压(包, 目录))) throw new Error('uv 解压失败：' + 包)
  const uv = 找uv(目录)
  if (!uv) throw new Error('uv 解压后找不到可执行文件：' + 目录)
  if (!WIN) { try { chmodSync(uv, 0o755) } catch {} }
  return uv
}

/** uv 的缓存 / 托管目录全都塞进部署目录，不碰 ~/.local/uv 之类的用户目录。 */
export function uv环境(部署目录) {
  return {
    UV_PYTHON_INSTALL_DIR: join(部署目录, 'python'),
    UV_CACHE_DIR: join(部署目录, 'uv-cache'),
    UV_NO_MODIFY_PATH: '1',
    UV_LINK_MODE: 'copy',
  }
}

/** 托管运行时：uv python install → uv python find，全部落在 <部署目录>/python 下。 */
async function 托管Python(部署目录, 记, 日志) {
  const uv = await 备好uv(部署目录, 记)
  const 环境 = uv环境(部署目录)
  let 最后错 = ''
  for (const 版本 of ['3.10', '3.11']) {
    记('下载托管 Python ' + 版本 + '（约 30–50MB）')
    // --no-bin / --no-registry：不往 ~/.local/bin 和注册表写东西，免得跟系统里的 Python 打架
    const 装 = await 跑命令(uv, ['python', 'install', 版本, '--no-bin', '--no-registry'], { env: 环境, timeoutMs: 1800000 })
    日志?.('uv python install ' + 版本 + ' → exit ' + 装.code)
    if (装.code !== 0) { 最后错 = String(装.stderr || 装.stdout || '').slice(-500); continue }
    const 找 = await 跑命令(uv, ['python', 'find', 版本], { env: 环境, timeoutMs: 120000 })
    const 路径 = String(找.stdout).trim().split(/\r?\n/).filter(Boolean).pop() || ''
    if (找.code === 0 && 路径 && existsSync(路径)) return { 路径, uv }
    最后错 = String(找.stderr || 找.stdout || '').slice(-500)
  }
  throw new Error('下载托管 Python 失败：' + (最后错 || '未知原因'))
}

/**
 * 解析出一个能用的 Python 解释器（3.9+，优先 3.10）。
 * @returns { 路径, 版本: [3,10], 来源: '系统' | '托管' }
 */
export async function 确保Python({ 部署目录 = '', 覆盖 = '', 记 = () => {}, 日志 = null } = {}) {
  const 打 = (行) => { try { 记(行) } catch {} }
  const 见过 = new Set()

  const 试 = async (命令, 参数 = []) => {
    const 见 = await 探(命令, 参数)
    if (!见) return null
    const 键 = 见.路径 || 命令 + ' ' + 参数.join(' ')
    if (见过.has(键)) return null
    见过.add(键)
    if (比版本(见.版本, 最低版本) < 0) {
      日志?.('跳过版本过低的 Python ' + 版本串(见.版本) + '：' + 键)
      return null
    }
    return 见
  }

  // 1) 显式覆盖路径存在就直接用（设置页里填过的），省掉一圈探测
  if (覆盖 && existsSync(覆盖)) {
    const 见 = await 试(覆盖)
    if (见) return { 路径: 见.路径 || 覆盖, 版本: 见.版本, 来源: '系统', uv: '', 部署目录 }
  }

  // 2) 按优先级挨个探测
  for (const 候选 of 候选表(覆盖 && !existsSync(覆盖) ? 覆盖 : '')) {
    const 见 = await 试(候选.命令, 候选.参数)
    if (见) return { 路径: 见.路径, 版本: 见.版本, 来源: '系统', uv: '', 部署目录 }
  }

  // 3) Windows 注册表兜底
  for (const p of await 注册表Python()) {
    const 见 = await 试(p)
    if (见) return { 路径: 见.路径 || p, 版本: 见.版本, 来源: '系统', uv: '', 部署目录 }
  }

  // 4) 都没有 → 自己下一个
  if (!部署目录) throw new Error('找不到 Python ' + 版本串(最低版本) + '+，也没有可用的部署目录来放托管运行时。')
  打('系统里没有 Python，改下载托管运行时')
  const { 路径, uv } = await 托管Python(部署目录, 打, 日志)
  const 见 = await 探(路径)
  if (!见) throw new Error('托管 Python 装好了但跑不起来：' + 路径)
  if (比版本(见.版本, 最低版本) < 0) throw new Error('托管 Python 版本过低：' + 版本串(见.版本))
  return { 路径: 见.路径 || 路径, 版本: 见.版本, 来源: '托管', uv, 部署目录 }
}

/**
 * 建 venv，并保证里面真的有 pip。
 *
 * python-build-standalone 的 ensurepip 常常缺 pip 的轮子 → `python -m venv` 会 exit 1，
 * 但 venv 目录已经建好、只剩没有 pip。所以这里不能只看目录是否存在，要单独验 pip；
 * 缺了就用 uv 往里补（uv pip install --python <venv> pip setuptools wheel）。
 */
export async function 建venv(py, 目录, 日志 = null) {
  const { 路径, uv, 部署目录 } = py
  const bin = WIN ? ['Scripts', 'python.exe'] : ['bin', 'python']
  const venvPy = join(目录, ...bin)
  if (!existsSync(venvPy)) {
    const r = await 跑命令(路径, ['-m', 'venv', 目录], { timeoutMs: 600000 })
    日志?.('python -m venv ' + 目录 + ' → exit ' + r.code)
    if (!existsSync(venvPy)) throw new Error('创建 venv 失败：' + String(r.stderr || r.stdout || '').slice(-600))
  }
  if (await 有pip(venvPy)) return venvPy
  日志?.('venv 里没有 pip，用 uv 补一份')
  if (!uv || !部署目录) throw new Error('venv 里没有 pip，而且没有 uv 可以补。（系统 Python 请确认带 ensurepip。）')
  const r = await 跑命令(uv, ['pip', 'install', '--python', venvPy, 'pip', 'setuptools', 'wheel'], { env: uv环境(部署目录), timeoutMs: 1800000 })
  if (r.code !== 0 || !(await 有pip(venvPy))) throw new Error('给 venv 补 pip 失败：' + String(r.stderr || r.stdout || '').slice(-600))
  return venvPy
}

async function 有pip(venvPy) {
  const r = await 跑命令(venvPy, ['-m', 'pip', '--version'], { timeoutMs: 120000 })
  return r.code === 0
}

/** 各平台「怎么装 Python」的一句话提示（只在自动下载也失败时才用得到）。 */
export function 装Python提示() {
  if (WIN) return '也可以手动装：winget install -e --id Python.Python.3.10，再点一次「一键部署」。'
  if (MAC) return '也可以手动装：brew install python@3.10，再点一次「一键部署」。'
  return '也可以手动装：apt install python3.10 python3.10-venv（Debian/Ubuntu）或 dnf install python3.10。'
}

/** 各平台「怎么装 git」的一句话提示。 */
export function 装Git提示() {
  if (WIN) return '装上再来：winget install -e --id Git.Git（装完重开 DSH）。'
  if (MAC) return 'xcode-select --install 会带上 git。'
  return 'apt install git 或 dnf install git。'
}

/** Windows 上有没有 MSVC 生成工具 —— RVC 依赖（fairseq）没有预编译轮子，没它必然装不上。 */
export function 有MSVC() {
  if (!WIN) return true
  const 根们 = [
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft Visual Studio', '2022'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft Visual Studio', '2019'),
  ].filter(Boolean)
  return 根们.some((p) => existsSync(p))
}

export { 比版本, 版本串 }
