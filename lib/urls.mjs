// dsh-feiyu-say · 音频地址：浏览器里要相对路径，聊天文本 / CLI 里要绝对地址。
//
// 踩过的坑：以前 `/preview` 和 `send_voice` 都拿 `ctx.webServer.getOrigin()` 拼出
// `http://127.0.0.1:3080/…`。从域名 / 反向代理 / 别的机器打开面板时，这个 127.0.0.1
// 指的是用户自己的电脑，`<audio>` 加载不到 → 拿不到 metadata → 播放器时长显示 0:00 且没声。

/** 页面上用的相对地址：交给浏览器按当前页面 origin 解析（反向代理、前缀、换机器都不怕）。 */
export function 音频相对地址(文件名) {
  return '/feiyu-say/audio/' + encodeURIComponent(String(文件名))
}

/** 聊天文本 / 本机 CLI 用的绝对地址：源拿不到（还没 listen）就退回相对地址。 */
export function 音频绝对地址(取源, 文件名) {
  try { return String(取源() || '') + 音频相对地址(文件名) } catch { return 音频相对地址(文件名) }
}
