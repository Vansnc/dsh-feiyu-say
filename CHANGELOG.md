# Changelog

## 0.6.0

- 新增子功能「QQ 语音条」：`send_voice` 合成完，自动转 8kHz 单声道，直接调 NapCat
  `send_private_msg` 的 record 段发成语音条。QQ 桥本身没有语音这一路，以前只能合成不能发。
- 设置页新增「QQ 语音条」一栏：开关、是否只在桥绑定的会话发、NapCat 地址覆盖。
- 桥的总开关 / 试运行仍然管用；同一段语音按「路径 + mtime」去重。

## 0.5.1（2026-11-06）

**修试听地址：不再把服务端自己绑定的 `127.0.0.1` 写进浏览器。**

### 修复

- `/preview` 的 `url` 改成相对路径 `/feiyu-say/audio/…`，另给一个 `url绝对` 供本机 / 聊天文本用。之前是 `ctx.webServer.getOrigin()` 拼的 `http://127.0.0.1:3080/…`，从域名、反向代理或别的机器打开面板时，这个 `127.0.0.1` 指向用户自己的电脑，音频请求直接失败 → `<audio>` 拿不到 metadata → 播放器时长显示 `0:00`、点了也没声。
- 设置页播放前按当前页面 origin 重新解析地址：同源直接用，跨源只取路径交给当前站点转发；顺带兼容老服务端那种写死 `127.0.0.1` 的返回值。
- 试听信息行补上真实时长（`<audio>` metadata 就绪后显示，如 `· 时长 3.08s`），不用再去播放器上读。
- `<audio>` 加载失败时直接显示那条地址，提示「检查这个地址能不能直接打开」，排查代理问题有据可查。

### 测试

- 新增 `test/urls.test.mjs`，覆盖相对 / 绝对地址拼装与取源失败回退。

## 0.5.0（2026-11-06）

**只保留阿里百炼，本地模型相关逻辑全部删除。**

### 删除

- 本机 CosyVoice 引擎、`cosy_say.py`、`cosy_requirements.txt`、所有 `cosy*` 配置项。
- RVC 换声、`rvc_infer.py`、`rvcPython` / `rvc目录` / `模型目录` / `声线` / `当前声线`。
- 一键部署（`deploy.mjs`、`/feiyu-say/deploy`、`/feiyu-say/voices`）以及相关设置页 UI。
- `voice_switch` / `voice_download` 两个工具（没有本地声线了）。

### 保留 / 简化

- `send_voice` / `voice_list` / `voice_status` 三个工具，全部走百炼。
- 设置页只剩：API Key / 模型 / 音色 / 地址 / 试听 / 语音提示 / 输出设置。
- 合成链路：百炼 WebSocket → mp3 → ffmpeg 目标采样率单声道 → 落盘；RVC 这步彻底没有了。
- 旧配置里的本地路径字段读不进来，下次保存即清掉；四个旋钮仍在插件 Config。
- 未配 Key 时也支持环境变量 `DASHSCOPE_API_KEY`。

## 0.4.0（2026-11-06）

### 阿里百炼引擎（新增，可选）

- 设置页顶部新增「引擎」：`本机 CosyVoice` / `阿里百炼`，默认仍是本机，不动现有链路。
- 百炼走官方 WebSocket 协议（`run-task` → `continue-task` + `finish-task` → 二进制音频帧），纯 Node，不依赖 Python / DashScope SDK。
- 四个参数全部可填：`百炼ApiKey` / `百炼模型`（默认 `qwen-audio-3.1-tts-flash`）/ `百炼音色`（默认 `longanhuan_v3.1`）/ `百炼地址`（默认公共 wss，可换成业务空间域名）。
- 百炼分支：合成 mp3 → ffmpeg 转目标采样率单声道 → 落盘；**不走 RVC**，`voice_switch` / `voice_download` 会明确提示改用「百炼音色」。
- `voice_status` / 设置页「运行自检」在百炼引擎下检查 Key、地址、模型、音色、ffmpeg；`test: true` 才真合成。
- 配置文件写盘改为 `0600`（里面有 API Key）。

