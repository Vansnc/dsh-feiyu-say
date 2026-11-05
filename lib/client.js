// dsh-feiyu-say · 网页半边（设置页）
// 在「设置」左侧栏加一项「feiyu-say」，读写宿主 /feiyu-say/config 路由。
// 参照 dsh-qq-link 的 client.js 写法：window.__ModuleLoader__.load + slots 注入 settings.section。

window.__ModuleLoader__.load({
  id: 'dsh-feiyu-say',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const inject = ['slots']
    const h = React.createElement
    const { useState, useEffect } = React

    const B = '/feiyu-say'
    const get = () => fetch(B + '/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (body) =>
      fetch(B + '/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)

    const S = {
      wrap: { padding: '12px 14px 24px', fontSize: 13, lineHeight: 1.7 },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 150, paddingTop: 3, fontSize: 12.5 },
      ctl: { flex: '1 1 260px', minWidth: 220 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15))', borderRadius: 6, padding: '4px 8px',
        background: 'transparent', color: 'inherit', fontSize: 12.5, width: '100%', boxSizing: 'border-box',
      },
      btn: { padding: '6px 14px', borderRadius: 6, border: 'none', background: '#3b82f6', color: '#fff', fontSize: 13, cursor: 'pointer' },
      save: { padding: '4px 8px', fontSize: 11.5 },
    }

    function 输入(类型, 值, 改) {
      return h('input', {
        type: 类型 || 'text', value: 值 == null ? '' : 值,
        onChange: (e) => 改(类型 === 'number' ? Number(e.target.value) : e.target.value),
        style: S.input,
      })
    }

    function 字段(label, key, cfg, 改, 类型) {
      return h('div', { style: S.row },
        h('label', { style: S.lab }, label),
        h('div', { style: S.ctl }, 输入(类型, cfg[key], (v) => 改(key, v))),
      )
    }

    function 布尔(label, key, cfg, 改) {
      return h('div', { style: S.row },
        h('label', { style: S.lab }, label),
        h('div', { style: S.ctl },
          h('input', { type: 'checkbox', checked: !!cfg[key], onChange: (e) => 改(key, e.target.checked) }),
        ),
      )
    }

    function 大文本(label, key, cfg, 改) {
      return h('div', { style: S.row },
        h('label', { style: S.lab }, label),
        h('div', { style: S.ctl },
          h('textarea', {
            value: cfg[key] == null ? '' : cfg[key], rows: 4,
            onChange: (e) => 改(key, e.target.value), style: { ...S.input, resize: 'vertical' },
          }),
        ),
      )
    }

    function Section() {
      const [cfg, setCfg] = useState(null)
      const [忙, set忙] = useState(false)
      const [态, set态] = useState('')

      useEffect(() => { get().then((d) => { if (d && d.配置) setCfg(d.配置) }).catch(() => {}) }, [])

      const 改 = (k, v) => setCfg((c) => ({ ...c, [k]: v }))

      const 存 = async () => {
        if (!cfg) return
        set忙(true)
        // 声线字段：允许填 JSON 数组，也能留空；解析失败就按原样保留
        let 发 = { ...cfg }
        try {
          const 原 = cfg.声线
          if (typeof 原 === 'string' && 原.trim()) 发.声线 = JSON.parse(原)
          else if (原 == null) 发.声线 = []
        } catch {}
        const r = await post(发)
        set忙(false)
        set态(r && r.ok ? '已保存 ✓' : '保存失败：' + (r && r.说 || '未知'))
      }

      if (!cfg) return h('div', { style: S.wrap }, h('div', { style: S.dim }, '加载中…'))

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, 'feiyu-say · 合成语音'),
        h('div', { style: S.dim }, '本机 CosyVoice 合成 → RVC 换声 → 8kHz → 输出 WAV 文件'),
        布尔('总开关', '总开关', cfg, 改),
        h('div', { style: S.h }, 'CosyVoice'),
        字段('cosyPython', 'cosyPython', cfg, 改),
        字段('cosy脚本', 'cosy脚本', cfg, 改),
        字段('cosy风格（cute/gentle）', 'cosy风格', cfg, 改),
        字段('cosy参考音频', 'cosy参考音频', cfg, 改),
        字段('cosy参考文字', 'cosy参考文字', cfg, 改),
        字段('cosy语速', 'cosy语速', cfg, 改, 'number'),
        h('div', { style: S.h }, 'RVC'),
        字段('rvcPython', 'rvcPython', cfg, 改),
        字段('rvc目录', 'rvc目录', cfg, 改),
        字段('ffmpeg', 'ffmpeg', cfg, 改),
        字段('模型目录', '模型目录', cfg, 改),
        字段('音频目录（输出 WAV 到哪）', '音频目录', cfg, 改),
        字段('当前声线', '当前声线', cfg, 改),
        大文本('声线（高级，JSON 数组）', '声线', cfg, 改),
        h('div', { style: S.h }, '提示与其它'),
        布尔('语音提示（每轮提醒用声音）', '语音提示', cfg, 改),
        大文本('语音提示文案', '语音提示文案', cfg, 改),
        字段('超时毫秒', '超时毫秒', cfg, 改, 'number'),
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 } },
          h('button', { style: S.btn, disabled: 忙, onClick: 存 }, 忙 ? '保存中…' : '保存设置'),
          h('span', { style: S.save }, 态),
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'feiyu-say', order: 55, label: () => '鱼的声音' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
