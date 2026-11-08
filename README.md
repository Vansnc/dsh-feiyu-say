# dsh-feiyu-say

[![npm](https://img.shields.io/npm/v/dsh-feiyu-say)](https://www.npmjs.com/package/dsh-feiyu-say)
[![license](https://img.shields.io/npm/l/dsh-feiyu-say)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-informational)](https://nodejs.org/)


给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一个「**合成语音**」的插件。

调 **阿里百炼** 的 TTS WebSocket 接口，把一句话合成成 WAV，可在设置页试听。**不绑定任何 IM**——怎么发出去（QQ / 微信 / 就放着）由当前会话的传输方式决定。

**没有本地模型、没有 Python、不用部署**：插件本身只依赖 Node 22、`ws` 和 `ffmpeg`。

## 能力

- `send_voice`：合成一句语音，返回文件路径 + 试听 URL；发 QQ 语音条时传 `sampleRate: 8000`。
- `voice_list`：看当前音色 / 模型 / 接口。
- `voice_status`：检查 API Key / 模型 / 音色 / 地址 / ffmpeg；`test: true` 额外真合成一句。
- **试听**：设置页输入一句、点「试听」，`<audio>` 直接播放。
- **语音提示三档**：`off` / `auto`（看气氛）/ `always`（每轮都提），提醒模型「想用声音就说」。
- 采样率可配：默认 24000Hz；QQ 语音条传 `8000`。

## QQ 语音条（子功能）

QQ 桥（`dsh-qq-link`）只发文字 / 图片 / 文件，**没有语音条这一路**；`send_voice` 只是把 wav
合成到本地。所以开了这个，合成完会顺手发出去：

1. ffmpeg 转成 **8kHz 单声道**（QQ 会把 24k 直发转成卡带声）；
2. 直接调 NapCat 的 `send_private_msg`，发 `record` 段；
3. 按「文件路径 + mtime」去重，同一段不会发两遍。

设置 → 鱼的声音 → **QQ 语音条**：

| 项 | 默认 | 说明 |
|---|---|---|
| 合成完自动发成 QQ 语音条 | 开 | 关掉就只合成、发送交给别处 |
| 只在桥绑定的那间会话发 | 开 | 网页里试听、调试的不往 QQ 甩 |
| NapCat 地址 | 空 | 留空 = 用「通到 QQ」里填的地址 |

桥的总开关关着、或试运行开着，这里一句都不发。发失败会在控制台留一行 `[feiyu-say] 发语音条失败：…`。

## 前置

- Node.js 22+
- `ffmpeg`（把百炼返回的 mp3 转成目标采样率单声道 WAV）
- 阿里百炼的 **API Key**，以及一个开通了 TTS 模型的业务空间

## 安装

**npm**：插件管理里输入包名，装完**重启 DSH**。

```
dsh-feiyu-say
```

**从 GitHub 源码**：

```
github:Vansnc/dsh-feiyu-say
```

**本地开发**用 `link:`：

```sh
ln -s /path/to/dsh-feiyu-say ~/.dsh/profiles/desktop/node_modules/dsh-feiyu-say
```

> 宿主不会热替换已加载的模块，改完代码必须重启 DSH。

## 配置

设置 → 鱼的声音，填四项：

| 字段 | 说明 |
|---|---|
| `百炼ApiKey` | 百炼控制台 → API-KEY 创建；**只显示一次**，存好。也可以改用环境变量 `DASHSCOPE_API_KEY` |
| `百炼模型` | 默认 `qwen-audio-3.1-tts-flash`；CosyVoice 模型也可 |
| `百炼音色` | 默认 `longanhuan_v3.1`；复刻得到的 `voice_id` 直接填这里 |
| `百炼地址` | `wss://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`（控制台「业务空间」里看 WorkspaceId） |

高级里还能改：采样率、超时、音频目录、保留条数、ffmpeg 路径。

配置存在 `~/.dsh/feiyu-say-config.json`（权限 0600，因为里面有 Key）；`enabled` / `sampleRate` / `hintMode` / `timeoutMs` 四项在插件 Config 里。

## 接口

百炼这套是 WebSocket：

```
run-task（model / voice / format / sample_rate）
  → task-started
  → continue-task(text) + finish-task
  → 二进制音频帧
  → task-finished
```

实现见 [`lib/bailian.mjs`](lib/bailian.mjs)；返回 mp3，`ffmpeg` 转成目标采样率的单声道 WAV。

## 费用与隐私

- **文本会发到阿里云**，按字符计费；具体单价看百炼对应模型的定价页。
- 合成返回的是 24 小时有效的临时 URL，插件会当场下载，不存 URL。
- 只使用你有权使用的声音样本/音色。

## 排错

- 先跑 `voice_status`（或设置页「运行自检」），它会逐项说哪项没就绪。
- **401**：API Key 错、地域不对、或地址和 Key 不匹配。
- **403 / 模型无权限**：模型没开通，或业务空间没授权。
- **task-failed**：看返回的 `error_message`；常见是音色 ID 不存在、文本为空、账户欠费。
- **ffmpeg 失败**：`ffmpeg` 不在 PATH，或高级里填的路径不对。
- 改完代码/配置记得重启 DSH 或刷新设置页。

## License

MIT

## 反馈

- 装不上 / 用不对：先看上面的「排错」和「已知边界」；
- 还是不行就开 [issue](https://github.com/Vansnc/dsh-feiyu-say/issues)，按模板把版本和日志带上；
- 想改代码看 [CONTRIBUTING.md](./CONTRIBUTING.md)。