### 修复

- `hostdeps.mjs` 按 `package.json` 的 `exports/main` 找 schemastery 入口（原来只找 `lib/index.mjs`，实际是 `lib/index.cjs`，导致 `link:` 安装时 `Config` 恒为 `undefined`）。

## 0.3.0（2026-11-05）

首版按生产要求重做，全部实测跑通（Torch 2.3.1 + CosyVoice2-0.5B zero-shot + RVC zyyv2）。

### 部署（可信）

- 分阶段：环境检查 → 建 venv → 装 CosyVoice 依赖 → 下 CosyVoice 模型 → 装 RVC → 下 RVC 模型 → 写配置 → **自检合成**。
- 每步校验退出码，失败即停并写清阶段；只有自检真的出声且文件有效才写「完成」。
- 可续跑；部署前备份旧配置到 `~/.dsh/feiyu-say/config-before-deploy.json`。
- `git clone --recursive` 拉 Matcha-TTS 子模块；旧 clone 自动补 `git submodule update --init`。
- 依赖改用精简清单 `lib/cosy_requirements.txt`，避开 `gradio` / `deepspeed` / `tensorrt` 等 webui / 训练包。
- **钉死 `torch==2.3.1` / `torchaudio==2.3.1` / `transformers==4.51.3` / `numpy==1.26.4`**——实测新版 torch 会让 CosyVoice2 合成出乱码。
- `rvc-python` 装之前先把 pip 降到 `<24.1`（它钉死的旧 `omegaconf` 元数据不合法）。

### 合成

- 严格失败：RVC 模型缺失 / 换声失败不再静默退回原声。
- 采样率可配：默认 24000Hz，`send_voice` 可传 `sampleRate`（QQ 语音条用 8000）。
- `PYTHONPATH` 同时注入 CosyVoice 仓库与 `third_party/Matcha-TTS`。
- 修 RVC 段错误：补 `KMP_DUPLICATE_LIB_OK=TRUE` + `OMP_NUM_THREADS=1`；强制 CPU（打桩关掉 MPS）。
- 修 RVC 加载：`TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1` + 自己调 `vc_single` 解包，绕开 `rvc-python` 0.1.5 的元组 bug。

### 配置

- 4 项旋钮进插件 Config：`enabled` / `sampleRate` / `hintMode` / `timeoutMs`。
- `hintMode` 三档（仿 dsh-meme 主动发图）：`off` / `auto` / `always`，每档一套固定提示词，不给自由文本。
- 路径默认值全部落在 `~/.dsh/feiyu-say/` 下（模型 / 音频 / CosyVoice / 部署），换机器自动跟随家目录。
- 原子写 + `.bak`；v1 → v2 迁移幂等；兼容旧 `hintEnabled` / `hintText`。

### 生命周期

- 改 `agent/created` / `agent/disposed` / `settings/document-updated`，删除 5 秒轮询；新会话立即有工具。

### 设置页

- 状态条 + 部署进度条（阶段 N/8 · 百分比）。
- 一键部署、试听（`<audio>`）、当前声线下拉、导入声线、语音提示三档、保存。
- 改动即提示：底部浮出「有未保存的修改，点这里保存」。
- 高级折叠：输出 / CosyVoice / RVC / 部署源；声线 JSON 字段美化显示。

### 试听 / 路由

- `/feiyu-say/audio/*`（Range 支持，修了 prefix 路由尾斜杠导致 404 的问题）。
- `/preview`、`/selfcheck`、`/deploy`、`/voices`。
- 路径白名单 + realpath containment；JSON-only POST；无 `shell:true`；未知字段忽略不卡保存。

### 发布

- 补 `locale/{zh,en}.json`、`icon.svg`、`README.md`、`CHANGELOG.md`、`test/`（7 个单测 + 冒烟）。
- 关键词与描述去掉 QQ / OneBot / NapCat。
