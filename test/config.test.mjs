// 单元测试：node --test test/config.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离真实配置：用临时 DSH_HOME
const 临时 = mkdtempSync(join(tmpdir(), 'feiyu-test-'))
process.env.DSH_HOME = 临时

const config = await import('../lib/config.mjs')
const audio = await import('../lib/audio.mjs')

test('clamp旋钮：采样率非法回落 24000，合法保留', () => {
  assert.equal(config.clamp旋钮({ sampleRate: 12345 }).sampleRate, 24000)
  assert.equal(config.clamp旋钮({ sampleRate: 8000 }).sampleRate, 8000)
  assert.equal(config.clamp旋钮({ sampleRate: 44100 }).sampleRate, 44100)
})

test('clamp旋钮：超时越界回落 240000', () => {
  assert.equal(config.clamp旋钮({ timeoutMs: 1 }).timeoutMs, 240000)
  assert.equal(config.clamp旋钮({ timeoutMs: 999999 }).timeoutMs, 240000)
  assert.equal(config.clamp旋钮({ timeoutMs: 30000 }).timeoutMs, 30000)
})

test('clamp旋钮：enabled 布尔化 + hintMode 三档（兼容旧 hintEnabled）', () => {
  assert.equal(config.clamp旋钮({ enabled: 1 }).enabled, true)
  assert.equal(config.clamp旋钮({ hintEnabled: 0 }).hintMode, 'off')
  assert.equal(config.clamp旋钮({ hintEnabled: 1 }).hintMode, 'auto')
  const r = config.clamp旋钮({ hintMode: 'always' })
  assert.equal(r.hintMode, 'always')
  assert.equal(r.hintEnabled, undefined) // 旧字段已被删除
})

test('声线列表：原声恒在 + 自动发现 + 缺模型标记', () => {
  const 模型目录 = join(临时, 'models')
  mkdirSync(模型目录, { recursive: true })
  writeFileSync(join(模型目录, 'aaa.pth'), 'x')
  writeFileSync(join(模型目录, 'aaa.index'), 'y')
  writeFileSync(join(模型目录, 'bbb.pth'), 'x')
  const 列表 = config.声线列表({ 模型目录, 声线: [{ id: 'ccc', name: 'ccc', model: 'ccc.pth' }] })
  assert.equal(列表[0].id, '原声')
  assert.ok(列表.some((v) => v.id === 'aaa' && v.index === 'aaa.index' && !v.缺模型))
  assert.ok(列表.some((v) => v.id === 'bbb' && !v.缺模型))
  assert.ok(列表.some((v) => v.id === 'ccc' && v.缺模型 === true))
})

test('迁移：v1 → v2 幂等，cosy模式保留', () => {
  writeFileSync(join(临时, 'feiyu-say-config.json'), JSON.stringify({ 总开关: false, 语音提示: true, 语音提示文案: 'hi', 超时毫秒: 30000, cosy模式: 'custom' }))
  let 写旋钮被调 = false
  const 写旋钮 = () => { 写旋钮被调 = true }
  assert.equal(config.迁移(config.读JSON(), 写旋钮), true)
  assert.equal(写旋钮被调, true)
  const 后 = config.读JSON()
  assert.equal(后._版本, 2)
  assert.equal(后.总开关, undefined)
  assert.equal(后.cosy模式, 'custom')
  assert.equal(config.迁移(config.读JSON(), 写旋钮), false) // 幂等
})

test('音频路径：拦截 .. 与非 wav 与超长名', () => {
  const 音频目录 = join(临时, 'audio')
  mkdirSync(音频目录, { recursive: true })
  writeFileSync(join(音频目录, 'ok.wav'), 'x')
  assert.ok(audio.音频路径(音频目录, '/feiyu-say/audio/ok.wav'))
  assert.equal(audio.音频路径(音频目录, '/feiyu-say/audio/../etc/passwd'), null)
  assert.equal(audio.音频路径(音频目录, '/feiyu-say/audio/x.txt'), null)
  assert.equal(audio.音频路径(音频目录, '/feiyu-say/audio/' + 'a'.repeat(100) + '.wav'), null)
})

test('路径清洗：绝对路径保留（Windows 盘符也算），相对路径清空', () => {
  const 根 = process.platform === 'win32' ? 'C:\\tmp\\feiyu' : '/tmp/feiyu'
  const 配置路径 = join(临时, 'feiyu-say-config.json')
  writeFileSync(配置路径, JSON.stringify({
    部署目录: 根,
    python: join(根, 'python.exe'),
    cosyPython: join(根, 'cosy-venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python'),
    ffmpeg: 'ffmpeg',
  }))
  const c = config.读JSON()
  // 以前只认 `/` 开头，Windows 上这些全被清成空串
  assert.equal(c.部署目录, 根)
  assert.equal(c.python, join(根, 'python.exe'))
  assert.ok(c.cosyPython.endsWith('python.exe') || c.cosyPython.endsWith('python'))
  assert.equal(c.ffmpeg, 'ffmpeg') // 纯命令名允许

  writeFileSync(配置路径, JSON.stringify({ 部署目录: 'feiyu-say', cosyPython: '../x/python' }))
  const d = config.读JSON()
  assert.equal(d.部署目录, '')
  assert.equal(d.cosyPython, '')
})

test('新增键：python 默认空、安装RVC 三档且非法值回落 auto', () => {
  const 默认 = config.JSON默认值()
  assert.equal(默认.python, '')
  assert.equal(默认.安装RVC, 'auto')
  writeFileSync(join(临时, 'feiyu-say-config.json'), JSON.stringify({ 安装RVC: '乱填' }))
  assert.equal(config.读JSON().安装RVC, 'auto')
  writeFileSync(join(临时, 'feiyu-say-config.json'), JSON.stringify({ 安装RVC: 'off' }))
  assert.equal(config.读JSON().安装RVC, 'off')
})

test('清理', () => { try { rmSync(临时, { recursive: true, force: true }) } catch {} })
