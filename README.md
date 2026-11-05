# dsh-feiyu-say

[![npm](https://img.shields.io/npm/v/dsh-feiyu-say)](https://www.npmjs.com/package/dsh-feiyu-say)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一个「**本机合成语音**」的插件。

把想说的话用本机 **CosyVoice**（可选 **RVC** 换声）合成成 WAV，可在设置页试听。**不绑定任何 IM**——怎么发出去（QQ / 微信 / 就放着）由当前会话的传输方式决定。

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

- macOS（优先）/ Windows 10+ / Linux
- **git**（必需，要 clone CosyVoice 仓库和 Matcha-TTS 子模块）
- **Python 3.9+**：不用自己装。系统里没有（或者只有微软商店那个 0 字节占位符）时，一键部署会自己下载一份托管运行时放进部署目录，不动系统环境。
- **ffmpeg**：可选。没有就用 Python 侧重采样，合成结果一样。
- ≥ 12GB 磁盘（Windows 上因为要装 CPU 版 torch，实际约 8–10GB）
- 能访问 PyPI / ModelScope / GitHub（一键部署要装包、下模型）

## 一键部署

设置页点「一键部署环境」，按阶段跑：

```
准备 Python → 环境检查 → 建 venv → 装 CosyVoice 依赖 → 下 CosyVoice 模型 → 装 RVC → 下 RVC 模型 → 写配置 → 自检合成
```

- 下载约 **3–6GB**，耗时几十分钟到几小时。
- 任一步失败都会**停在那一阶段并写清原因**，不会假装成功；可以重跑，已完成阶段会跳过。
- **只有自检合成真的出声、且文件有效**，才写「部署完成」。
- 部署前会把旧配置备份到 `~/.dsh/feiyu-say/config-before-deploy.json`。

### Python 从哪来

按顺序找，找到就用：

1. 设置页「Python 解释器」里填的路径（留空就跳过）
2. `PYTHON` 环境变量
3. 平台惯例：Windows 先 `py -3.10` / `py -3`；macOS / Linux 先 `python3.10`
4. `PATH` 上的 `python3` / `python`、常见安装目录、Windows 注册表

全都没有就下载托管运行时：先在部署目录放一份 `uv`（约 20MB），再用它拉 `python-build-standalone` 的 CPython 3.10（约 21MB）。全部落在 `<部署目录>/{uv,python}` 下，不写 `~/.local/bin`、不写注册表、不碰系统 Python。

> python-build-standalone 的 `ensurepip` 常常缺 pip 轮子，`python -m venv` 会建出没有 pip 的 venv；插件会检测到并用 `uv pip install --python <venv> pip` 补上，后续照常用 `python -m pip`。

### Windows 上的差别

- **torch 装 CPU 版**（`download.pytorch.org/whl/cpu`）：pypi 默认轮子带整套 CUDA，多 2GB 且容易在没显卡的机器上出 DLL 问题。
- **RVC 默认跳过**：`rvc-python` 依赖 `fairseq`，没有 Windows 预编译轮子，必须 MSVC 生成工具。检测不到 MSVC 就跳过 RVC 阶段、只出「原声」，不让整条部署挂在最后一公里。
  - 想换声：装 [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（勾「使用 C++ 的桌面开发」），把设置页「安装RVC」改成 `on`，再点一次部署。
- **ffmpeg 可以不装**：缺了自动改用 Python 重采样（`lib/resample.py`，scipy + soundfile）。

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
| `部署目录` | `~/.dsh/feiyu-say` | venv / 模型 / 托管 Python / 部署状态都在这 |
| `python` | 空 | 系统 Python 的解释器路径；留空自动探测，部署完会写成实际用的那个 |
| `安装RVC` | `auto` | `auto`=Windows 没 MSVC 就跳过 / `on`=强制装 / `off`=不装（只出原声） |
| `cosy模式` | `sft` | `sft`=原声说话人 / `zero_shot`=克隆参考音频 / `custom`=自定义脚本 |
| `模型目录` | `~/.dsh/feiyu-say/rvc-models` | RVC 模型目录 |
| `cosy模型目录` | `~/.dsh/feiyu-say/CosyVoice2-0.5B` | 公开 CosyVoice2 模型 |
| `cosy仓库目录` | `~/.dsh/feiyu-say/CosyVoice` | CosyVoice 代码仓库 |
| `rvc模型地址` | 空 | GitHub Release 下载根地址（空 = 不自动下 RVC） |
| `ffmpeg` | `ffmpeg` | 转码器；找不到时自动用 `lib/resample.py` 兜底 |

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
状态条 + 部署进度条（阶段 N/9 · 百分比）
快速开始（一键部署 / 试听）
声线（当前声线下拉 + 导入）
语音提示（三档下拉 + 说明）
▸ 高级设置（输出 / Python / CosyVoice / RVC / 部署源）
保存设置（有改动时底部浮出「未保存」提示）
```

## 排错

- 先点设置页「运行自检」（`voice_status` 同源），逐项看哪项红。
- 部署日志：`~/.dsh/feiyu-say/deploy.log`。
- **部署卡在「准备 Python」**：多半是 GitHub 下载不通。可以先手动装 Python 3.10 再部署（Windows `winget install -e --id Python.Python.3.10`，macOS `brew install python@3.10`）。
- **Windows 上 `python` / `python3` 一跑就 exit 9009**：那是微软商店的占位符，不是真的 Python。插件会跳过它；如果你自己装过 Python 却没被认出来，在设置页「Python 解释器」里直接填 `...\python.exe` 的绝对路径。
- **`python -m venv` 报 ensurepip 失败**：托管运行时常见，插件会自动用 uv 补 pip；自检里看 `python` / `cosyPython` 两项是否都绿。
- **`import cosyvoice` 失败**：缺 Xcode CLT（macOS）/ 缺 VC++ 运行库（Windows）/ 依赖没装全 / Matcha-TTS 子模块没拉（部署会自动补 `git submodule update --init`）。
- **RVC 装不上（Windows）**：`fairseq` 没预编译轮子，需要 VS Build Tools；懒得装就把「安装RVC」设成 `off`，只出原声。
- **RVC 段错误（退出码 139）**：macOS 上 PyTorch + fairseq 需要 `KMP_DUPLICATE_LIB_OK=TRUE` + `OMP_NUM_THREADS=1`（插件已自动带）。
- **合成出「乱码」但不是报错**：先查 `torch` 版本是不是被升级了（必须 2.3.1）。
- **RVC 在 MPS 上崩**：插件已强制 CPU（`torch.backends.mps.is_available` 打桩成 false）。
- **ffmpeg 不在 PATH**：不用管，会自动用 Python 重采样；想用它转码再装（macOS `brew install ffmpeg`，Windows `winget install -e --id Gyan.FFmpeg`）。

## 卸载

在插件管理里卸载，然后可删数据目录：

```sh
rm -rf ~/.dsh/feiyu-say ~/.dsh/feiyu-say-config.json ~/.dsh/feiyu-say-deploy.json
```

## License / 第三方

MIT。合成依赖 CosyVoice、RVC 与声线模型，其授权归属各自作者；本插件**不捆绑**任何第三方声线模型。

## 变更

见 [CHANGELOG.md](CHANGELOG.md)。
