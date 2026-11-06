// dsh-feiyu-say · 设置页（settings.section）：阿里百炼单引擎。
// 结构：状态 / 百炼配置 / 试听 / 语音提示 / 高级 / 保存。

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
    const j = (r) => r.json()
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then(j).catch(() => null)
    const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(j).catch(() => null)

    const S = {
      wrap: { padding: '12px 14px 24px', fontSize: 13, lineHeight: 1.7 },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12, marginTop: 2 },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 150, paddingTop: 3, fontSize: 12.5 },
      ctl: { flex: '1 1 260px', minWidth: 220 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15))', borderRadius: 6, padding: '4px 8px',
        background: 'transparent', color: 'inherit', fontSize: 12.5, width: '100%', boxSizing: 'border-box',
      },
      btn: { padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--dsw-alias-brand, #3b82f6)', color: '#fff', fontSize: 13, cursor: 'pointer' },
      ghost: { padding: '6px 12px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15))', background: 'transparent', color: 'inherit', fontSize: 12.5, cursor: 'pointer' },
      save: { padding: '4px 8px', fontSize: 11.5 },
    }

    function 输入(类型, 值, 改) {
      return h('input', {
        type: 类型 || 'text',
        value: 值 == null ? '' : 值,
        onChange: (e) => 改(类型 === 'number' ? Number(e.target.value) : e.target.value),
        style: S.input,
        autoComplete: 类型 === 'password' ? 'off' : undefined,
      })
    }
    function 字段(label, key, cfg, 改, 类型) {
      return h('div', { style: S.row }, h('label', { style: S.lab }, label), h('div', { style: S.ctl }, 输入(类型, cfg[key], (v) => 改(key, v))))
    }
    function 选择(label, key, cfg, 改, 选项) {
      return h('div', { style: S.row }, h('label', { style: S.lab }, label), h('div', { style: S.ctl },
        h('select', { value: cfg[key] == null ? '' : String(cfg[key]), onChange: (e) => 改(key, e.target.value), style: S.input },
          (选项 || []).map((v) => h('option', { key: String(v.v), value: String(v.v) }, String(v.t))),
        ),
      ))
    }

    function Section() {
      const [cfg, setCfg] = useState(null)
      const [忙, set忙] = useState(false)
      const [态, set态] = useState('')
      const [高级, set高级] = useState(false)
      const [自检结果, set自检结果] = useState(null)
      const [试听文, set试听文] = useState('这是试听，一二三四五。')
      const [试听忙, set试听忙] = useState(false)
      const [试听结果, set试听结果] = useState(null)
      const [脏, set脏] = useState(false)

      const 拉配置 = () => get('/config').then((d) => { if (d && d.配置) { setCfg(d.配置); set脏(false) } }).catch(() => {})
      useEffect(() => { 拉配置() }, [])

      const 改 = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); set脏(true); set态('') }

      const 存 = async () => {
        if (!cfg) return
        set忙(true)
        const r = await post('/config', cfg)
        set忙(false)
        if (r && r.ok) {
          const w = r.写入 || {}
          set态((w.旋钮 && w.旋钮 !== 'ok') ? ('配置写失败：' + w.旋钮) : '已保存 ✓')
          set脏(false)
          if (w.旋钮 === 'ok') 拉配置()
        } else set态('保存失败：' + (r && r.说 || '未知'))
      }

      const 试听 = async () => {
        set试听忙(true); set试听结果(null)
        const r = await post('/preview', { text: 试听文, sampleRate: cfg && cfg.sampleRate })
        set试听忙(false)
        set试听结果(r)
        if (r && r.ok && r.url) { try { new Audio(r.url).play() } catch {} }
      }

      const 跑自检 = async () => { set自检结果(await post('/selfcheck', {})) }

      if (!cfg) return h('div', { style: S.wrap }, h('div', { style: S.dim }, '加载中…'))

      const 有Key = !!String(cfg.百炼ApiKey || '').trim()
      const 采样率选项 = [8000, 16000, 22050, 24000, 44100].map((r) => ({ v: r, t: r + ' Hz' }))

      const 提示档 = [
        { v: 'off', 说: '不主动提醒；想让它用声音说的时候，直接让它说就行。' },
        { v: 'auto', 说: '按聊天气氛自己决定要不要用声音说。' },
        { v: 'always', 说: '每轮都由提示词提醒「先考虑用声音说」；不想说仍可回文字。' },
      ]
      const 当前档 = ['off', 'auto', 'always'].includes(cfg.hintMode) ? cfg.hintMode : 'auto'
      const 档说明 = (提示档.find((d) => d.v === 当前档) || 提示档[1]).说
      const 切档 = (v) => { setCfg((c) => ({ ...c, hintMode: v })); set脏(true); set态('') }

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '鱼的声音'),
        h('div', { style: S.dim }, '阿里百炼 TTS → WAV，可在线试听。不绑定任何 IM，不占本机内存。'),

        h('div', { style: S.row },
          h('div', { style: S.ctl },
            h('div', { style: S.dim }, 有Key ? '✅ 已配 API Key · 模型 ' + (cfg.百炼模型 || '') : '⚠️ 还没填 API Key，填好保存才能合成'),
          ),
          h('button', { style: S.ghost, onClick: 跑自检 }, '运行自检'),
        ),
        (自检结果 && 自检结果.说) ? h('pre', { style: { ...S.input, whiteSpace: 'pre-wrap', marginTop: 8, fontFamily: 'inherit' } }, 自检结果.说) : null,

        h('div', { style: S.h }, '阿里百炼'),
        h('div', { style: S.dim }, '百炼控制台 → API-KEY 创建（只显示一次）。地址填业务空间的 wss 域名；模型 / 音色按你开通的填。'),
        字段('API Key', '百炼ApiKey', cfg, 改, 'password'),
        字段('模型', '百炼模型', cfg, 改),
        字段('音色', '百炼音色', cfg, 改),
        字段('地址（wss://…）', '百炼地址', cfg, 改),

        h('div', { style: S.h }, '试听'),
        h('div', { style: S.row },
          h('div', { style: S.ctl }, 输入('text', 试听文, set试听文)),
          h('button', { style: S.btn, disabled: 试听忙, onClick: 试听 }, 试听忙 ? '合成中…' : '试听'),
        ),
        (试听结果 && 试听结果.ok) ? h('div', { style: { marginTop: 8 } },
          h('audio', { controls: true, src: 试听结果.url, style: { width: '100%' } }),
          h('div', { style: S.dim }, '音色 ' + 试听结果.音色 + ' · ' + 试听结果.采样率 + 'Hz · ' + 试听结果.耗时ms + 'ms · ' + (试听结果.path || '')),
        ) : null,
        (试听结果 && !试听结果.ok) ? h('div', { style: S.dim }, '试听失败：' + (试听结果.说 || '')) : null,

        h('div', { style: S.h }, '语音提示'),
        h('div', { style: S.row },
          h('div', { style: S.ctl },
            h('select', { value: 当前档, onChange: (e) => 切档(e.target.value), style: S.input },
              h('option', { value: 'off' }, '关闭（不提醒）'),
              h('option', { value: 'auto' }, '看气氛（默认）'),
              h('option', { value: 'always' }, '每轮都提（强制）'),
            ),
          ),
        ),
        h('div', { style: S.dim }, 档说明),

        h('div', { style: { marginTop: 14 } },
          h('button', { style: S.ghost, onClick: () => set高级(!高级) }, 高级 ? '▾ 高级设置' : '▸ 高级设置'),
        ),
        高级 ? h('div', {},
          h('div', { style: S.h }, '输出'),
          选择('采样率', 'sampleRate', cfg, 改, 采样率选项),
          字段('超时毫秒', 'timeoutMs', cfg, 改, 'number'),
          字段('音频目录', '音频目录', cfg, 改),
          字段('音频保留数', '音频保留数', cfg, 改, 'number'),
          字段('ffmpeg', 'ffmpeg', cfg, 改),
          h('div', { style: S.dim }, '百炼返回 mp3，插件用 ffmpeg 转成目标采样率的单声道 WAV；发 QQ 语音条就把采样率设 8000。'),
        ) : null,

        h('div', {
          style: {
            display: 'flex', gap: 10, alignItems: 'center', marginTop: 14,
            position: 'sticky', bottom: 0, zIndex: 5,
            padding: '10px 0',
            background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.92))',
            borderTop: 脏 ? '1px solid var(--dsw-alias-brand, #3b82f6)' : '1px solid transparent',
          },
        },
          h('button', { style: { ...S.btn, ...(脏 ? { boxShadow: '0 0 0 3px rgba(59,130,246,.35)' } : {}) }, disabled: 忙, onClick: 存 }, 忙 ? '保存中…' : (脏 ? '保存设置 ●' : '保存设置')),
          h('span', { style: { ...S.save, color: 脏 ? '#3b82f6' : undefined } }, 脏 ? '有未保存的修改 · 点「保存设置」生效' : 态),
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'feiyu-say', order: 55, label: () => '鱼的声音' }, Section),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
