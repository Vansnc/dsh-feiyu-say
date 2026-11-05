# dsh-feiyu-say 改造设计方案 v2

> 状态：**待实现**（本文档是给实现 Agent 的施工图，不是已完成说明）
> 版本目标：`0.3.0`
> 最后更新：2026-11-05

---

## 0. 给实现 Agent 的说明

**你要改的是一个已安装、正在运行的 DSH 插件**，源码目录：

```
/Users/lingzifan/Documents/deepseek-harness/default-workspace/plugins/dsh-feiyu-say
```

它通过 `link:` 装进 `~/.dsh/profiles/desktop`，改完代码**重启 DSH** 才生效（宿主模块不会热替换）。

硬约束：

1. **只改这个目录里的文件**。不要改 `~/.dsh/profiles/desktop/package.json`、`cordis.patch.yml`，不要手写 profile 的依赖树。
2. 安装/重装只用 `plugin_manager` 的 `install_bundle`（target 传本目录绝对路径）；不要用 shell 复刻 pnpm 流程。
3. 不要新增第三方运行时依赖（Python 侧除外，见部署章节）。Node 侧只用内置模块 + 宿主提供的 `@deepseek-ai/schemastery`（按 §4.1 的方式安全加载）。
4. 所有命令执行一律 `spawn(cmd, args)`，**禁止 `shell: true`**，禁止拼字符串 shell 命令。
5. 所有面向用户的文案用中文；报错必须带**下一步动作**（去哪个页面、改哪个字段），不能只甩英文 stderr。
6. 不允许再出现「`catch {}` 吞掉后继续」的静默失败；不确定就 `console.warn('[feiyu-say] …')` 并让上层拿到失败。
7. 不要保留 5 秒轮询。见 §10。
8. 不要默认下载/分发第三方声线模型（授权风险）。见 §5.5。

### 已确认的产品决策（用户拍板，不要再改）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 引擎策略 | **只做 CosyVoice + RVC 单引擎**，不引入 say/edge-tts/Piper |
| 2 | 部署方式 | **保留自动部署**，但必须做成可信的（失败即停、可续跑、装完自检） |
| 3 | 配置存放 | **混合**：开关/采样率等 5 个旋钮进插件 `Config`；路径、声线列表留在 `~/.dsh/feiyu-say-config.json` |
| 4 | 平台 | **macOS 优先**，Windows/Linux 尽力兼容（有分支、不承诺） |
| 5 | 发布标准 | **要上架/给别人用**：补 locale、icon、安装说明、展示元数据 |
| 6 | 输出规格 | **默认 24kHz 单声道**，QQ 语音条场景可切 8kHz（全局配置 + 单次调用参数） |
| 7 | 试听 | **设置页能试听 + HTTP 音频路由 + 页面内 `<audio>` 播放** |

### 未确认、按保守默认处理的事项（实现时按此做，文档里标注即可）

| 事项 | 默认处理 | 理由 |
|---|---|---|
| ZYYV2 模型默认下发 | **默认不下发**；`rvc模型地址` 留空，首装只保证「原声」可用；用户自己导入 `.pth` 再开 RVC | 第三方声线模型的再分发授权不明确 |
| `cosy模式=custom` 老路径 | **保留**（兼容现有用户脚本），但默认走 `sft` | 现有配置就是 custom，直接删会把人弄挂 |
| 音频文件保留数 | 默认 **200** 条，可配 | 防止无限增长 |
| 配置 JSON 的键名 | **保留现有中文键**，不重命名，避免迁移风险；新增键也用中文 | 迁移成本 > 收益 |

---

## 1. 目标与非目标

### 目标

1. **可信部署**：任一步失败都能看见失败在哪、为什么；装完必须自动跑一次真合成；绝不出现「失败还写完成」。
2. **一条闭环**：装完 → 自检绿 → 页面试听能响 → 模型调 `send_voice` 能出文件。
3. **标准配置**：常用旋钮进插件 `Config`（`dsh --dump-config` 可见、随 patch 层升级），机器路径和声线列表留在 JSON。
4. **正确生命周期**：会话一创建工具就可用；会话关闭再打开工具还在；总开关关闭时工具从列表消失。
5. **可分享/可上架**：Plugin Manager 与设置页有正经标题、描述、图标；README 能让陌生人装起来。

### 非目标（本轮不做）

- 云端 TTS / 多引擎抽象 / 流式合成
- QQ 直发（投递仍交给会话的传输方式）
- 声线训练、模型转换
- 移动端/远程多用户隔离（但路由仍要按 §12 收敛）
- 英文界面全量翻译（只做 meta + 页面标题，正文中文）

---

## 2. 现状问题清单（必须逐条修复）

> 行号基于 2026-11-05 的代码，改造后失效，仅用于定位旧逻辑。

| # | 位置 | 问题 | 修复要求 |
|---|---|---|---|
| P1 | `lib/host.js:233-260` | 部署每一阶段都不看返回码，失败继续跑 | 每阶段校验；失败即停、落盘状态、不写配置 |
| P2 | `lib/host.js:278` | 部署最后无条件写 `状态='完成'` | 只有全部阶段 + 自检都通过才写 `完成` |
| P3 | `lib/cosy_say.py:36` + `lib/host.js:243` | `import cosyvoice` 必然失败：只装了 requirements，仓库没有 setup.py/pyproject，也没设 `PYTHONPATH` | 合成时给子进程 `PYTHONPATH=<CosyVoice 仓库根>`；部署阶段加一步 `import cosyvoice` 验证 |
| P4 | `lib/host.js:271` | 部署把 `rvc目录` 写成 `''`，pipeline 又拿它当 cwd | `rvc目录` 改为可选遗留项；为空时不传 cwd（实测 `cwd:''` 等于进程 cwd，会误导） |
| P5 | `lib/host.js:274` | RVC 模型没下成功也照注册 `zyyv2` 声线 | 只有文件真的存在才注册；否则当前声线回落到 `原声` |
| P6 | `lib/pipeline.mjs:90-97` | 模型缺失/RVC 失败时静默退回原声，返回 `ok:true` | 严格失败；错误里写清声线 id、缺失路径、stderr 尾 |
| P7 | `lib/host.js:471-513` | 5 秒轮询注册工具；agent 销毁后 `工具挂着` 不清 | 改为 `agent/created` + `agent.ctx.effect`；`agent/disposed` 清理；删掉定时器 |
| P8 | `lib/host.js` 全局 | 配置是独立 JSON，没进 `Config`，`dump-config` 看不到，无 schema | 按 §4 混合方案改造 |
| P9 | `lib/pipeline.mjs:102` | 8kHz 写死，和「不绑定 IM」的定位矛盾 | 采样率可配，默认 24000；`send_voice` 支持单次覆盖 |
| P10 | `lib/client.js` 全文 | 只有设置页，没有试听；合成出的 WAV 没有任何 HTTP 出口 | 加 `/feiyu-say/audio/*` + `/feiyu-say/preview` + `<audio>` |
| P11 | `lib/host.js` 全文 | 无并发控制；连发两条会起两个 RVC 进程 | 单队列 + 忙时快速失败 |
| P12 | `package.json` | 缺 locale/icon 导出，Plugin Manager 只能回退到包名和默认图 | 补 `locale/{zh,en}.json`、`icon.svg`、`exports`、`files` |
| P13 | `README.md` | 安装命令本机不存在；前置/默认值/设置页名与实现不一致 | 全文重写，见 §13.3 |
| P14 | `lib/host.js:1`、`package.json` keywords | 注释和关键词还写着 QQ/OneBot/NapCat，和定位打架 | 改成「本机 TTS → WAV，不绑 IM」 |
| P15 | `lib/host.js:137-202` | 路由接受任意本地路径 / 任意仓库 clone + pip install | 按 §12 做白名单、路径收敛、下载校验 |
| P16 | 全局 | 音频只增不删；配置写盘非原子 | 保留数 + 原子写 + `.bak` |

