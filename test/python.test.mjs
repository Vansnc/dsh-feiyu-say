// Python 运行时解析的纯逻辑单测：node test/python.test.mjs
// （真正下载 / 建 venv 的部分要联网，不进单测；本地验证见 PR 说明。）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

const py = await import('../lib/python.mjs')

test('版本比较：3.9 < 3.10，主版本优先', () => {
  assert.ok(py.比版本([3, 10], [3, 9]) > 0)
  assert.ok(py.比版本([3, 9], [3, 10]) < 0)
  assert.equal(py.比版本([3, 10], [3, 10]), 0)
  assert.ok(py.比版本([4, 0], [3, 12]) > 0)
})

test('版本门槛：最低 3.9，首选 3.10', () => {
  assert.deepEqual(py.最低版本, [3, 9])
  assert.deepEqual(py.首选版本, [3, 10])
  assert.equal(py.版本串([3, 10]), '3.10')
})

test('uv 环境变量指向部署目录内，不碰用户目录', () => {
  const 部署 = process.platform === 'win32' ? 'C:\\x\\feiyu' : '/x/feiyu'
  const 环境 = py.uv环境(部署)
  assert.equal(环境.UV_PYTHON_INSTALL_DIR, join(部署, 'python'))
  assert.equal(环境.UV_CACHE_DIR, join(部署, 'uv-cache'))
  assert.equal(环境.UV_NO_MODIFY_PATH, '1')
  assert.ok(环境.UV_LINK_MODE)
})

test('平台兜底提示：按平台给，且非空', () => {
  const 提示 = py.装Python提示()
  assert.ok(提示.length > 8)
  if (process.platform === 'win32') assert.match(提示, /winget/)
  assert.ok(py.装Git提示().length > 5)
})

test('有MSVC 在非 Windows 上恒为 true（不拦 RVC）', () => {
  assert.equal(typeof py.有MSVC(), 'boolean')
  if (process.platform !== 'win32') assert.equal(py.有MSVC(), true)
})
