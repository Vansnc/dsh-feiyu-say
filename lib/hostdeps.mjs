// dsh-feiyu-say · 安全加载 @deepseek-ai/schemastery
// link: 装的插件从自己目录裸 import 会 MODULE_NOT_FOUND（实测），所以按路径从宿主树里找。
// 找不到返回 { z: null }，插件照常加载（无 Config，旋钮降级到 JSON 同名键）。

import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadHostDeps() {
  const 候选 = []
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const push = (p) => { if (p && !候选.includes(p)) 候选.push(p) }

  // 1) profiles/*/node_modules/@deepseek-ai/schemastery
  try {
    for (const p of readdirSync(join(家, 'profiles'))) {
      push(join(家, 'profiles', p, 'node_modules', '@deepseek-ai', 'schemastery'))
    }
  } catch {}
  // 2) DSH_HOST_MODULES
  if (process.env.DSH_HOST_MODULES) push(join(process.env.DSH_HOST_MODULES, '@deepseek-ai', 'schemastery'))

  for (const 根 of 候选) {
    try {
      const 入口 = join(根, 'lib', 'index.mjs')
      if (!existsSync(入口)) continue
      const m = await import(pathToFileURL(入口).href)
      const z = m?.default ?? m?.Schema ?? m ?? null
      if (z && typeof z === 'function') return { z }
    } catch (e) {
      console.warn('[feiyu-say] 从宿主树加载 schemastery 失败：' + String(e?.message || e))
    }
  }
  // 3) 裸 import（兜底，npm 安装时可能可用）
  try {
    const m = await import('@deepseek-ai/schemastery')
    const z = m?.default ?? m?.Schema ?? m ?? null
    if (z && typeof z === 'function') return { z }
  } catch (e) {
    console.warn('[feiyu-say] 裸 import schemastery 失败：' + String(e?.message || e))
  }
  return { z: null }
}