---

## 3. 目标架构

### 3.1 目录结构

```
plugins/dsh-feiyu-say/
├── package.json
├── cordis.patch.yml
├── locale/
│   ├── zh.json
│   └── en.json
├── icon.svg
├── lib/
│   ├── host.js          # 插件入口：inject、Config、路由、agent 生命周期、配置协调
│   ├── hostdeps.mjs     # 安全加载 @deepseek-ai/schemastery（拿不到就降级）
│   ├── config.mjs       # 默认值、读写、合并、clamp、迁移、原子写
│   ├── deploy.mjs       # preflight、分阶段部署、状态机、续跑、自检
│   ├── pipeline.mjs     # 合成：CosyVoice → RVC → ffmpeg → 落盘（+ 队列）
│   ├── audio.mjs        # 音频目录：命名、裁剪、路由服务
│   ├── tools.mjs        # 5 个工具的定义工厂（依赖一个 config getter）
│   ├── client.js        # 设置页（settings.section）
│   ├── cosy_say.py
│   └── rvc_infer.py
├── test/
│   ├── config.test.mjs
│   └── smoke.mjs
├── README.md
├── CHANGELOG.md
└── LICENSE
```

### 3.2 三条主流程

```
【设置流】
设置页(React) --GET/POST /feiyu-say/config--> host
  旋钮 5 项 --> ctx.settings.update('feiyu-say', patch)   // 进 Config
  其余字段 --> ~/.dsh/feiyu-say-config.json (原子写)
  保存成功 --> 重新读取生效配置 --> reconcile(工具/提示)

【部署流】
设置页 "一键部署" --POST /feiyu-say/deploy--> deploy.mjs
  preflight --> venv --> cosy deps --> cosy model --> rvc deps --> rvc model(可选)
  --> 写配置 --> 自检合成 --> 状态 '完成' / '失败(阶段)'
设置页每 1.5s 拉 /deploy 显示阶段与日志

【合成流】
模型调用 send_voice --> 队列(忙则快速失败) --> pipeline
  CosyVoice(venv, PYTHONPATH=仓库) --> RVC(可选, 严格失败) --> ffmpeg(24k/8k)
  --> copy 到音频目录 --> 裁剪旧文件 --> 返回 {path, url, 声线, 采样率, 耗时}
```

### 3.3 生命周期（关键）

```
apply(ctx, config)
├─ 读 JSON + Config 行，合并出「生效配置」
├─ ctx.effect(注册 6 条路由)             // /config /voices /deploy /selfcheck /preview /audio(prefix)
├─ ctx.on('agent/created',  注册工具+提示)   // 见 §10
├─ ctx.on('agent/disposed', 清理该 agent)
├─ ctx.on('settings/document-updated', ns==='feiyu-say' → reconcile)
└─ ctx.effect(卸载时清理全部 agent 注册 + 停部署)
```

**不存在任何 setInterval 轮询。**

---

## 4. 配置设计

### 4.1 旋钮（进插件 `Config`）

字段必须逐个带 `.extra('volatile', true)`——宿主只把带 volatile 的字段当成可在设置页编辑、可热更新的字段。

```js
// lib/host.js
import { loadHostDeps } from './hostdeps.mjs'
const hostDeps = await loadHostDeps()
const z = hostDeps.z

export const Config = !z ? undefined : z.object({
  enabled:     z.boolean().default(true).extra('volatile', true),
  sampleRate:  z.number().default(24000).extra('volatile', true),
  hintEnabled: z.boolean().default(false).extra('volatile', true),
  hintText:    z.string().default('…').extra('volatile', true),
  timeoutMs:   z.number().default(240000).extra('volatile', true),
})
```

`lib/hostdeps.mjs` 只需做一件事：**从宿主那棵树里找到 `@deepseek-ai/schemastery`**，找不到返回 `{z:null}`，插件照常加载（无 Config，降级到 JSON）。

```js
// 伪代码：按顺序尝试
// 1) $DSH_HOST_MODULES 或 ~/.dsh/profiles/*/node_modules/@deepseek-ai/schemastery
// 2) 包自身 node_modules/@deepseek-ai/schemastery
// 3) 裸 import '@deepseek-ai/schemastery'
// 4) 全失败 → null
```

> 为什么必须这样：桌面版 profile 的插件是从 `link:` 目录加载的，**从插件目录裸 import `@deepseek-ai/schemastery` 会 MODULE_NOT_FOUND**（本机实测）。裸 import 失败会让整条插件不激活。参照 `dsh-bili-subagent/lib/hostdeps.mjs` 的实现。
>
> `package.json` 仍需声明 `"dependencies": { "@deepseek-ai/schemastery": "^3.18.1" }`，保证从 npm/GitHub 正常安装时有一份兜底。

**读取生效值**（永远现取，别在 apply 时快照）：

```js
const 设置行 = () => {
  try {
    const 全部 = ctx.get('settings')?.describe?.() || []
    return 全部.find((d) => String(d.ns) === 'feiyu-say') || null
  } catch { return null }
}
const 旋钮 = () => ({ ...旋钮默认值, ...(config || {}), ...(设置行()?.value || {}) })
```

**写旋钮**（带 revision 重试；一个字段类型不对会让整批被拒）：

