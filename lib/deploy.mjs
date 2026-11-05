// dsh-feiyu-say · 部署：分阶段、失败即停、续跑、自检合成。

import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs'
import { join, dirname, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { 跑命令, 下载 } from './run.mjs'
import { 合成 } from './pipeline.mjs'
import { 写JSON, 取声线 } from './config.mjs'
import { 确保Python, 建venv, 装Python提示, 装Git提示, 有MSVC, 最低版本 } from './python.mjs'

const 插件目录 = dirname(fileURLToPath(import.meta.url))
const 家 = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const 部署状态文件 = () => join(家(), 'feiyu-say-deploy.json')
const 部署日志文件 = () => join(家(), 'feiyu-say', 'deploy.log')

export function 读部署状态() {
  try { return JSON.parse(readFileSync(部署状态文件(), 'utf8')) } catch { return {} }
}
export function 写部署状态(状态) {
  const 路径 = 部署状态文件()
  try {
    mkdirSync(dirname(路径), { recursive: true })
    const tmp = 路径 + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify(状态, null, 2), 'utf8')
    renameSync(tmp, 路径)
  } catch (e) { console.warn('[feiyu-say] 写部署状态失败：' + String(e?.message || e)) }
}
export function 记部署日志(行) {
  try {
    mkdirSync(dirname(部署日志文件()), { recursive: true })
    try { if (statSync(部署日志文件()).size > 2 * 1024 * 1024) renameSync(部署日志文件(), 部署日志文件() + '.old') } catch {}
    appendFileSync(部署日志文件(), '[' + new Date().toISOString() + '] ' + String(行) + '\n')
  } catch {}
}

class StageError extends Error {
  constructor(阶段, 说) { super(说); this.阶段 = 阶段 }
}

