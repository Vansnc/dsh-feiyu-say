// dsh-feiyu-say · 设置页（settings.section）
// 信息架构：状态条 / 快速开始（部署或试听）/ 声线 / 高级（折叠）/ 保存。

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
      return h('input', { type: 类型 || 'text', value: 值 == null ? '' : 值, onChange: (e) => 改(类型 === 'number' ? Number(e.target.value) : e.target.value), style: S.input })
    }
    function 字段(label, key, cfg, 改, 类型) {
      return h('div', { style: S.row }, h('label', { style: S.lab }, label), h('div', { style: S.ctl }, 输入(类型, cfg[key], (v) => 改(key, v))))
    }
    function 布尔(label, key, cfg, 改) {
      return h('div', { style: S.row }, h('label', { style: S.lab }, label), h('div', { style: S.ctl }, h('input', { type: 'checkbox', checked: !!cfg[key], onChange: (e) => 改(key, e.target.checked) })))
    }
    function 大文本(label, key, cfg, 改) {
      return h('div', { style: S.row }, h('label', { style: S.lab }, label), h('div', { style: S.ctl }, h('textarea', { value: cfg[key] == null ? '' : cfg[key], rows: 3, onChange: (e) => 改(key, e.target.value), style: { ...S.input, resize: 'vertical' } })))
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
      const [声线们, set声线们] = useState([])
      const [部署, set部署] = useState(null)
      const [部署忙, set部署忙] = useState(false)
      const [自检结果, set自检结果] = useState(null)
      const [试听文, set试听文] = useState('这是试听，一二三四五。')
      const [试听忙, set试听忙] = useState(false)
      const [试听结果, set试听结果] = useState(null)
      const [导入名, set导入名] = useState('')
      const [导入模, set导入模] = useState('')
      const [导入索, set导入索] = useState('')
      const [导入忙, set导入忙] = useState(false)
      const [脏, set脏] = useState(false)

      const 拉配置 = () => get('/config').then((d) => { if (d && d.配置) { setCfg(d.配置); set脏(false) } }).catch(() => {})
      const 拉声线 = () => get('/voices').then((d) => { if (d && d.声线) set声线们(d.声线) }).catch(() => {})
      const 拉部署 = () => get('/deploy').then((d) => { if (d) set部署(d.部署) }).catch(() => {})

      useEffect(() => { 拉配置(); 拉声线(); 拉部署(); const t = setInterval(拉部署, 1500); return () => clearInterval(t) }, [])

      const 改 = (k, v) => { setCfg((c) => ({ ...c, [k]: v })); set脏(true); set态('') }

      const 存 = async () => {
        if (!cfg) return
        set忙(true)
        let 发 = { ...cfg }
        try { const 原 = cfg.声线; if (typeof 原 === 'string' && 原.trim()) 发.声线 = JSON.parse(原); else if (原 == null) 发.声线 = [] } catch {}
        const r = await post('/config', 发)
        set忙(false)
        if (r && r.ok) { set态('已保存 ✓'); set脏(false) } else set态('保存失败：' + (r && r.说 || '未知'))
      }

      const 开始部署 = async () => { set部署忙(true); const r = await post('/deploy', {}); set部署忙(false); if (r && !r.ok) set态(r.说 || '启动失败'); else 拉部署() }
      const 跑自检 = async () => { const r = await post('/selfcheck', {}); set自检结果(r) }

      const 试听 = async () => {
        set试听忙(true); set试听结果(null)
        const r = await post('/preview', { text: 试听文, voice: cfg && cfg.当前声线 })
        set试听忙(false)
        set试听结果(r)
        if (r && r.ok && r.url) { try { new Audio(r.url).play() } catch {} }
      }

      const 导入声线 = async () => {
        if (!导入名 || !导入模) { set态('名字和模型文件都别空'); return }
        set导入忙(true)
        const r = await post('/voices', { name: 导入名, model: 导入模, index: 导入索 })
        set导入忙(false)
        set态(r && r.ok ? r.说 : '导入失败：' + (r && r.说 || '未知'))
        if (r && r.ok) { set导入名(''); set导入模(''); set导入索(''); 拉声线(); 拉配置() }
      }

      if (!cfg) return h('div', { style: S.wrap }, h('div', { style: S.dim }, '加载中…'))

      const 声线选项 = 声线们.map((v) => ({ v: v.id, t: (v.name || v.id) + (v.缺模型 ? '（缺模型）' : '') + (v.index ? '（带 index）' : '') }))
      const 采样率选项 = [8000, 16000, 22050, 24000, 44100].map((r) => ({ v: r, t: r + ' Hz' }))
      const 进度 = !部署 ? 0 : (部署.状态 === '完成' ? 100 : Math.min(100, Math.round((((部署.序号 || 0)) / (部署.总数 || 8)) * 100)))

      return h('div', { style: S.wrap },
        h('div', { style: S.h }, '鱼的声音'),
        h('div', { style: S.dim }, '本机 CosyVoice + RVC 合成语音 → 输出 WAV，可在线试听。不绑定任何 IM。'),

        h('div', { style: S.row },
          h('div', { style: S.ctl },
            h('div', { style: S.dim },
              (部署 && 部署.状态 === '进行中' ? '⏳ 部署中：' + (部署.阶段 || '') : (部署 && 部署.状态 === '失败' ? '⚠️ 部署失败：' + (部署.错误 || '') : (部署 && 部署.状态 === '完成' ? '✅ 部署完成' : '未部署'))),
            ),
            h('div', { style: { height: 6, borderRadius: 3, background: 'rgba(127,127,127,.18)', marginTop: 6, overflow: 'hidden' } },
              h('div', { style: { height: '100%', borderRadius: 3, background: (部署 && 部署.状态 === '失败') ? '#ef4444' : 'var(--dsw-alias-brand, #3b82f6)', width: 进度 + '%', transition: 'width .4s ease' } }),
            ),
            h('div', { style: S.dim }, (部署 && 部署.总数 ? '阶段 ' + (部署.序号 || 0) + '/' + 部署.总数 + ' · ' : '') + 进度 + '%'),
          ),
          h('button', { style: S.ghost, onClick: 跑自检 }, '运行自检'),
        ),
        (自检结果 && 自检结果.说) ? h('pre', { style: { ...S.input, whiteSpace: 'pre-wrap', marginTop: 8, fontFamily: 'inherit' } }, 自检结果.说) : null,

        h('div', { style: S.h }, '快速开始'),
        h('div', { style: S.row },
          h('div', { style: S.ctl },
            h('button', { style: S.btn, disabled: 部署忙 || !!(部署 && 部署.状态 === '进行中'), onClick: 开始部署 },
              部署 && 部署.状态 === '进行中' ? '部署中…' : '一键部署环境（约 3–6GB）'),
          ),
        ),
        (部署 && 部署.日志 && 部署.日志.length) ? h('div', { style: S.dim }, '最新：' + 部署.日志[部署.日志.length - 1]) : null,

        h('div', { style: S.row },
          h('div', { style: S.ctl }, 输入('text', 试听文, set试听文)),
          h('button', { style: S.btn, disabled: 试听忙, onClick: 试听 }, 试听忙 ? '合成中…' : '试听'),
        ),
        (试听结果 && 试听结果.ok) ? h('div', { style: { marginTop: 8 } },
          h('audio', { controls: true, src: 试听结果.url, style: { width: '100%' } }),
          h('div', { style: S.dim }, '声线 ' + 试听结果.声线 + ' · ' + 试听结果.采样率 + 'Hz · ' + 试听结果.耗时ms + 'ms · ' + (试听结果.path || '')),
        ) : null,
        (试听结果 && !试听结果.ok) ? h('div', { style: S.dim }, '试听失败：' + (试听结果.说 || '')) : null,

        h('div', { style: S.h }, '声线'),
        选择('当前声线（用什么嗓子）', '当前声线', cfg, 改, 声线选项),
        h('div', { style: S.dim }, '模型目录：' + (cfg.模型目录 || '（未配置）')),
        h('div', { style: S.row }, h('label', { style: S.lab }, '名字（英文/拼音）'), h('div', { style: S.ctl }, 输入('text', 导入名, set导入名))),
        h('div', { style: S.row }, h('label', { style: S.lab }, '模型 .pth（路径或 URL）'), h('div', { style: S.ctl }, 输入('text', 导入模, set导入模))),
        h('div', { style: S.row }, h('label', { style: S.lab }, 'index（可选）'), h('div', { style: S.ctl }, 输入('text', 导入索, set导入索))),
        h('div', { style: S.row }, h('div', { style: S.ctl }, h('button', { style: S.btn, disabled: 导入忙, onClick: 导入声线 }, 导入忙 ? '导入中…' : '导入声线'))),

        h('div', { style: S.h }, '语音提示'),
        布尔('每轮提醒用声音', 'hintEnabled', cfg, 改),
        大文本('提示文案', 'hintText', cfg, 改),

        h('div', { style: { marginTop: 14 } },
          h('button', { style: S.ghost, onClick: () => set高级(!高级) }, 高级 ? '▾ 高级设置' : '▸ 高级设置'),
        ),
        高级 ? h('div', {},
          h('div', { style: S.h }, '输出'),
          选择('采样率', 'sampleRate', cfg, 改, 采样率选项),
          字段('超时毫秒', 'timeoutMs', cfg, 改, 'number'),
          字段('音频目录', '音频目录', cfg, 改),
          字段('音频保留数', '音频保留数', cfg, 改, 'number'),
          h('div', { style: S.h }, 'CosyVoice'),
          字段('cosyPython', 'cosyPython', cfg, 改),
          字段('cosy脚本', 'cosy脚本', cfg, 改),
          字段('cosy仓库目录', 'cosy仓库目录', cfg, 改),
          字段('cosy模式（sft/zero_shot/custom）', 'cosy模式', cfg, 改),
          字段('cosy说话人', 'cosy说话人', cfg, 改),
          字段('cosy模型目录', 'cosy模型目录', cfg, 改),
          字段('cosy风格', 'cosy风格', cfg, 改),
          字段('cosy参考音频', 'cosy参考音频', cfg, 改),
          字段('cosy参考文字', 'cosy参考文字', cfg, 改),
          字段('cosy语速', 'cosy语速', cfg, 改, 'number'),
          h('div', { style: S.h }, 'RVC'),
          字段('rvcPython', 'rvcPython', cfg, 改),
          字段('rvc目录', 'rvc目录', cfg, 改),
          字段('ffmpeg', 'ffmpeg', cfg, 改),
          字段('模型目录', '模型目录', cfg, 改),
          h('div', { style: S.h }, '部署源'),
          字段('cosy仓库', 'cosy仓库', cfg, 改),
          字段('cosy模型源', 'cosy模型源', cfg, 改),
          字段('rvc模型地址', 'rvc模型地址', cfg, 改),
          字段('部署目录', '部署目录', cfg, 改),
          大文本('声线（高级，JSON 数组）', '声线', cfg, 改),
        ) : null,

        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 } },
          h('button', { style: { ...S.btn, ...(脏 ? { boxShadow: '0 0 0 3px rgba(59,130,246,.35)' } : {}) }, disabled: 忙, onClick: 存 }, 忙 ? '保存中…' : (脏 ? '保存设置 ●' : '保存设置')),
          h('span', { style: { ...S.save, color: 脏 ? '#3b82f6' : undefined } }, 脏 ? '有未保存的修改' : 态),
        ),
        // 底部悬浮提示：改过任何东西就冒出来，点一下直接存
        脏 ? h('div', {
          style: {
            position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--dsw-alias-brand, #3b82f6)', color: '#fff', padding: '8px 18px',
            borderRadius: 999, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,.25)',
            zIndex: 9999, fontSize: 13, userSelect: 'none', whiteSpace: 'nowrap',
          },
          onClick: 忙 ? undefined : 存,
        }, 忙 ? '保存中…' : '● 有未保存的修改，点这里保存') : null,
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