```js
async function 写旋钮(patch) {
  const 洁 = clamp旋钮(patch)                    // 先转类型、夹范围
  const 行 = 设置行() || await 等设置行(600)      // 宿主刚重载的几百毫秒内可能短暂没有
  if (!行 || !ctx.get('settings')?.update) throw new Error('宿主没有可写的设置表单')
  try { await ctx.get('settings').update(行.ns, 洁, 行.revision) }
  catch (e) {                                 // revision 过期就重取一次
    const 新 = 设置行() || await 等设置行(600)
    await ctx.get('settings').update(新.ns, 洁, 新.revision)
  }
  if (config && typeof config === 'object') Object.assign(config, 洁)   // 内存那份同步，避免读回旧值
}
```

如果 `settings` 不可用（老宿主 / 降级），这 5 项改存 JSON（同样的键），由 `旋钮()` 的合并顺序兜底。**不要两边同时写**。

可选：`ctx.effect(() => ctx.get('settings').configure({ auto: false }))`，避免原生插件页和「鱼的声音」页出现两份同样的表单。**实现后要验证 `describe()` 仍能返回本条目**（`autoGenerate` 只是展示策略）；若返回空，改成 `auto: true`，接受两份表单。

### 4.2 JSON 文件（路径 + 声线）

路径：`$DSH_HOME/feiyu-say-config.json`（`DSH_HOME` 优先，否则 `~/.dsh`）。

```json
{
  "_版本": 2,
  "cosyPython": "",
  "cosy脚本": "",
  "cosy仓库目录": "",
  "cosy模式": "sft",
  "cosy说话人": "中文女",
  "cosy参考音频": "",
  "cosy参考文字": "",
  "cosy风格": "cute",
  "cosy语速": 1.0,
  "cosy仓库": "https://github.com/FunAudioLLM/CosyVoice.git",
  "cosy模型源": "iic/CosyVoice2-0.5B",
  "cosy模型目录": "",
  "rvcPython": "",
  "rvc目录": "",
  "模型目录": "",
  "ffmpeg": "ffmpeg",
  "音频目录": "",
  "音频保留数": 200,
  "部署目录": "",
  "rvc模型地址": "",
  "声线": [],
  "当前声线": "原声"
}
```

- `cosy仓库目录` **新增**：部署时 clone 到哪，合成时拼进 `PYTHONPATH`。
- `rvc目录` **降级为可选遗留项**：非空才作为子进程 cwd；空就继承。
- `rvc模型地址` **默认空**：不自动下发第三方声线。
- `_版本` 用于迁移。

### 4.3 合并与优先级

```
生效配置 = 硬默认 < JSON 文件 < Config 旋钮
```

- 旋钮 5 项只认 Config（降级时认 JSON 同名键）。
- 其余字段只认 JSON。
- `声线` / `当前声线` 只认 JSON；`当前声线` 若不在列表中，回落 `原声`。

### 4.4 迁移（v1 → v2）

在 `apply` 里、读配置之后跑一次，幂等：

1. 若 `_版本 !== 2`：
   - 把旧键 `总开关`→`enabled`、`语音提示`→`hintEnabled`、`语音提示文案`→`hintText`、`超时毫秒`→`timeoutMs`；Config 可用就 `写旋钮()`，不可用就留在 JSON（读取时按别名兜底）。
   - 写入 `_版本: 2`，并备份 `feiyu-say-config.json.bak-<时间戳>`。
   - 从 JSON 删除这 4 个旧键（Config 写成功时）；失败则保留，下次再试。
2. 旧 `rvc目录` 指向 `/tmp/...` 的，不改值，只在 `voice_status` 里标黄「临时目录，重启后可能消失」。

### 4.5 clamp 规则

| 字段 | 规则 |
|---|---|
| `sampleRate` | 只能是 `8000 / 16000 / 22050 / 24000 / 44100`，否则回落 24000 |
| `timeoutMs` | `10000..600000`，否则 240000 |
| `音频保留数` | `10..2000`，否则 200 |
| `cosy语速` | `0.5..2.0` |
| 路径类 | 必须绝对路径（`ffmpeg` 例外，允许裸命令名）；`resolve` 后不得含 `..` |
| `声线[].id` | `^[A-Za-z0-9_-]{1,40}$` |

---

## 5. 部署设计

### 5.1 状态文件

`$DSH_HOME/feiyu-say-deploy.json`：

```json
{
  "状态": "进行中|完成|失败|中断",
  "步骤": [{ "id": "preflight", "名称": "环境检查", "状态": "待|跑|过|败", "摘要": "", "开始": 0, "结束": 0 }],
  "阶段": "装 CosyVoice 依赖",
  "日志": ["…（最多 200 行）"],
  "错误": "",
  "开始": 0,
  "更新": 0,
  "pid": 0
}
```

- 每次状态变化**原子写**（tmp + rename），并追加一行到 `$DSH_HOME/feiyu-say/deploy.log`（超过 2MB 轮转）。
- `apply` 时若读到 `状态='进行中'` 且 `更新` 超过 10 分钟，改成 `中断`，允许「继续部署」。
- 同一时间只允许一个部署（模块级 `部署中` 锁 + 状态文件 pid）。

### 5.2 阶段表

| # | id | 动作 | 成功判据 | 失败文案要点 |
|---|---|---|---|---|
| 0 | `preflight` | `python3 --version`、`git --version`、`ffmpeg -version`、磁盘可用 ≥ 12GB、`python3 -c "import venv"`；macOS 检查 `xcode-select -p` | 全部退出码 0、Python ≥ 3.9 | 缺什么、怎么装（`brew install ffmpeg` 等） |
| 1 | `venv` | `python3 -m venv <部署目录>/cosy-venv`、`rvc-venv`；已存在则跳过 | `<venv>/bin/python -V` 成功 | 路径与权限 |
| 2 | `cosy-deps` | 升级 pip；`git clone --depth 1 <cosy仓库> <部署目录>/CosyVoice`（存在则 `git -C … pull --ff-only`，失败退回不拉）；`pip install -r <repo>/requirements.txt`（cwd=repo） | **`PYTHONPATH=<repo> python -c "import cosyvoice"` 成功** | 报错尾部 + 「多半是缺 Xcode CLT / 网络」 |
| 3 | `cosy-model` | `python -c "from modelscope import snapshot_download; snapshot_download('<cosy模型源>', local_dir='<cosy模型目录>')"` | 目录里有 `cosyvoice2.yaml`（或 `llm.pt` + `flow.pt`），且总大小 > 500MB | 网络/磁盘/模型 id |
| 4 | `rvc-deps` | `pip install -U pip`；`pip install rvc-python` | `python -c "from rvc_python.infer import RVCInference"` | 编译失败提示 |
| 5 | `rvc-model` | **仅当 `rvc模型地址` 非空**：下载 `<base>/zyyv2.pth`、`.index`；否则跳过并记「未下发，稍后自己导入」 | 文件存在、`.pth` > 50MB 且前 2 字节为 `PK`、`.index` > 1MB | HTTP 状态 / 大小 / 不是模型文件 |
| 6 | `write-config` | 写 JSON：`cosyPython`、`cosy脚本`、`cosy仓库目录`、`cosy模型目录`、`rvcPython`、`模型目录`、`音频目录`、`部署目录`；RVC 下成功才追加/更新 `zyyv2` 声线并把当前声线设过去，否则当前声线 `原声` | 读回校验关键字段 | 写盘失败 |
| 7 | `smoke` | 用当前声线真合成一句「你好，我是飞鱼。」；输出存在且 > 2KB | 记录耗时；失败把 stderr 尾写进 `错误` | 明确是哪一段（cosy / rvc / ffmpeg） |

