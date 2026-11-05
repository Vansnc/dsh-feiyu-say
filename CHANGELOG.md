# Changelog

## 0.3.0（2026-11-05）

- **可信部署**：分阶段（环境检查 → venv → CosyVoice 依赖 → 模型 → RVC → 写配置 → 自检合成），每步校验退出码，失败即停并写清阶段；装完自动真合成一句。
- **合成严格失败**：RVC 模型缺失 / 换声失败不再静默退回原声，直接报错并给下一步。
- **PYTHONPATH 修复**：合成时给子进程注入 `PYTHONPATH=<CosyVoice 仓库>`，`cosy_say.py` 加 `--repo`，不再裸 `import cosyvoice` 失败。
- **采样率可配**：默认 24000Hz，`send_voice` 可传 `sampleRate`（QQ 语音条用 8000）。
- **配置拆分**：5 项旋钮（enabled / sampleRate / hintEnabled / hintText / timeoutMs）进插件 Config；路径与声线留在 JSON；支持 v1→v2 迁移与原子写。
- **生命周期**：改为 `agent/created` / `agent/disposed` / `settings/document-updated`，删除 5 秒轮询；新会话立即有工具。
- **试听**：新增 `/feiyu-say/audio/*`（Range 支持）、`/preview`、`/selfcheck`；设置页有 `<audio>` 播放器、声线下拉、导入声线。
- **发布**：补 locale/icon/CHANGELOG，关键词与描述去掉 QQ/OneBot/NapCat。
- **安全**：路径白名单与 containment、下载校验、JSON-only POST、无 `shell:true`。