// ── 自检 ──
export async function 自检(配置) {
  const 项 = []
  const 加 = (名, ok, 详情) => 项.push({ 名, ok, 详情: String(详情 || '') })

  // Python 解释器：配置里存的是「部署时用的那个」（系统 Python 或托管运行时）
  const py = 配置.python
  if (!py || !existsSync(py)) {
    await 加('python', false, (py ? '不存在：' + py : '未配置') + '；点一次「一键部署」会自动准备（没有会下载托管运行时）')
  } else {
    const r = await 跑命令(py, ['-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { timeoutMs: 30000 })
    const 版本 = String(r.stdout || '').trim()
    const m = 版本.match(/^(\d+)\.(\d+)$/)
    const 够 = !!m && (Number(m[1]) > 最低版本[0] || (Number(m[1]) === 最低版本[0] && Number(m[2]) >= 最低版本[1]))
    await 加('python', r.code === 0 && 够, r.code === 0 ? 版本 + ' · ' + py : '跑不起来：' + String(r.stderr).slice(-100))
  }

  const cp = 配置.cosyPython
  if (!cp || !existsSync(cp)) await 加('cosyPython', false, cp ? '不存在：' + cp : '未配置')
  else { const r = await 跑命令(cp, ['-V'], { timeoutMs: 30000 }); await 加('cosyPython', r.code === 0, r.code === 0 ? r.stdout.trim() : r.stderr.slice(-100)) }

  await 加('cosy脚本', !!(配置.cosy脚本 && existsSync(配置.cosy脚本)), 配置.cosy脚本 || '未配置')

  const 模式 = 配置.cosy模式 || 'sft'
  if (模式 === 'custom') {
    await 加('cosy参考音频', !!(配置.cosy参考音频 && existsSync(配置.cosy参考音频)), 配置.cosy参考音频 || '未配置')
    await 加('cosy仓库目录', true, 'custom 模式，不适用')
    await 加('cosy模型', true, 'custom 模式，不适用')
  } else {
    await 加('cosy仓库目录', !!配置.cosy仓库目录 && existsSync(配置.cosy仓库目录), 配置.cosy仓库目录 || '未配置')
    const 模 = 配置.cosy模型目录
    const 模好 = 模 && existsSync(模) && (existsSync(join(模, 'cosyvoice2.yaml')) || (existsSync(join(模, 'llm.pt')) && existsSync(join(模, 'flow.pt'))))
    await 加('cosy模型', !!模好, 模好 ? 模 : (模 || '未配置') + '（缺 cosyvoice2.yaml 或 llm.pt+flow.pt）')
  }

  const rp = 配置.rvcPython
  if (!rp || !existsSync(rp)) {
    // RVC 现在可跳过（Windows 没 MSVC 时默认跳），跳过不代表部署没就绪
    const 跳过 = String(配置.安装RVC || 'auto') === 'off' || !有MSVC()
    await 加('rvcPython', 跳过, 跳过 ? '未装 RVC（只出原声；要换声就装 VS Build Tools 后把「安装RVC」设为 on）' : (rp ? '不存在：' + rp : '未配置'))
  } else { const r = await 跑命令(rp, ['-c', 'from rvc_python.infer import RVCInference'], { timeoutMs: 60000 }); await 加('rvcPython', r.code === 0, r.code === 0 ? '可导入 RVCInference' : r.stderr.slice(-120)) }

  const ff = 配置.ffmpeg || 'ffmpeg'
  const rf = await 跑命令(ff, ['-version'], { timeoutMs: 30000 })
  // ffmpeg 现在是可选项：没有就由 Python 侧重采样（macOS 上装了还是走 ffmpeg，行为不变）
  await 加('ffmpeg', true, rf.code === 0 ? String(rf.stdout).split('\n')[0] : '未安装（改用 Python 重采样，不影响合成）')

  const 声 = 取声线(配置)
  if (声 && !声.noRvc && 声.model) {
    const 模路径 = 配置.模型目录 ? join(配置.模型目录, 声.model) : ''
    await 加('当前声线', !!(模路径 && existsSync(模路径)), 声.id + (模路径 && existsSync(模路径) ? '' : ' 的模型不存在：' + (模路径 || '(空)') + '，去设置页重新导入'))
  } else {
    await 加('当前声线', true, (声 && 声.id || '原声') + '（原声，无需模型）')
  }

  const 音 = 配置.音频目录
  if (音) { try { mkdirSync(音, { recursive: true }); const 试 = join(音, '.w'); writeFileSync(试, 'x'); renameSync(试, 试); await 加('音频目录', true, '可写'); } catch (e) { await 加('音频目录', false, '不可写：' + String(e?.message || e)); } }
  else await 加('音频目录', true, '未配置（默认临时目录）')

  const 部署 = 读部署状态()
  await 加('上次部署', true, (部署.状态 || '未部署') + (部署.更新 ? ' · ' + new Date(部署.更新).toLocaleString() : ''))

  return { ok: true, 就绪: 项.every((x) => x.ok), 说: 项.map((x) => (x.ok ? '✓' : '✗') + ' ' + x.名 + '：' + x.详情).join('\n'), 项 }
}

// ── 部署 ──
let 部署中 = false
export function 部署进行中() { return 部署中 }

export async function 开始部署(配置) {
  if (部署中) return { ok: false, 说: '已经在部署了' }
  部署中 = true
  const 状态 = { 状态: '进行中', 阶段: '准备', 步骤: [], 日志: [], 错误: '', 开始: Date.now(), 更新: Date.now(), pid: process.pid }
  写部署状态(状态)
  void 跑部署(配置, 状态).finally(() => { 部署中 = false })
  return { ok: true }
}

export const 部署阶段表 = ['准备 Python', '环境检查', '建 venv', '装 CosyVoice 依赖', '下 CosyVoice 模型', '装 RVC', '下 RVC 模型', '写配置', '自检合成']

async function 跑部署(配置, 状态) {
  const 更新 = (补丁) => { Object.assign(状态, 补丁, { 更新: Date.now() }); 写部署状态(状态); 记部署日志((补丁.阶段 || '') + ' ' + (补丁.摘要 || '')) }
  const 记 = (阶段, 摘要) => 更新({ 阶段, 摘要, 序号: 部署阶段表.indexOf(阶段) + 1, 总数: 部署阶段表.length, 日志: [...(状态.日志 || []), 摘要].slice(-200) })
  const 必须 = (r, 阶段, 补充) => { if (r.code === 0) return r; throw new StageError(阶段, String(r.stderr || r.stdout || '').slice(-1500) + (补充 ? '\n' + 补充 : '')) }

  try {
    const 部署目录 = String(配置.部署目录 || join(家(), 'feiyu-say'))
    const bin = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']
    const cosyVenv = join(部署目录, 'cosy-venv', ...bin)
    const rvcVenv = join(部署目录, 'rvc-venv', ...bin)
    const 模型目录 = String(配置.模型目录 || join(部署目录, 'rvc-models'))
    const cosy模型目录 = String(配置.cosy模型目录 || join(部署目录, 'CosyVoice2-0.5B'))
    const cosy仓库目录 = join(部署目录, 'CosyVoice')

    // 0a 准备 Python：系统里有就用，没有就下托管运行时（Windows 全新机器上这步是必需的）
    记('准备 Python', '找系统 Python；找不到就下载托管运行时')
    let python
    try {
      python = await 确保Python({ 部署目录, 覆盖: String(配置.python || ''), 记: (行) => 记('准备 Python', 行), 日志: 记部署日志 })
    } catch (e) {
      throw new StageError('准备 Python', String(e?.message || e) + '\n' + 装Python提示())
    }
    const sysPy = python.路径
    记('准备 Python', '用' + python.来源 + ' Python ' + python.版本.join('.') + '：' + sysPy)

    // 0b preflight：git 必需；ffmpeg 只影响转码，缺了就用 Python 重采样兜底
    记('环境检查', 'git / ffmpeg（ffmpeg 可缺）')
    const gitv = await 跑命令('git', ['--version'], { timeoutMs: 60000 })
    if (gitv.code !== 0) throw new StageError('环境检查', '找不到 git。' + 装Git提示())
    const ffv = await 跑命令(配置.ffmpeg || 'ffmpeg', ['-version'], { timeoutMs: 60000 })
    const 有ffmpeg = ffv.code === 0
    if (!有ffmpeg) 记('环境检查', 'ffmpeg 未安装 → 改用 Python 重采样（不影响合成）')

    // RVC 是可选的：Windows 上没有 MSVC 时 fairseq 必然编译失败，与其让整条部署挂在最后一公里，
    // 不如跳过去先把「原声」跑通；装好 VS Build Tools 后把 安装RVC 设为 on 再部署一次即可。
    const 装RVC = String(配置.安装RVC || 'auto')
    const 跳过RVC = 装RVC === 'off' || (装RVC === 'auto' && !有MSVC())

    // 1 venv
    记('建 venv', 跳过RVC ? '创建 cosy-venv' : '创建 cosy-venv / rvc-venv')
    try { mkdirSync(部署目录, { recursive: true }) } catch {}
    try {
      await 建venv(python, join(部署目录, 'cosy-venv'), 记部署日志)
      if (!跳过RVC) await 建venv(python, join(部署目录, 'rvc-venv'), 记部署日志)
    } catch (e) {
      throw new StageError('建 venv', String(e?.message || e))
    }

    // 2 cosy-deps
    记('装 CosyVoice 依赖', 'clone 仓库（含 Matcha-TTS 子模块）+ 精简依赖安装（较久）')
    必须(await 跑命令(cosyVenv, ['-m', 'pip', 'install', '--upgrade', 'pip'], { timeoutMs: 600000 }), '装 CosyVoice 依赖')
    // setuptools>=81 删了 pkg_resources，而 openai-whisper 的 setup.py 还在 import 它 → 先钉回 <81
    必须(await 跑命令(cosyVenv, ['-m', 'pip', 'install', 'setuptools<81', 'wheel'], { timeoutMs: 600000 }), '装 CosyVoice 依赖', 'setuptools 安装失败。')
    if (!existsSync(join(cosy仓库目录, '.git'))) {
      必须(await 跑命令('git', ['clone', '--depth', '1', '--recursive', String(配置.cosy仓库), cosy仓库目录], { timeoutMs: 1800000 }), '装 CosyVoice 依赖', 'clone 失败（网络 / 仓库地址）。')
    }
    // Matcha-TTS 是 git 子模块；旧 clone（无 --recursive）可能没拉，补一下
    if (!existsSync(join(cosy仓库目录, 'third_party', 'Matcha-TTS', 'matcha'))) {
      必须(await 跑命令('git', ['-C', cosy仓库目录, 'submodule', 'update', '--init', '--recursive'], { timeoutMs: 600000 }), '装 CosyVoice 依赖', 'Matcha-TTS 子模块拉取失败（网络）。')
    }
    // 精简依赖：只装推理需要的，避开 gradio/deepspeed 等旧 pin 导致的解析失败
    // Windows 上先装 CPU 版 torch：pypi 默认轮子带整套 CUDA（2.5GB+），既占地方又容易在没显卡的机器上出 DLL 问题。
    if (process.platform === 'win32') {
      记('装 CosyVoice 依赖', 'Windows：先装 CPU 版 torch/torchaudio（省 2GB+，避开 CUDA 依赖）')
      必须(await 跑命令(cosyVenv, ['-m', 'pip', 'install', '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.3.1', 'torchaudio==2.3.1'], { timeoutMs: 3600000 }), '装 CosyVoice 依赖', 'CPU 版 torch 装失败（网络）。')
    }
    必须(await 跑命令(cosyVenv, ['-m', 'pip', 'install', '-r', join(插件目录, 'cosy_requirements.txt')], { timeoutMs: 3600000 }), '装 CosyVoice 依赖', '核心依赖安装失败（网络/磁盘/Python 版本）。')
    // openai-whisper 单独装：跳过 build isolation，才能用到 venv 里钉好的 setuptools<81
    必须(await 跑命令(cosyVenv, ['-m', 'pip', 'install', '--no-build-isolation', 'openai-whisper'], { timeoutMs: 1800000 }), '装 CosyVoice 依赖', 'openai-whisper 装失败（需 setuptools<81 + --no-build-isolation）。')
    const 仓库路径 = [cosy仓库目录, join(cosy仓库目录, 'third_party', 'Matcha-TTS')].join(delimiter)
    const imp = await 跑命令(cosyVenv, ['-c', 'import cosyvoice'], { env: { PYTHONPATH: 仓库路径 }, cwd: cosy仓库目录, timeoutMs: 120000 })
    if (imp.code !== 0) throw new StageError('装 CosyVoice 依赖', 'import cosyvoice 失败：' + String(imp.stderr).slice(-800) + '\n多半是缺 Xcode CLT / 依赖没装全。')

    // 3 cosy-model
    记('下 CosyVoice 模型', 'modelscope 下载（约 1–4GB）')
    try { mkdirSync(cosy模型目录, { recursive: true }) } catch {}
    if (!(existsSync(join(cosy模型目录, 'cosyvoice2.yaml')) || (existsSync(join(cosy模型目录, 'llm.pt')) && existsSync(join(cosy模型目录, 'flow.pt'))))) {
      必须(await 跑命令(cosyVenv, ['-c', "from modelscope import snapshot_download; snapshot_download('" + String(配置.cosy模型源) + "', local_dir='" + cosy模型目录 + "')"], { timeoutMs: 7200000 }), '下 CosyVoice 模型', '模型下载失败（网络/磁盘/模型 id）。')
    }

    // 4 rvc-deps
    let 有RVC = false
    if (跳过RVC) {
      记('装 RVC', 装RVC === 'off' ? '安装RVC=off，跳过（只出原声）' : '没装 MSVC 生成工具，跳过 RVC（只出原声）；想换声就装 VS Build Tools 后把 安装RVC 设为 on')
      记('下 RVC 模型', '跳过')
    } else {
      记('装 RVC', 'pip install rvc-python（先降 pip 到 <24.1）')
      // rvc-python 钉死旧 omegaconf（PyYAML (>=5.1.*) 元数据非法），pip>=24.1 拒绝解析，先降 pip
      必须(await 跑命令(rvcVenv, ['-m', 'pip', 'install', 'pip<24.1'], { timeoutMs: 600000 }), '装 RVC', '降 pip 失败。')
      必须(await 跑命令(rvcVenv, ['-m', 'pip', 'install', 'rvc-python', 'numpy', 'soundfile', 'torch', 'torchaudio'], { timeoutMs: 3600000 }), '装 RVC', 'rvc-python 装失败（它钉死旧 omegaconf，需 pip<24.1；仍失败多为编译依赖缺失）。')

      // 5 rvc-model（仅当 rvc模型地址 非空）
      const 发布地址 = String(配置.rvc模型地址 || '').replace(/\/+$/, '')
      if (发布地址) {
        记('下 RVC 模型', '下载 zyyv2（约 470MB）')
        try { mkdirSync(模型目录, { recursive: true }) } catch {}
        const a = await 下载(发布地址 + '/zyyv2.pth', join(模型目录, 'zyyv2.pth'))
        if (!a.ok) throw new StageError('下 RVC 模型', a.说)
        const b = await 下载(发布地址 + '/zyyv2.index', join(模型目录, 'zyyv2.index'))
        if (!b.ok) throw new StageError('下 RVC 模型', b.说)
        有RVC = existsSync(join(模型目录, 'zyyv2.pth')) && statSync(join(模型目录, 'zyyv2.pth')).size > 50 * 1024 * 1024
      } else {
        记('下 RVC 模型', '未配 rvc模型地址，跳过（之后在设置页导入）')
      }
    }

    // 6 write-config
    记('写配置', '更新 feiyu-say-config.json')
    // 部署会把配置切到「公开 CosyVoice（sft）」；先备份当前配置，方便切回 custom
    try { writeFileSync(join(家(), 'feiyu-say', 'config-before-deploy.json'), JSON.stringify(配置, null, 2)) } catch {}
    const 新声线 = [...(Array.isArray(配置.声线) ? 配置.声线 : []).filter((v) => v && v.id !== 'zyyv2')]
    if (有RVC) 新声线.push({ id: 'zyyv2', name: 'ZYYV2', model: 'zyyv2.pth', index: 'zyyv2.index', indexRate: 0.75, protect: 0.33 })
    const 净 = {
      ...配置,
      python: sysPy,
      安装RVC: 装RVC,
      cosyPython: cosyVenv,
      rvcPython: 跳过RVC ? '' : rvcVenv,
      // CosyVoice2-0.5B 是 zero-shot 模型，没有 sft 音色；用仓库自带的示例参考音频
      cosy模式: 'zero_shot',
      cosy脚本: join(插件目录, 'cosy_say.py'),
      cosy仓库目录,
      cosy模型目录,
      cosy参考音频: join(cosy仓库目录, 'asset', 'zero_shot_prompt.wav'),
      cosy参考文字: '希望你以后能够做的比我还好呦。',
      rvc目录: '',
      模型目录,
      音频目录: String(配置.音频目录 || join(部署目录, 'audio')),
      部署目录,
      声线: 新声线,
      当前声线: 有RVC ? 'zyyv2' : '原声',
    }
    if (!写JSON(净)) throw new StageError('写配置', '配置写盘失败，检查 ~/.dsh 写权限。')

    // 7 smoke
    记('自检合成', '真合成一句「你好，我是飞鱼。」')
    const 烟 = await 合成(净, '你好，我是飞鱼。', 取声线(净), 24000, 240000)
    if (!烟.ok || !烟.路径 || !existsSync(烟.路径) || statSync(烟.路径).size < 2000) {
      throw new StageError('自检合成', '环境看起来装好了，但合成没通过：' + String(烟.说 || '').slice(-800))
    }
    更新({ 阶段: '全部就绪', 摘要: '合成通过，' + 烟.耗时ms + 'ms，' + 烟.路径 + (有ffmpeg ? '' : '（ffmpeg 缺失，用 Python 重采样）'), 序号: 部署阶段表.length, 总数: 部署阶段表.length })

    状态.状态 = '完成'
    写部署状态(状态)
  } catch (e) {
    状态.状态 = '失败'
    状态.阶段 = e?.阶段 || 状态.阶段 || '未知'
    状态.序号 = 部署阶段表.indexOf(状态.阶段) + 1 || 状态.序号 || 0
    状态.错误 = String(e?.message || e).slice(0, 2000)
    写部署状态(状态)
    console.warn('[feiyu-say] 部署失败：' + String(e?.message || e))
  }
}

export { StageError }