**规则**：任一阶段失败 → `状态='失败'`、`阶段=<名称>`、`错误=<stderr 尾 1500 字>`，**立即停止，不写配置**（阶段 6 之前）。
阶段 7 失败时配置已经写了，状态仍为 `失败`，提示「环境看起来装好了，但合成没通过，点自检看细节」。

### 5.3 命令执行器（唯一实现，放 `deploy.mjs`）

```js
async function 跑命令(cmd, args, { cwd, env, timeoutMs = 600000, onLine } = {})
// 返回 { code, stdout, stderr, 耗时 }
// code !== 0 由调用方抛 StageError（带阶段名）
```

要求：

- `spawn(cmd, args, { stdio: ['ignore','pipe','pipe'], cwd, env: {...process.env, ...env} })`
- stderr/stdout 按行切，保留最后 200 行；`onLine` 用于把关键行写进部署日志。
- 超时：POSIX `detached: true` + `process.kill(-child.pid, 'SIGKILL')`；Windows `taskkill /PID <pid> /T /F`。**必须杀进程树**，否则 pip 的子进程会残留。
- 退出后 `code===0` 才算成功；`ENOENT` 单独识别为「命令不存在」。

### 5.4 合成时的环境（关键修复）

`pipeline.mjs` 跑 CosyVoice 时必须：

```js
const repo = 配置.cosy仓库目录
const env = repo
  ? { ...process.env, PYTHONPATH: [repo, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }
  : process.env
跑命令(配置.cosyPython, [...脚本参数, '--repo', repo], { env, timeoutMs })
```

同时 `cosy_say.py` 增加 `--repo` 参数，开头 `sys.path.insert(0, args.repo)`（双保险）。
**删除** `cosy_say.py` 里强制的 `HF_HUB_OFFLINE=1`：模型目录是本地的情况下不需要，反而会让依赖 HF 缓存的加载路径失败。需要离线时由环境变量外部控制。

### 5.5 关于 RVC 模型

- 默认 `rvc模型地址` 为空，部署跳过阶段 5，当前声线设 `原声`，首装也能出声。
- 用户要换声：设置页「导入声线」导自己的 `.pth`（本地路径或 URL），或自行改 `rvc模型地址` 再部署。
- 不在仓库/Release 里默认捆绑第三方声线模型。

### 5.6 续跑

- `开始部署` 时读状态：`失败`/`中断` 且 `阶段` 已知 → 从该阶段重跑；之前的阶段用「存在即跳过」判定（venv、clone、pip 都是幂等的）。
- 阶段 5/7 允许单独重跑。
- UI 提供三个按钮：`一键部署`、`从失败处继续`、`只跑自检`。

---

## 6. 合成管线

### 6.1 输入输出

```ts
合成(配置, 文本, 声线, sampleRate, timeoutMs)
  → { ok: true, 路径, url, 声线, 采样率, 耗时ms }
  | { ok: false, 说 }   // 说里必须带原因和下一步
```

### 6.2 步骤

1. **参数校验**：文本去首尾空白，长度 1..200 字（超了截断并提示）。`sampleRate` 取 clamp 后的值。
2. **CosyVoice**：
   - `custom` 模式：`[cosyPython, cosy脚本, --text, --style, --ref?, --ref-text?, --speed?, --out]`
   - `sft` / `zero_shot`：`[cosyPython, cosy脚本, --model, cosy模型目录, --text, --out, --mode, --spk|--prompt-wav/--prompt-text, --speed, --repo, cosy仓库目录]`
   - `env.PYTHONPATH = cosy仓库目录`（见 §5.4）
   - 失败 → `CosyVoice 合成失败（模式 sft）：<stderr 尾 300 字>`，并提示看 `voice_status`。
3. **RVC（可选）**：
   - `声线.noRvc === true` 或 `参数.noRvc === true` → 跳过。
   - 没有 `声线.model` → 跳过（但记日志）。
   - 模型文件不存在 → **失败**：`声线「<id>」的模型文件不存在：<路径>。去设置页重新导入，或 voice_list 换一条。`
   - `rvc_infer.py` 参数：`[src, out, modelPath, indexPath, indexRate, protect]`；`cwd` = `配置.rvc目录 || undefined`（空字符串不要传）。
   - 失败 → **失败**：`RVC 换声失败（声线 <id>）：<stderr 尾 300 字>`。不降级。
4. **ffmpeg**：
   ```
   ffmpeg -y -v error -i <当前> -ar <sampleRate> -ac 1 -c:a pcm_s16le <out>
   ```
   失败 → `ffmpeg 转码失败（<sampleRate>Hz）：<stderr 尾 200 字>`。
5. **落盘**：复制到 `音频目录`，命名 `feiyu-YYYYMMDD-HHMMSS-<rand6>.wav`。
6. **裁剪**：按 mtime 倒序保留 `音频保留数` 条 `feiyu-*.wav`，多余删除（best-effort，不因删失败而报错）。
7. **返回**：`url = webServer.getOrigin() + '/feiyu-say/audio/' + encodeURIComponent(文件名)`。

临时文件（`os.tmpdir()` 下的 wav0/wav1/wav8）在 `finally` 里删。

### 6.3 并发

模块级单队列（不是排队执行，是**忙时快速失败**）：

```js
let 忙 = false
async function 独占(fn) {
  if (忙) return { ok: false, 说: '正在合成上一条语音，等它出来再试（约 30–60 秒）。' }
  忙 = true
  try { return await fn() } finally { 忙 = false }
}
```

`send_voice` 与 `/preview` 都走 `独占`。部署与合成互斥（部署中禁止合成，给明确提示）。

### 6.4 超时

- CosyVoice：`timeoutMs`（默认 240s）
- RVC：`timeoutMs`
- ffmpeg：60s
- 整条链路不设总超时（逐步超时已经覆盖）；工具返回前必须 `finally` 释放忙锁。

---

## 7. 音频服务与试听

