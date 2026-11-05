// 部署编排测试：node test/deploy.test.mjs
// 用假执行器把 跑部署() 从「准备 Python」跑到「自检合成」，专门抓
// 「模块里用了没 import 的东西」「阶段顺序写错」这类 node --check 抓不到的错。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 仓 = join(这里, '..')
const 家 = mkdtempSync(join(tmpdir(), 'feiyu-deploy-'))
process.env.DSH_HOME = 家

// 复制一份 lib 到临时目录，把 run.mjs 换成假执行器（deploy.mjs 是按相对路径 import 的）
const 副本 = join(家, 'lib-copy')
mkdirSync(join(副本, 'lib'), { recursive: true })
for (const f of readdirSync(join(仓, 'lib'))) copyFileSync(join(仓, 'lib', f), join(副本, 'lib', f))
copyFileSync(join(这里, 'fixtures', 'fake-run.mjs'), join(副本, 'lib', 'run.mjs'))

const deploy = await import(pathToFileURL(join(副本, 'lib', 'deploy.mjs')).href)
const { 读JSON } = await import(pathToFileURL(join(副本, 'lib', 'config.mjs')).href)

async function 跑一轮(标签, 补丁 = {}) {
  const 根 = join(家, 标签)
  await deploy.开始部署({
    部署目录: join(根, 'deploy'),
    音频目录: join(根, 'audio'),
    模型目录: join(根, 'models'),
    python: '',
    ffmpeg: 'ffmpeg',
    安装RVC: 'off',
    声线: [],
    当前声线: '原声',
    ...补丁,
  })
  const 截止 = Date.now() + 60000
  let 状态 = {}
  while (Date.now() < 截止) {
    状态 = deploy.读部署状态()
    if (状态 && 状态.状态 && 状态.状态 !== '进行中') break
    await new Promise((r) => setTimeout(r, 25))
  }
  return 状态
}

test('阶段表：9 段，Python 在最前', () => {
  assert.equal(deploy.部署阶段表.length, 9)
  assert.equal(deploy.部署阶段表[0], '准备 Python')
  assert.equal(deploy.部署阶段表.at(-1), '自检合成')
})

test('部署编排：安装RVC=off 也能从准备 Python 跑到自检合成完成', async () => {
  const 状态 = await 跑一轮('off')
  assert.equal(状态.状态, '完成', '失败在「' + 状态.阶段 + '」：' + 状态.错误)
  assert.equal(状态.序号, 9)
  assert.ok((状态.日志 || []).some((l) => l.includes('ffmpeg 未安装')))
  assert.ok((状态.日志 || []).some((l) => l.includes('安装RVC=off')))
})

test('部署编排：安装RVC=on 会真的建 rvc venv，并写进配置', async () => {
  const 状态 = await 跑一轮('on', { 安装RVC: 'on' })
  assert.equal(状态.状态, '完成', '失败在「' + 状态.阶段 + '」：' + 状态.错误)
  const 配置 = 读JSON()
  assert.ok(配置.rvcPython.endsWith('python.exe') || 配置.rvcPython.endsWith('python'))
  assert.equal(配置.安装RVC, 'on')
})

test('部署编排：写盘配置的 Windows 路径不会被 clamp 清空', async () => {
  const 配置 = 读JSON()
  // 家目录一定是个绝对路径；以前 Windows 上这里会被清成 ''
  assert.ok(配置.python.length > 0, 'python 被清空了')
  assert.ok(配置.部署目录.length > 0, '部署目录被清空了')
  assert.ok(配置.cosy模型目录.length > 0, 'cosy模型目录被清空了')
  assert.ok(配置.cosy脚本.endsWith('cosy_say.py'))
})

test('清理', () => { try { rmSync(家, { recursive: true, force: true }) } catch {} })
