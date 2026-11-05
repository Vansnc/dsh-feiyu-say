# dsh-qq-voice

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一个「发 QQ 语音条」的工具。

一句话：**把想说的话，用本机声线合成成 QQ 语音条发出去**。合成链路是
`文本 → CosyVoice 合成 →（可选）RVC 换声 → ffmpeg 8kHz → NapCat 语音消息`，
全程本机，不把文字/音频交给云端 TTS。

## 功能

- **`send_voice` 工具**：模型想「用声音说」时自己调，发一条 QQ 语音条。
- **声线切换**：`voice_list` / `voice_switch` 列出并切换声线。模型目录里的每个 `.pth`
  会自动被发现成一条可切声线；也可以配「原声」（不换声）。
- **下载模型**：`voice_download` 从 URL 拉 `.pth` / `.index` 到模型目录并注册成声线。
- **每轮语音提示**：可开关。开着时往会话系统提示词里塞一句，提醒模型「想用声音就说」；
  关掉就完全不注入（不多花 token）。
- **状态自检**：`voice_status` 看总开关、当前声线、各依赖路径是不是就绪。

## 安装

```sh
dsh plugin --profile desktop add "link:/绝对路径/dsh-qq-voice"
# 或发布到 npm / GitHub 后：
# dsh plugin --profile desktop add dsh-qq-voice
```

装完重启 DSH。`link:` 装的是源码目录，改代码后重启即生效。

## 前置（本机要有，插件不打包这些）

1. **NapCat / OneBot 11**（默认 `http://127.0.0.1:3000`）。
2. **CosyVoice 合成脚本**：一个接受 `--text --style --ref --ref-text --speed --out` 的命令行脚本
   （本仓库作者用的是 macOS 版 `feiyu_speak_mac.py`）。
3. **RVC 运行环境**：一个装了 `rvc_python` 的 venv + RVC 包目录（`rvc目录`）。
4. **ffmpeg**（降到 8kHz 用）。
5. **RVC 模型**（`.pth` / 可选 `.index`），放在「模型目录」里。

> 参考：这套环境和 `qq-bridge/voice/send_voice.sh` 同源。插件把它的硬编码路径抽成了配置。

## 配置

配置存 `~/.dsh/qq-voice-config.json`（首次运行会按默认值生成；也可以手动建）。

| 键 | 默认 | 说明 |
|---|---|---|
| `总开关` | `true` | 关掉 = 不挂工具、不发语音 |
| `QQ号` | 空 | 发到哪个 QQ |
| `NapCat` | `http://127.0.0.1:3000` | OneBot 接口 |
| `cosyPython` | `~/.dsh/cosy-venv/bin/python` | CosyVoice 的 python |
| `cosy脚本` | 空 | 合成脚本绝对路径 |
| `cosy风格` | `cute` | `cute` / `gentle` |
| `cosy参考音频` | 空 | 参考音频绝对路径 |
| `cosy参考文字` | 空 | 参考音频对应的文字 |
| `cosy语速` | `1.0` | 语速 |
| `rvcPython` | `~/.dsh/rvc-venv/bin/python` | RVC 的 python |
| `rvc目录` | 空 | RVC 包目录（`rvc_infer.py` 以它为 cwd 跑） |
| `ffmpeg` | `ffmpeg` | ffmpeg 命令 |
| `模型目录` | 空 | RVC 模型所在目录（自动发现 `.pth`） |
| `当前声线` | `原声` | 当前用的声线 id |
| `声线` | `[]` | 显式声线列表：`[{id,name,model,index,indexRate,protect,noRvc}]` |
| `语音提示` | `false` | 每轮语音提示开关 |
| `语音提示文案` | （见代码默认） | 提示写什么 |
| `超时毫秒` | `240000` | 单个合成阶段的最长等待 |

### 声线写法

```json
{
  "模型目录": "/path/to/rvc-models",
  "当前声线": "zyyv2",
  "声线": [
    { "id": "原声", "name": "原声（不换声）", "noRvc": true },
    { "id": "zyyv2", "name": "ZYYV2", "model": "zyyv2.pth", "index": "zyyv2.index", "indexRate": 0.75, "protect": 0.33 }
  ]
}
```

`模型目录` 里新丢进去的 `.pth` 不用写进 `声线`，`voice_list` 会自动看到它。

## 工具

| 工具 | 作用 |
|---|---|
| `send_voice(text, noRvc?)` | 发一条语音条 |
| `voice_list` | 列声线 |
| `voice_switch(id)` | 切声线 |
| `voice_download(name, modelUrl, indexUrl?)` | 下载模型并注册 |
| `voice_status` | 状态/依赖自检 |

## 说明

- 一条语音通常 30–60 秒（RVC 换声慢）；「原声」会快一些。
- QQ 语音条只能发 8kHz 单声道，24kHz 会被客户端转坏——所以内部固定降到 8k。
- NapCat 读不了 `/tmp` 里的本地文件，所以走 base64 直接塞进 `send_private_msg`。

## License

MIT