### 7.1 路由总表

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | `/feiyu-say/config` | 读/写配置（旋钮 + JSON 字段，一次提交，宿主内部拆分） |
| GET/POST | `/feiyu-say/voices` | 列声线 / 导入声线 |
| GET/POST | `/feiyu-say/deploy` | 读部署状态 / 开始或继续部署 |
| POST | `/feiyu-say/selfcheck` | 跑自检（可选真合成） |
| POST | `/feiyu-say/preview` | 试听：合成短句，返回可播放 URL |
| GET/HEAD | `/feiyu-say/audio/*` | 提供 WAV 文件（`kind: 'prefix'`，path 以 `/feiyu-say/audio/` 开头） |

所有路由都用 `ctx.effect(() => ctx.webServer.register({...}))` 注册，返回 disposer。

### 7.2 `/audio` 实现要求

```js
const 名 = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice('/feiyu-say/audio/'.length))
if (!/^[A-Za-z0-9._-]{1,80}\.wav$/.test(名) || 名.includes('..')) return 404
const 根 = realpathSync(音频目录)
const 文件 = realpathSync(join(根, 名))
if (!文件.startsWith(根 + sep)) return 404
```

- 只允许 `.wav`；只允许 GET/HEAD。
- `Content-Type: audio/wav`、`Content-Length`、`Accept-Ranges: bytes`、`Cache-Control: no-store`。
- 支持 `Range: bytes=a-b`（206），方便 `<audio>` 拖动。
- 文件不存在 → 404 JSON `{ok:false,说:'音频不在了'}`。

### 7.3 `/preview`

```json
POST { "text": "这是试听，一二三四五。", "voice": "zyyv2" }
→ { "ok": true, "url": "http://127.0.0.1:60453/feiyu-say/audio/feiyu-….wav",
    "path": "/…/feiyu-….wav", "声线": "zyyv2", "采样率": 24000, "耗时ms": 41230 }
```

- `text` 默认「这是试听，一二三四五。」，最长 120 字。
- `voice` 可选：只影响这一次试听，不改 `当前声线`。
- 走同一个忙锁；忙时返回 `{ok:false,说:'正在合成…'}`，前端提示稍等。
- 前端拿到 `url` 后直接 `new Audio(url).play()`，并渲染 `<audio controls src=url>`。

### 7.4 设置页试听区

- 一行输入框（预填默认文案）+「试听」按钮 + 播放器。
- 合成中显示已用秒数（前端计时），按钮禁用。
- 完成后显示：声线、采样率、耗时、文件路径（可复制）。

---

## 8. 工具面

工具定义放 `lib/tools.mjs`，导出 `做工具({ 取配置, 独占 })`。

注册位置：`agent.ctx.tools.register(def)`（见 §10），**不要**注册在插件全局 ctx（那会对所有会话生效且不受 agent 生命周期管理）。

### 8.1 `send_voice`

```json
{
  "name": "send_voice",
  "description": "合成一句语音（本机 CosyVoice + 可选 RVC 换声），输出 WAV 文件，约 30–60 秒出音。想撒娇、认真说一句、有情绪的时候用它；短句 1–2 句最好。要发 QQ 语音条时传 sampleRate: 8000（QQ 会把 24k 转坏）；只在网页/本地听用默认。合成完返回文件路径和试听 URL，怎么发出去由当前会话的传输方式决定。",
  "parameters": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "要念出来的话（1–2 句，短一点）" },
      "sampleRate": { "type": "number", "enum": [8000, 16000, 22050, 24000, 44100], "description": "可选：这次输出的采样率。发 QQ 语音条用 8000；不传用全局默认" },
      "noRvc": { "type": "boolean", "description": "可选：这一条跳过换声，只用 CosyVoice 原声（快一点）" }
    },
    "required": ["text"],
    "additionalProperties": false
  }
}
```

`execute` 语义：

- `enabled === false` → `{ok:false, 说:'语音功能被关了（设置 → 插件 → feiyu-say 的总开关）'}`（正常情况下关闭时工具根本不会注册，见 §10）。
- 空文本 → `{ok:false, 说:'要给我一句要念的话'}`。
- 未配置 `cosy脚本` / 文件不存在 → 明确说缺哪个字段、去哪里填。
- 当前声线不是 `原声` 但 `模型目录` 为空 → 明确说。
- 忙 → §6.3 的话术。
- 成功 → `{ok:true, 说:'语音合成好了', 路径, url, 声线, 采样率, 耗时ms}`，`render` 输出「路径 + 试听 URL」。

`output.schema` 增加 `路径`、`url`、`声线`、`采样率`、`耗时ms`，全部 `additionalProperties: true`。

### 8.2 `voice_list` / `voice_switch`

保持现有语义，`voice_list` 输出里补：

- 每条声线标 `（缺模型）`（文件不存在时）
- 末尾一行「当前默认采样率：24000Hz」

`voice_switch` 切到缺模型的声音时**允许切，但返回警告**：`已切到「x」，但它的模型文件不存在，下一次 send_voice 会报错。`

### 8.3 `voice_download`

- 只接受 `https?://`；先写 `.part`，校验后 rename。
- 校验：HTTP 200、`content-length` 合理（`.pth` 10MB–2GB，`.index` 100KB–500MB）、`.pth` 前 2 字节 `PK`、内容不是 HTML。
- 目标文件名只允许 `[A-Za-z0-9_-]`。
- 下载成功才注册声线并切换。

### 8.4 `voice_status`

增加可选参数 `test: boolean`（默认 false）。返回结构化检查（同时 `说` 里给人类可读版）：

```json
{ "ok": true, "就绪": false, "说": "…", "项": [
  { "名": "cosyPython", "ok": true, "详情": "/…/python 3.11" },
  { "名": "cosy仓库", "ok": true, "详情": "…" },
  { "名": "cosy模型", "ok": false, "详情": "缺 cosyvoice2.yaml" },
  { "名": "rvcPython", "ok": true, "详情": "…" },
  { "名": "ffmpeg", "ok": true, "详情": "6.1" },
  { "名": "当前声线", "ok": false, "详情": "zyyv2 的 zyyv2.pth 不存在" },
  { "名": "音频目录", "ok": true, "详情": "可写" },
  { "名": "上次部署", "ok": true, "详情": "完成 · 2026-11-05 15:00" }
] }
```

`test: true` 时额外跑一句 1 秒真合成，返回耗时和输出大小；失败把 stderr 尾带上。

---

## 9. 设置页 UI

仍注册到 `settings.section`（已验证本机 slot 可用）：

```js
slots.inject('settings.section', () =>
  slots.register(
    { name: 'settings.section', id: 'feiyu-say', order: 55, label: () => '鱼的声音' },
    Section,
  ),
)
```

### 9.1 信息架构

