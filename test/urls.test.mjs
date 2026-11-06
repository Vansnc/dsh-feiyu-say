// 单元测试：node --test test/urls.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { 音频相对地址, 音频绝对地址 } from '../lib/urls.mjs'

test('相对地址：固定前缀 + URL 编码，浏览器按页面 origin 解析', () => {
  assert.equal(音频相对地址('feiyu-20261106-165828-cnsvtp.wav'), '/feiyu-say/audio/feiyu-20261106-165828-cnsvtp.wav')
  assert.equal(音频相对地址('a b.wav'), '/feiyu-say/audio/a%20b.wav')
})

test('绝对地址：取源可达时拼成完整 URL，取源抛错时退回相对地址', () => {
  assert.equal(音频绝对地址(() => 'http://127.0.0.1:3080', 'x.wav'), 'http://127.0.0.1:3080/feiyu-say/audio/x.wav')
  assert.equal(音频绝对地址(() => { throw new Error('没 listen') }, 'x.wav'), '/feiyu-say/audio/x.wav')
  assert.equal(音频绝对地址(() => undefined, 'x.wav'), '/feiyu-say/audio/x.wav')
})
