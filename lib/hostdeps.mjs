// dsh-feiyu-say · 从宿主树里加载 @deepseek-ai/schemastery
// 第三方插件（尤其 link: 装的）没法裸 import schemastery，这里按路径找。
// 找到就返回 Schema；找不到返回 null —— 这时插件没有 Config、设置页降级，但本体照常跑。

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function 载入Schemastery() {
  const 候选 = []
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const push = (p) => { if (p && !候选.includes(p)) 候选.push(p) }
  // profile 的 node_modules 里通常 hoist 了一份
  try {
    for (const p of readdirSync(join(家, 'profiles'))) {
      push(join(家, 'profiles', p, 'node_modules', '@deepseek-ai', 'schemastery'))
    }
  } catch {}
  if (process.env.DSH_HOST_MODULES) push(join(process.env.DSH_HOST_MODULES, '@deepseek-ai', 'schemastery'))

  for (const 根 of 候选) {
    try {
      const 入口 = join(根, 'lib', 'index.mjs')
      if (!existsSync(入口)) continue
      const m = await import(pathToFileURL(入口).href)
      if (m && (m.default || m.Schema)) return m.default ?? m.Schema ?? m
    } catch {}
  }
  // 兜底：裸 import（插件不是 symlink 时可能成功）
  try {
    const m = await import('@deepseek-ai/schemastery')
    if (m && (m.default || m.Schema)) return m.default ?? m.Schema ?? m
  } catch {}
  return null
}