```
鱼的声音
├─ 状态条：就绪 / 未配置 / 部署中 / 失败 + 「运行自检」
├─ 快速开始
│   ├─ 未就绪：一键部署（写明约 3–6GB / 30–90 分钟）+ 阶段进度 + 最新 5 行日志
│   └─ 已就绪：试听（输入框 + 试听按钮 + <audio> + 结果信息）
├─ 声线
│   ├─ 当前声线下拉（来自 /voices，缺模型的标 ⚠）
│   ├─ 导入声线（名字 / .pth 路径或 URL / index 可选）
│   └─ 模型目录（只读展示，可复制）
├─ 高级（默认折叠）
│   ├─ 输出：采样率、超时、音频目录、音频保留数
│   ├─ CosyVoice：python、脚本、仓库目录、模式、说话人、模型目录、风格、参考音频/文字、语速
│   ├─ RVC：python、目录、ffmpeg
│   ├─ 语音提示：开关 + 文案
│   └─ 部署源：cosy仓库、cosy模型源、rvc模型地址、部署目录
└─ 保存设置（底部，带状态文本）
```

### 9.2 交互要求

- 保存时**一次提交全部字段**；宿主拆分写入，返回 `{ok, 说, 写入:{旋钮, 文件}}`；部分失败要明说哪个失败。
- 部署进度：`state==='进行中'` 时每 1.5s 拉一次 `/deploy`，显示步骤列表（✓/✗/…）和耗时；完成后停止轮询。
- 所有按钮在请求期间 `disabled`，文案变「…中」。
- 试听结果保留在页面上，刷新后消失（不做持久化）。
- 用 `--dsw-alias-*` 主题 token（`Theme` inspect 可查），**删掉写死的 `#3b82f6`**；边框、文字、背景都走 token。
- 控件要有 `<label>`；音频控件用原生 `<audio controls>`。
- 页面正文中文；`label` 和 locale meta 提供中英两套（按 `navigator.language` 选）。
- 不要 `require` 任何 DSH Client 包，不写 DOM 到 `document.body`。

### 9.3 与原生设置页的关系

`Config` 的 5 项同时会出现在「插件」原生设置页。若调用 `configure({auto:false})` 隐藏原生表单，要验证 `describe()` 仍返回本行；否则保留两份（写的是同一份数据，不会分叉）。

---

## 10. 语音提示与 agent 生命周期（替换 5 秒轮询）

### 10.1 注册

```js
const agent注册 = new Map()   // agent.id -> disposer

function 装到(agent) {
  const sid = String(agent.id || agent.session?.id || '')
  if (!sid || agent注册.has(sid)) return
  const 配置 = 旋钮()
  try {
    const off = agent.ctx.effect(() => {
      const 卸 = []
      if (配置.enabled) {
        for (const 工具 of 做工具()) 卸.push(agent.ctx.tools.register(工具))
      }
      if (配置.hintEnabled) {
        const 提示 = agent.ctx.systemPrompt.section({
          name: 'feiyu-say.hint',
          order: 90,
          text: () => 提示文案(),      // 函数：改文案不用重挂
        })
        卸.push(提示)
      }
      return () => { for (const f of 卸) { try { f() } catch {} } }
    })
    agent注册.set(sid, off)
  } catch (e) {
    console.warn('[feiyu-say] 给 agent 装卸失败：' + String(e?.message || e))
  }
}

ctx.on('agent/created', ({ agent }) => 装到(agent))
ctx.on('agent/disposed', ({ agent }) => {
  const sid = String(agent.id || '')
  const off = agent注册.get(sid)
  agent注册.delete(sid)
  try { off?.() } catch {}
})
```

为什么这样：

- 平台实践明确要求「per-agent 行为注册在 `agent.ctx`，在 `agent/created` 里拿」；agent 销毁会自动清掉，插件卸载再由 `ctx.effect` 兜底。
- **不会再出现**「会话关闭再打开、工具永远不回来」——旧代码的 `工具挂着` 以 sid 为键且永不清理，重开同一个 session 时直接跳过注册。
- 新会话**立即**有工具，不用等 5 秒。

### 10.2 总开关 / 提示开关变化时 reconcile

```js
ctx.on('settings/document-updated', (ns) => {
  if (String(ns) !== 'feiyu-say') return
  for (const agent of ctx.agents.list()) {
    const sid = String(agent.id || '')
    try { agent注册.get(sid)?.() } catch {}
    agent注册.delete(sid)
    装到(agent)
  }
})
```

同时监听 `system-prompt/change`？不需要：`text` 是函数，文案改动会在下一次组装时自动生效。只有「开关」需要重挂。

### 10.3 提示文案

默认：

```
想用声音说这句话就调 send_voice（短句 1–2 句，30–60 秒出音）。
这条要发 QQ 语音条就传 sampleRate: 8000；只在网页/本地听用默认采样率。
不想说就正常回文字。
```

`order` 用 90；`name` 唯一（`feiyu-say.hint`）。同层同名会抛错，别用通用名。

---

## 11. 生命周期与清理清单

| 资源 | 注册方式 | 清理 |
|---|---|---|
| 6 条 HTTP 路由 | `ctx.effect(() => webServer.register(...))` | effect 自动 |
| 每个 agent 的工具 + 提示 | `agent.ctx.effect` | agent 销毁自动 + `agent注册` 兜底 |
| `settings/document-updated` 监听 | `ctx.on` | 插件卸载自动 |
| 部署子进程 | 模块级 | 插件卸载时 kill 进程树，状态改 `中断` |
| 忙锁 | 模块级 | `finally` 释放 |

**禁止**：`setInterval` 扫 agent；在 `session/event` 里全量扫历史；往 `document.body` 写 DOM。

---

## 12. 安全与健壮性

1. **配置写入白名单**：只接受 §4 列出的键；未知键丢弃并回一条 `说`。类型不对 → 400。
2. **路径**：路径类字段必须绝对路径，`resolve` 后不得含 `..`；`ffmpeg` 允许裸命令名。
3. **`/voices` 导入**：源必须是 `https?://` 或存在的绝对路径；复制进 `模型目录` 时目标名由服务端生成，绝不使用用户给的路径。
4. **下载**：只 http(s)、限 4GB、流式写 `.part`、校验后 rename、失败删 `.part`。
5. **部署**：`git clone` 的 URL 来自配置，等于让用户执行第三方代码——按钮文案要写明「会克隆并安装第三方 Python 包」，只接受显式点击。
6. **CSRF**：POST 必须 `content-type: application/json`；若请求带 `sec-fetch-site` 且不是 `same-origin`/`none`，403。
7. **日志**：不打印完整配置（里面有本机路径）；只打印字段名和结果。
8. **原子写**：配置文件 tmp + `renameSync`，写前备份 `.bak`；读到坏 JSON 用默认值并 `console.warn`，不覆盖原文件（先备份）。
9. **单实例**：部署锁 + 合成锁；跨进程用状态文件 pid 判断。

