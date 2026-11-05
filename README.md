# dsh-feiyu-say

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一个「**本机合成语音**」的插件。

一句话：把想说的话用本机 **CosyVoice + RVC** 合成成 WAV 文件，可在设置页试听，**不绑定任何 IM**——怎么发出去（QQ / 微信 / 就放着）由当前会话的传输方式决定。

## 能力

- `send_voice`：合成一句语音，返回文件路径 + 试听 URL；发 QQ 语音条时传 `sampleRate: 8000`。
- `voice_list` / `voice_switch` / `voice_download`：列、切、下载声线（RVC 模型）。
- `voice_status`：逐项自检依赖；`test: true` 额外真合成一句。
- 试听：设置页输入一句、点「试听」，`<audio>` 直接播放。
- 一键部署：自动建 venv、装 CosyVoice/RVC、下模型、配好路径、自检合成。
- 每轮语音提示：可开关，提醒模型「想用声音就说」。

## 安装

在 DSH **插件管理**里安装本包（`plugin_manager install_bundle`，target 传包目录/包名），装完重启 DSH。

本地开发用 `link:` 挂源码目录。

> 本机没有 `dsh` 命令行，README 不把 `dsh plugin add` 写成唯一方式。

## 前置

- macOS（优先）/ Windows / Linux（尽力兼容）
- Python 3.9+、git、ffmpeg、≥ 12GB 磁盘
- 能访问 PyPI / ModelScope / GitHub（一键部署要下模型）

## 一键部署

设置页点「一键部署环境」：会克隆并安装第三方 Python 包（CosyVoice、rvc-python），下载约 3–6GB，耗时几十分钟到几小时。任一步失败都会**停在那一阶段并写明原因**，不会假装成功；可以重跑，已完成阶段会跳过。

**默认不下发第三方声线模型**（授权风险）。首装只保证「原声」可用；要换声，在设置页「导入声线」导自己的 `.pth`（本地路径或 URL，可选 `.index`）。

## 配置

- **5 项旋钮进插件 Config**（`dsh --dump-config` 可见）：`enabled`、`sampleRate`、`hintEnabled`、`hintText`、`timeoutMs`。
- 其余字段存 `~/.dsh/feiyu-say-config.json`（`DSH_HOME` 优先）：CosyVoice/RVC 路径、模型目录、声线列表、部署源等。

| 键 | 默认 | 说明 |
|---|---|---|
| `sampleRate` | `24000` | 输出采样率；QQ 语音条用 `8000` |
| `音频目录` | 系统临时目录 `feiyu-say/` | 合成出的 WAV 存哪 |
| `音频保留数` | `200` | 最多保留几条，超出按时间删旧的 |
| `cosy模式` | `sft` | `sft`=原声 / `zero_shot`=克隆参考音频 / `custom`=老的自定义脚本 |
| `rvc模型地址` | 空 | GitHub Release 下载根地址（空 = 不自动下 RVC） |

## 采样率

默认 **24000Hz 单声道**。QQ 语音条只能吃 8kHz，24k 会被客户端转坏——所以发 QQ 时传 `sampleRate: 8000`；网页/本地听用默认。

## 工具

| 工具 | 作用 |
|---|---|
| `send_voice(text, sampleRate?, noRvc?)` | 合成一句，返回路径 + 试听 URL |
| `voice_list` | 列声线（标缺模型、带 index） |
| `voice_switch(id)` | 切声线 |
| `voice_download(name, modelUrl, indexUrl?)` | 下载并注册声线 |
| `voice_status(test?)` | 依赖自检；`test:true` 真合成 |

## 排错

- 先点设置页「运行自检」，逐项看哪项红。
- 部署日志：`~/.dsh/feiyu-say/deploy.log`。
- 常见：`import cosyvoice` 失败（缺 Xcode CLT / 依赖没装全）、模型缺失（去导入）、ffmpeg 不在 PATH（`brew install ffmpeg`）。

## License / 第三方

MIT。合成依赖 CosyVoice、RVC 与声线模型，其授权归属各自作者；本插件**不捆绑**任何第三方声线模型。

## 变更

见 [CHANGELOG.md](CHANGELOG.md)。
