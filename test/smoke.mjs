// 冒烟（手工跑）：node test/smoke.mjs [--synth]
// 读真实配置 → 列检查项 → 可选真合成一句。不改任何用户配置。
import { 读JSON, 取声线 } from '../lib/config.mjs'
import { 自检 } from '../lib/deploy.mjs'
import { 合成 } from '../lib/pipeline.mjs'

const 配置 = 读JSON()
console.log('=== 配置摘要 ===')
console.log('cosy模式:', 配置.cosy模式, '| 当前声线:', 配置.当前声线, '| 音频目录:', 配置.音频目录 || '(默认临时目录)')

console.log('\n=== 自检 ===')
const r = await 自检(配置)
console.log(r.说)

if (process.argv.includes('--synth')) {
  console.log('\n=== 真合成一句（约 30–60 秒）===')
  const 烟 = await 合成(配置, '这是冒烟测试，一句话。', 取声线(配置), 24000, 配置.timeoutMs || 240000)
  console.log(JSON.stringify(烟, null, 2))
}