---

## 13. 发布物

### 13.1 `package.json`

```json
{
  "name": "dsh-feiyu-say",
  "version": "0.3.0",
  "description": "本机 CosyVoice + RVC 合成语音，输出 WAV 并可在线试听；支持声线切换与一键部署。",
  "type": "module",
  "engines": { "node": ">=22" },
  "keywords": ["deepseek-harness", "dsh-plugin", "tts", "voice", "cosyvoice", "rvc", "local"],
  "main": "lib/host.js",
  "exports": {
    ".": "./lib/host.js",
    "./client": "./lib/client.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["lib", "locale", "icon.svg", "cordis.patch.yml", "README.md", "CHANGELOG.md", "LICENSE"],
  "dependencies": { "@deepseek-ai/schemastery": "^3.18.1" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["slots"], "external": ["react"] }
  }
}
```

### 13.2 locale 与 icon

`locale/zh.json`：

```json
{ "meta": { "title": "鱼的声音", "description": "本机 CosyVoice + RVC 合成语音，输出 WAV 文件，可在设置页试听。" } }
```

`locale/en.json`：

```json
{ "meta": { "title": "Feiyu Voice", "description": "Local CosyVoice + RVC speech synthesis that writes WAV files and previews them in Settings." } }
```

`icon.svg`：原创 128×128，圆角底 + 声波/鱼形，`currentColor` 或双色（深/浅都能看），≤ 10KB，不引用外部字体/图片。提交前用浏览器打开确认能渲染。

### 13.3 README 大纲（全文重写）

1. **它是什么**：本机 TTS → WAV；不绑定 IM；投递交给会话。
2. **能力**：5 个工具、可选声线、试听、一键部署、自检。
3. **安装**：在 DSH 插件管理里安装本包（或让代理执行 `plugin_manager install_bundle`，target 为包目录）；`link:` 本地开发方式单独一段。**不要**写未经验证的 `dsh plugin add` 作为唯一方式。
4. **前置**：macOS（优先）/ Windows / Linux；Python 3.9+、git、ffmpeg、≥ 12GB 磁盘、能访问 PyPI/ModelScope/GitHub。
5. **一键部署**：耗时、体积、失败怎么办、如何续跑；默认不下发 RVC 模型。
6. **配置表**：Config 5 项 + JSON 字段，标清默认值（尤其 `音频目录` 默认是 `os.tmpdir()/feiyu-say`，不是 `/tmp/feiyu-say`）。
7. **采样率**：默认 24000；QQ 语音条用 8000（附原因）。
8. **工具表**：5 个工具 + `voice_status(test)`。
9. **排错**：自检、日志位置 `~/.dsh/feiyu-say/deploy.log`、常见错误（没有 `cosyvoice` 模块 / 模型缺失 / ffmpeg 不在 PATH）。
10. **License / 第三方**：CosyVoice、RVC、声线模型的授权归属；不捆绑第三方声线。

### 13.4 CHANGELOG

新增 `CHANGELOG.md`，记录 0.3.0：可信部署、Config 化、试听、生命周期修复、采样率、发布资源。

---

## 14. 测试

### 14.1 单元测试（`node --test test/*.test.mjs`）

- 配置合并优先级（Config > JSON > 默认）
- v1→v2 迁移幂等
- clamp（采样率/超时/保留数/路径）
- 声线发现 + 缺模型标记
- 音频文件名校验（`..`、非 wav、超长）
- 路径 containment（`realpath` 前缀判断）

### 14.2 冒烟（`node test/smoke.mjs`，手工跑）

- 读真实配置 → 列检查项 → 可选真合成一句 → 打印耗时/大小/URL。
- 不修改用户配置。

### 14.3 手工验收（§15）

---

## 15. 验收清单（DoD）

1. **可信部署**：故意把 `cosy仓库` 改成一个不存在的 URL 再部署 → 状态 `失败`、阶段 `装 CosyVoice`、错误含 `Could not resolve host`；**没有**出现 `完成`。
2. **import 修复**：部署成功后 `PYTHONPATH=<repo> <cosyPython> -c "import cosyvoice"` 退出码 0；`send_voice` 能出文件。
3. **自检**：`POST /selfcheck` 返回逐项结果；坏一项时 `ok:false` 且指出哪项。
4. **试听**：设置页点「试听」→ ＜90 秒内出现 `<audio>` 且能播放；`GET /feiyu-say/audio/<name>` 返回 200 + `audio/wav`；`Range` 请求返回 206。
5. **生命周期**：新会话创建后**立即**能调 `send_voice`；关闭会话再打开，工具仍在（不重启 DSH）。
6. **总开关**：关闭后当前会话工具列表里 `send_voice` 消失；打开后 1 秒内回来。
7. **严格失败**：把当前声线的 `.pth` 改名 → `send_voice` 返回 `ok:false`，文案含声线 id 和缺失路径；**不会**退化成原声返回成功。
8. **并发**：快速连调两次 `send_voice` → 第二次立即返回「正在合成上一条」，`ps` 里只有一个 RVC 进程。
9. **采样率**：`sampleRate: 8000` 的输出用 `ffprobe` 看是 8000Hz 单声道；默认是 24000Hz。
10. **配置**：`dsh --dump-config` 能看到 `enabled/sampleRate/hintEnabled/hintText/timeoutMs`；设置页保存后值立即生效。
11. **展示**：Plugin Manager 和设置侧栏显示「鱼的声音 / Feiyu Voice」、描述和图标（无回退名、无默认图）。
12. **安全**：`GET /feiyu-say/audio/..%2F..%2Fetc%2Fpasswd` → 404；`POST /config` 带未知键 → 被丢弃且有提示。
13. **兼容**：用现有配置（`cosy模式=custom`、`rvc目录=/tmp/...`、两条声线）升级后，能正常合成；`voice_status` 对 `/tmp` 路径标黄但不判死。

---

## 16. 实施顺序（建议按 PR 切）

| PR | 范围 | 验收 |
|---|---|---|
| **P0 部署可信 + import 修复** | `deploy.mjs`、命令执行器、阶段校验、`cosy_say.py` 的 `--repo` + `PYTHONPATH`、严格声线校验、原子写 | DoD 1/2/3/7/13 |
| **P1 生命周期** | `agent/created` 注册、`agent/disposed` 清理、`settings/document-updated` reconcile、删 5s 定时器 | DoD 5/6/8 |
| **P2 配置** | `Config` + `hostdeps.mjs`、JSON 拆分、迁移、clamp、`/config` 拆分写 | DoD 10/13 |
| **P3 试听** | `/audio`、`/preview`、`/selfcheck`、设置页播放器、采样率 | DoD 4/9/12 |
| **P4 发布** | locale、icon、README、package.json、CHANGELOG、安全收敛 | DoD 11/12 |
| **P5 可选** | 部署续跑/进度细化、日志轮转、音频裁剪 | 手工 |

