# dsh-feiyu-say

[![npm](https://img.shields.io/npm/v/dsh-feiyu-say)](https://www.npmjs.com/package/dsh-feiyu-say)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一个「**本机合成语音**」的插件。

把想说的话用本机 **CosyVoice**（可选 **RVC** 换声）合成成 WAV，可在设置页试听。**不绑定任何 IM**——怎么发出去（QQ / 微信 / 就放着）由当前会话的传输方式决定。

> **⚠️ 平台支持：目前只有 macOS**
>
> 这个版本（0.3.x）的**一键部署只在 macOS 上实测跑通**。Windows 上会因为两个已知问题失败：
>
> 1. 部署脚本只找 `python3`（Windows 上是微软商店的 0 字节占位符），且报错文案写死了 `brew`；
> 2. 配置里的路径清洗只认 `/` 开头，`C:\…` 会被清空。
>
> Windows 支持在分支 [`feat/windows-oneclick`](https://github.com/Vansnc/dsh-feiyu-say/tree/feat/windows-oneclick)（0.4.0）上开发中：自动下载托管 Python、ffmpeg 变可选、修路径清洗、Windows 上自动跳过装不了的 RVC。**该分支尚未合并，也未在 Windows 上跑完整条部署（装依赖 + 下模型 + 自检合成）**，请勿当作已完成支持。
>
> Linux 未测试，大概率可以参照 macOS 手动配置。

## 能力

- `send_voice`：合成一句语音，返回文件路径 + 试听 URL；发 QQ 语音条时传 `sampleRate: 8000`。
- `voice_list` / `voice_switch` / `voice_download`：列、切、下载声线（RVC 模型）。
- `voice_status`：逐项自检依赖；`test: true` 额外真合成一句。
- **试听**：设置页输入一句、点「试听」，`<audio>` 直接播放（走当前声线，含 RVC）。
- **一键部署**：自动建 venv、装 CosyVoice/RVC、下模型、配好路径、**真合成一句自检**；分阶段、失败即停、可续跑。
- **语音提示三档**：`off` / `auto`（看气氛）/ `always`（每轮都提），提醒模型「想用声音就说」。

## 安装

**npm（推荐）**：插件管理里输入包名，装完**重启 DSH**。

```
dsh-feiyu-say
```

**从 GitHub 源码**（不想走 npm 时）：

```
github:Vansnc/dsh-feiyu-say
```

**本地开发**用 `link:` 挂源码目录：

```sh
ln -s /path/to/dsh-feiyu-say ~/.dsh/profiles/desktop/node_modules/dsh-feiyu-say
```

> 宿主不会热替换已加载的模块，改完代码必须重启 DSH。

## 前置

- **macOS（当前唯一实测支持的平台）**；Windows / Linux 见顶部说明
- Python 3.9+、git、ffmpeg、≥ 12GB 磁盘
- 能访问 PyPI / ModelScope / GitHub（一键部署要装包、下模型）

## 一键部署

设置页点「一键部署环境」，按阶段跑：

```
环境检查 → 建 venv → 装 CosyVoice 依赖 → 下 CosyVoice 模型 → 装 RVC → 下 RVC 模型 → 写配置 → 自检合成
```

- 下载约 **3–6GB**，耗时几十分钟到几小时。
- 任一步失败都会**停在那一阶段并写清原因**，不会假装成功；可以重跑，已完成阶段会跳过。
- **只有自检合成真的出声、且文件有效**，才写「部署完成」。
- 部署前会把旧配置备份到 `~/.dsh/feiyu-say/config-before-deploy.json`。

### 关键版本（踩过的坑，别乱升）

| 包 | 钉死版本 | 原因 |
|---|---|---|
| `torch` / `torchaudio` | `2.3.1` | 新版（实测 2.8）会让 CosyVoice2 **合成出乱码**——能出声但不是人话，且不报错 |
| `transformers` | `4.51.3` | 与 CosyVoice2 验证版本对齐 |
| `numpy` | `1.26.4` | 同上 |

依赖清单在 `lib/cosy_requirements.txt`，只装推理需要的，避开 `gradio` / `deepspeed` / `tensorrt` 等 webui/训练包。

### 默认不下发第三方声线模型

授权风险。首装只保证「原声」可用；要换声，在设置页「导入声线」导自己的 `.pth`（本地路径或 URL，可选 `.index`）。

## 配置

- **4 项旋钮进插件 Config**（DSH 插件配置页可见）：`enabled`、`sampleRate`、`hintMode`、`timeoutMs`。
- 其余字段存 `~/.dsh/feiyu-say-config.json`（`DSH_HOME` 优先）。

路径类默认值全部落在插件自己的数据目录下（`~/.dsh/feiyu-say/`），不依附任何外部工程：

| 键 | 默认 | 说明 |
|---|---|---|
| `sampleRate` | `24000` | 输出采样率；QQ 语音条用 `8000` |
| `hintMode` | `auto` | 语音提示三档：`off` / `auto` / `always` |
| `timeoutMs` | `240000` | 单阶段超时（毫秒） |
| `音频目录` | `~/.dsh/feiyu-say/audio` | 合成出的 WAV 存哪 |
| `音频保留数` | `200` | 最多保留几条，超出按时间删旧的 |
| `部署目录` | `~/.dsh/feiyu-say` | venv / 模型 / 部署状态都在这 |
| `cosy模式` | `sft` | `sft`=原声说话人 / `zero_shot`=克隆参考音频 / `custom`=自定义脚本 |
| `模型目录` | `~/.dsh/feiyu-say/rvc-models` | RVC 模型目录 |
| `cosy模型目录` | `~/.dsh/feiyu-say/CosyVoice2-0.5B` | 公开 CosyVoice2 模型 |
| `cosy仓库目录` | `~/.dsh/feiyu-say/CosyVoice` | CosyVoice 代码仓库 |
| `rvc模型地址` | 空 | GitHub Release 下载根地址（空 = 不自动下 RVC） |

**哪项在哪生效**：

- `cosy说话人` 只在 `sft` 模式生效；`cosy风格` 只在 `custom` 模式生效。
- `cosy仓库` / `cosy模型源` / `rvc模型地址` / `部署目录` 只在**下次部署**时生效（改完不重部署 = 不变）。

## 采样率

默认 **24000Hz 单声道**。QQ 语音条只能吃 8kHz，24k 会被客户端转成「频率很快的卡住」那种声音——所以发 QQ 时传 `sampleRate: 8000`；网页/本地听用默认。

## 工具

| 工具 | 作用 |
|---|---|
| `send_voice(text, sampleRate?, noRvc?)` | 合成一句，返回路径 + 试听 URL |
| `voice_list` | 列声线（标缺模型、带 index） |
| `voice_switch(id)` | 切声线 |
| `voice_download(name, modelUrl, indexUrl?)` | 下载并注册声线 |
| `voice_status(test?)` | 依赖自检；`test:true` 真合成 |

## 设置页

「设置 → 鱼的声音」：

```
状态条 + 部署进度条（阶段 N/8 · 百分比）
快速开始（一键部署 / 试听）
声线（当前声线下拉 + 导入）
语音提示（三档下拉 + 说明）
▸ 高级设置（输出 / CosyVoice / RVC / 部署源）
保存设置（有改动时底部浮出「未保存」提示）
```

## 排错

- 先点设置页「运行自检」（`voice_status` 同源），逐项看哪项红。
- 部署日志：`~/.dsh/feiyu-say/deploy.log`。
- **`import cosyvoice` 失败**：缺 Xcode CLT / 依赖没装全 / Matcha-TTS 子模块没拉（部署会自动补 `git submodule update --init`）。
- **RVC 段错误（退出码 139）**：macOS 上 PyTorch + fairseq 需要 `KMP_DUPLICATE_LIB_OK=TRUE` + `OMP_NUM_THREADS=1`（插件已自动带）。
- **合成出「乱码」但不是报错**：先查 `torch` 版本是不是被升级了（必须 2.3.1）。
- **RVC 在 MPS 上崩**：插件已强制 CPU（`torch.backends.mps.is_available` 打桩成 false）。
- ffmpeg 不在 PATH：`brew install ffmpeg`。

## 卸载

在插件管理里卸载，然后可删数据目录：

```sh
rm -rf ~/.dsh/feiyu-say ~/.dsh/feiyu-say-config.json ~/.dsh/feiyu-say-deploy.json
```

## License / 第三方

MIT。合成依赖 CosyVoice、RVC 与声线模型，其授权归属各自作者；本插件**不捆绑**任何第三方声线模型。

## 变更

见 [CHANGELOG.md](CHANGELOG.md)。
