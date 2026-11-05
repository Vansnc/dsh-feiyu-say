# Changelog

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