每个 PR 都要能单独重启验证；不要一次全改完再测。

---

## 17. 风险与边界

| 风险 | 影响 | 应对 |
|---|---|---|
| CosyVoice 的 `requirements.txt` 钉死 `torch==2.3.1` 等 | 新 Python/新系统上装不上 | preflight 检查 Python 版本；失败信息给出版本要求；不静默继续 |
| 模型下载 1–4GB、依赖数 GB | 部署几十分钟到几小时 | UI 明确写预计；支持续跑；日志可查 |
| macOS CPU 上 RVC 慢（30–60 秒/句） | 体验差、工具阻塞 | 文案写清；忙时快速失败；不承诺更快 |
| `settings` / `volatile` 是宿主内部行为，可能随版本变 | Config 写不进去 | 每次写都从 `describe()` 取 revision；失败降级到 JSON 并明说 |
| `@deepseek-ai/schemastery` 在 `link:` 场景拿不到 | 无 Config | `hostdeps` 从 profile 树找；再找不到就降级，插件本体照常 |
| 第三方声线模型授权 | 不能默认分发 | 默认不下发；用户自备 |
| 端口/来源 | 外网可达时路由暴露 | 路径收敛 + CSRF 头校验；文档提醒不要把 DSH Web 暴露公网 |

---

## 附录 A：本机已验证的平台事实（实现时别再猜）

1. **事件**：`agent/created`（serial，payload `{agent, source, signal?}`）、`agent/disposed`（emit，payload `{agent}`）、`settings/document-updated`（emit，`(ns, revision)`）。
2. **per-agent 注册**：平台实践要求「在 `agent/created` 里拿 `agent.ctx`，用 `agent.ctx.effect()` 包住，插件自己再按 agent 存一份 disposer」。
3. **`systemPrompt.section`**：`text` 可以是 `string | ((ctx) => string)`；同一层同名 section 会抛错；scoped section 会遮蔽同名 global。
4. **`webServer.register`**：`kind: 'exact' | 'prefix'`；返回 disposer；`getOrigin()` 给出本机 URL。
5. **`settings`**：`describe()` 返回 `{ns, autoGenerate, schema, value, revision, …}[]`；`update(ns, patch, revision)` 合并可编辑字段；`configure({auto:false})` 控制原生表单；ns = Loader 条目 id（本插件是 `feiyu-say`）。
6. **Config**：字段用 `z.xxx().default(...).extra('volatile', true)`；只有 volatile 字段会出现在设置表里。
7. **`spawn(..., { cwd: '' })`**：Node 会当成进程当前目录（实测 `pwd` 输出启动目录），不会报错——所以旧代码「`rvc目录=''` 也能跑」是假象，别依赖。
8. **模块解析**：从 `link:` 的插件目录裸 `import '@deepseek-ai/schemastery'` → `MODULE_NOT_FOUND`（实测）；`~/.dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery` 存在。
9. **CosyVoice 仓库**：没有 `setup.py` / `pyproject.toml`；`requirements.txt` 只装第三方依赖，**不会**把 `cosyvoice/` 装进 site-packages（已验证）。
10. **`dsh` CLI**：本机没有 `dsh` 命令；README 不要把 `dsh plugin add` 写成唯一安装方式。
11. **`send_voice` 现状**：工具已正确注册到当前会话（`Tool` inspect 可见 5 个），`settings.section` 的 `feiyu-say` 也是 active——骨架没问题，问题在实现细节。

## 附录 B：最终配置样例（迁移后）

```json
{
  "_版本": 2,
  "cosyPython": "/Users/me/.dsh/feiyu-say/cosy-venv/bin/python",
  "cosy脚本": "/…/plugins/dsh-feiyu-say/lib/cosy_say.py",
  "cosy仓库目录": "/Users/me/.dsh/feiyu-say/CosyVoice",
  "cosy模式": "sft",
  "cosy说话人": "中文女",
  "cosy参考音频": "",
  "cosy参考文字": "",
  "cosy风格": "cute",
  "cosy语速": 1.0,
  "cosy仓库": "https://github.com/FunAudioLLM/CosyVoice.git",
  "cosy模型源": "iic/CosyVoice2-0.5B",
  "cosy模型目录": "/Users/me/.dsh/feiyu-say/CosyVoice2-0.5B",
  "rvcPython": "/Users/me/.dsh/feiyu-say/rvc-venv/bin/python",
  "rvc目录": "",
  "模型目录": "/Users/me/.dsh/feiyu-say/rvc-models",
  "ffmpeg": "ffmpeg",
  "音频目录": "/Users/me/.dsh/feiyu-say/audio",
  "音频保留数": 200,
  "部署目录": "/Users/me/.dsh/feiyu-say",
  "rvc模型地址": "",
  "当前声线": "原声",
  "声线": []
}
```

```json
// cordis.patch.yml 里可覆盖的 Config（如果用户想钉死）
- insert:
    - id: feiyu-say
      name: 'dsh-feiyu-say'
      config:
        sampleRate: 8000
        hintEnabled: true
```

## 附录 C：错误文案表（全部中文、带下一步）

| 场景 | 文案 |
|---|---|
| 总开关关闭 | 语音功能被关了（设置 → 插件 → feiyu-say 的总开关） |
| 空文本 | 要给我一句要念的话 |
| 缺 cosy 脚本 | 没配 CosyVoice 合成脚本（cosy脚本），去「鱼的声音 → 高级」填好 |
| 缺 cosy 仓库目录 | 没配 cosy仓库目录，先跑一次「一键部署」，或在「高级」里填 CosyVoice 仓库路径 |
| 缺模型目录 | 要换声但没配「模型目录」 |
| 声线模型缺失 | 声线「{id}」的模型文件不存在：{path}。去设置页重新导入，或 voice_list 换一条。 |
| RVC 失败 | RVC 换声失败（声线 {id}）：{stderr尾} |
| cosy 失败 | CosyVoice 合成失败（模式 {mode}）：{stderr尾}。voice_status 看哪项没就绪。 |
| ffmpeg 失败 | ffmpeg 转码失败（{rate}Hz）：{stderr尾} |
| 忙 | 正在合成上一条语音，等它出来再试（约 30–60 秒）。 |
| 部署中 | 正在部署环境（{阶段}），装完再合成。 |
| 部署失败 | 部署失败在「{阶段}」：{错误}。点「从失败处继续」，或看 ~/.dsh/feiyu-say/deploy.log |
| 音频不存在 | 音频不在了（可能被音频目录的保留数清掉了） |
| 配置写失败 | 配置没写进去：{原因}。检查 ~/.dsh 的写权限。 |
