/**
 * @guyu233/dsh-pet — browser half.
 *
 * Registers a full "Desk pet" section in DSH Settings. All Host calls ride
 * the official Remote gateway namespace `pet` (mounted via remote.$mount),
 * not a loopback HTTP server. The catalog is fetched from Petdex's public
 * manifest at runtime.
 */

window.__ModuleLoader__.load({
  id: '@guyu233/dsh-pet',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const NS = 'dshPet'
    const MANIFEST_URL = 'https://petdex.dev/api/manifest'
    const ASSET_BASE = 'https://assets.petdex.dev/'

    /* ---------- Remote contribution (pure-JS, strict codecs) ----------
     * Method names and parameter names MUST match the Host service exactly.
     * `result: src-json` leaves host results as plain JSON objects.
     */
    function codec(type, check) {
      return {
        mode: 'strict',
        typeSymbol: `dsh-pet#${type}`,
        create: () => ({
          parse(value) {
            if (!check(value)) throw new TypeError(`dsh-pet: ${type} has an invalid value`)
            return value
          },
        }),
      }
    }
    const stringCodec = name => codec(`${name}:string`, v => typeof v === 'string')
    const boolCodec = name => codec(`${name}:boolean`, v => typeof v === 'boolean')
    const numberCodec = name => codec(`${name}:number`, v => typeof v === 'number' && Number.isFinite(v))

    const method = (name, params = []) => ({
      id: `dsh-pet#pet/${name}`,
      service: 'pet',
      namespace: 'pet',
      method: name,
      invocation: { kind: 'direct' },
      result: { mode: 'src-json' },
      parameters: params.map(p => ({
        name: p.name,
        wire: p.name,
        source: 'json',
        codec: p.codec,
      })),
    })

    const PET_REMOTE = Object.freeze({
      package: '@guyu233/dsh-pet',
      descriptors: Object.freeze([
        method('state'),
        method('setConfig', [
          { name: 'enabled', codec: boolCodec('enabled') },
          { name: 'petSlug', codec: stringCodec('petSlug') },
          { name: 'scale', codec: numberCodec('scale') },
          { name: 'opacity', codec: numberCodec('opacity') },
        ]),
        method('start'),
        method('stop'),
        method('download', [
          { name: 'slug', codec: stringCodec('slug') },
          { name: 'spriteUrl', codec: stringCodec('spriteUrl') },
        ]),
        method('remove', [{ name: 'slug', codec: stringCodec('slug') }]),
        method('sessions'),
        method('send', [
          { name: 'sessionId', codec: stringCodec('sessionId') },
          { name: 'text', codec: stringCodec('text') },
        ]),
        method('stopSession', [{ name: 'sessionId', codec: stringCodec('sessionId') }]),
      ]),
    })

    // Mounted once in apply(). namespace properties are tracked and must be
    // resolved there, not read inside a render callback.
    let petNs

    async function mountPet(ctx) {
      const remote = ctx.get('remote') ?? ctx.remote
      if (!remote || typeof remote.$mount !== 'function') {
        throw new Error('the Client remote service is unavailable')
      }
      await remote.$mount(PET_REMOTE)
      const ns = ctx.get('remote.pet') ?? remote.pet
      if (!ns || typeof ns.state !== 'function') {
        throw new Error('remote.pet did not mount')
      }
      petNs = ns
    }

    function ok(result) {
      if (result && result.ok === false) throw new Error(result.error || 'remote call failed')
      return result
    }

    function assetUrl(entry) {
      const ref = entry?.spritesheet || entry?.spritesheetUrl || entry?.sprite
      if (!ref) return ''
      if (/^https?:\/\//.test(ref)) return ref
      return (entry?.assetBase || ASSET_BASE) + String(ref).replace(/^\/+/, '')
    }

    /* ---------- theme-token-only UI primitives ---------- */

    function Card({ children }) {
      return h('section', {
        style: {
          background: 'var(--dsw-alias-bg-secondary)',
          border: '1px solid var(--dsw-alias-border-primary)',
          borderRadius: 'var(--dsw-radius-md)',
          padding: 16,
        },
      }, children)
    }

    function Row({ title, hint, children }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { color: 'var(--dsw-alias-label-primary)', fontSize: 14 } }, title),
          hint ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, marginTop: 2 } }, hint) : null,
        ),
        children,
      )
    }

    function Button({ children, onClick, disabled, tone }) {
      const primary = tone === 'primary'
      return h('button', {
        type: 'button', onClick, disabled,
        style: {
          cursor: disabled ? 'default' : 'pointer',
          border: primary ? '1px solid var(--dsw-alias-state-business-primary)' : '1px solid var(--dsw-alias-border-primary)',
          borderRadius: 'var(--dsw-radius-sm)',
          background: primary ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-interactive-bg)',
          color: primary ? 'var(--dsw-alias-text-on-accent)' : 'var(--dsw-alias-label-primary)',
          padding: '5px 12px', fontSize: 13, opacity: disabled ? 0.5 : 1,
        },
      }, children)
    }

    function Switch({ checked, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label,
        onClick: () => onChange(!checked),
        style: {
          width: 40, height: 22, borderRadius: 11, border: 'none', padding: 2, cursor: 'pointer',
          background: checked ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-primary)',
        },
      }, h('span', {
        style: {
          display: 'block', width: 18, height: 18, borderRadius: '50%',
          background: 'var(--dsw-alias-label-primary)',
          transform: checked ? 'translateX(18px)' : 'translateX(0)', transition: 'transform 120ms ease',
        },
      }))
    }

    function NumberField({ value, onChange, min, max }) {
      return h('input', {
        type: 'number', value, min, max,
        onChange: e => onChange(Number(e.target.value)),
        style: {
          width: 72, padding: '4px 8px',
          border: '1px solid var(--dsw-alias-border-primary)',
          borderRadius: 'var(--dsw-radius-sm)',
          background: 'var(--dsw-alias-bg-primary)',
          color: 'var(--dsw-alias-label-primary)',
        },
      })
    }

    function usePetState() {
      const [status, setStatus] = useState(null)
      const [error, setError] = useState('')
      const refresh = useCallback(async () => {
        if (!petNs) return
        try { setError(''); setStatus(ok(await petNs.state())) }
        catch (e) { setError(String(e?.message || e)); setStatus(null) }
      }, [])
      useEffect(() => { void refresh() }, [refresh])
      return { status, error, refresh }
    }

    function useCatalog() {
      const [pets, setPets] = useState([])
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const load = useCallback(async () => {
        setLoading(true); setError('')
        try {
          const res = await fetch(MANIFEST_URL, { headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          const fields = data?.fields
          const base = data?.assetBase || ASSET_BASE
          const list = (Array.isArray(data?.pets) ? data.pets : []).map(p => {
            if (Array.isArray(p) && fields) {
              const obj = {}; fields.forEach((k, i) => { obj[k] = p[i] }); return obj
            }
            return p
          }).map(p => ({
            slug: p.slug,
            displayName: p.displayName || p.slug,
            kind: p.kind || '',
            submittedBy: p.submittedBy || '',
            spriteVersionNumber: p.spriteVersionNumber || 1,
            spriteUrl: assetUrl({ ...p, assetBase: base }),
          })).filter(p => p.slug && p.spriteUrl.startsWith('https://'))
          setPets(list)
        } catch (e) {
          setError(String(e?.message || e)); setPets([])
        } finally { setLoading(false) }
      }, [])
      useEffect(() => { void load() }, [load])
      return { pets, loading, error, reload: load }
    }

    function PetSettings({ t }) {
      const pet = usePetState()
      const catalog = useCatalog()
      const [busy, setBusy] = useState('')
      const [enabled, setEnabled] = useState(false)
      const [petSlug, setPetSlug] = useState('')
      const [scale, setScale] = useState(100)
      const [opacity, setOpacity] = useState(85)
      const [msg, setMsg] = useState('')

      useEffect(() => {
        if (!pet.status) return
        setEnabled(Boolean(pet.status.enabled))
        setPetSlug(pet.status.active || 'boba')
        setScale(Number(pet.status.scale) || 100)
        setOpacity(Number(pet.status.opacity) || 85)
      }, [pet.status])

      async function run(label, fn) {
        setBusy(label); setMsg('')
        try { ok(await fn()); await pet.refresh() }
        catch (e) { setMsg(String(e?.message || e)) }
        finally { setBusy('') }
      }

      async function save() {
        await run('save', () => petNs.setConfig(enabled, petSlug, scale, opacity))
      }

      async function download(p) {
        await run(p.slug, () => petNs.download(p.slug, p.spriteUrl))
      }

      async function remove(slug) {
        await run('remove:' + slug, () => petNs.remove(slug))
      }

      const thumb = (url) => h('img', {
        src: url, alt: '', width: 32, height: 34,
        style: { imageRendering: 'pixelated', objectFit: 'cover', objectPosition: 'top left', borderRadius: 4, flexShrink: 0 },
      })

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 } },
        h(Card, null,
          h('h3', { style: { margin: '0 0 8px', fontSize: 16, color: 'var(--dsw-alias-label-primary)' } }, t('title')),
          h(Row, { title: t('enabled'), hint: t('enabledHint') },
            h(Switch, { checked: enabled, onChange: setEnabled, label: t('enabled') }),
          ),
          h(Row, { title: t('petSlug'), hint: t('petSlugHint') },
            h('input', {
              value: petSlug,
              onChange: e => setPetSlug(e.target.value.trim()),
              style: {
                width: 160, padding: '5px 8px',
                border: '1px solid var(--dsw-alias-border-primary)',
                borderRadius: 'var(--dsw-radius-sm)',
                background: 'var(--dsw-alias-bg-primary)',
                color: 'var(--dsw-alias-label-primary)',
              },
            }),
          ),
          h(Row, { title: t('scale') }, h(NumberField, { value: scale, min: 50, max: 300, onChange: setScale })),
          h(Row, { title: t('opacity') }, h(NumberField, { value: opacity, min: 20, max: 100, onChange: setOpacity })),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 } },
            h(Button, { onClick: () => void save(), disabled: !!busy, tone: 'primary' }, t('save')),
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } },
              msg || (pet.status ? (pet.status.running ? t('statusRunning') : t('statusStopped')) : '')),
          ),
          pet.error ? h('div', { style: { color: 'var(--dsw-alias-state-danger)', fontSize: 12 } }, pet.error) : null,
        ),

        h(Card, null,
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--dsw-alias-label-primary)' } }, t('installed')),
            h(Button, { onClick: () => void pet.refresh() }, t('refresh')),
          ),
          h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('installedHint')),
          (pet.status?.installed || []).length === 0
            ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 13 } }, t('empty'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              pet.status.installed.map(slug => h(Row, {
                key: slug,
                title: slug,
                hint: slug === pet.status.active ? t('active') : '',
              },
                h('div', { style: { display: 'flex', gap: 6 } },
                  h(Button, { onClick: () => { setPetSlug(slug); setEnabled(true) } }, t('use')),
                  h(Button, {
                    onClick: () => void remove(slug),
                    disabled: busy === 'remove:' + slug || slug === pet.status.active,
                  }, t('remove')),
                ),
              )),
            ),
        ),

        h(Card, null,
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('h3', { style: { margin: 0, fontSize: 16, color: 'var(--dsw-alias-label-primary)' } }, t('catalog')),
            h(Button, { onClick: () => catalog.reload() }, t('refresh')),
          ),
          h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('catalogHint')),
          catalog.loading ? h('div', null, t('loading'))
            : catalog.error ? h('div', { style: { color: 'var(--dsw-alias-state-danger)' } }, catalog.error)
            : h('div', {
              style: {
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8, maxHeight: 360, overflowY: 'auto',
              },
            }, catalog.pets.slice(0, 60).map(p =>
              h('div', {
                key: p.slug,
                style: {
                  display: 'flex', alignItems: 'center', gap: 10, padding: 8,
                  border: '1px solid var(--dsw-alias-border-primary)', borderRadius: 'var(--dsw-radius-sm)',
                },
              },
                thumb(p.spriteUrl),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', {
                    style: { color: 'var(--dsw-alias-label-primary)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  }, p.displayName),
                  h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } },
                    p.slug, ' · v', p.spriteVersionNumber),
                ),
                h(Button, { onClick: () => void download(p), disabled: busy === p.slug },
                  busy === p.slug ? t('loading') : t('download')),
                h(Button, {
                  onClick: () => { setPetSlug(p.slug); setEnabled(true) },
                  tone: petSlug === p.slug ? 'primary' : undefined,
                }, petSlug === p.slug ? t('active') : t('use')),
              ),
            )),
        ),

        h(Card, null,
          h('h3', { style: { margin: '0 0 8px', fontSize: 16, color: 'var(--dsw-alias-label-primary)' } }, t('message')),
          h('p', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, t('messageHint')),
          h(MessageBar, { t }),
        ),

        pet.status?.nativeMissing ? h('div', {
          style: { color: 'var(--dsw-alias-state-danger)', fontSize: 12 },
        }, t('nativeMissing')) : null,
      )
    }

    /* ---------- Session message bar (send / stop, like a pet chat bubble) ---------- */

    function useSessions() {
      const [sessions, setSessions] = useState([])
      const [error, setError] = useState('')
      const refresh = useCallback(async () => {
        if (!petNs) return
        try {
          const result = ok(await petNs.sessions())
          setSessions(result?.items ?? [])
          setError('')
        } catch (e) { setError(String(e?.message || e)); setSessions([]) }
      }, [])
      useEffect(() => { void refresh() }, [refresh])
      return { sessions, error, refresh }
    }

    function MessageBar({ t, compact }) {
      const { sessions, error, refresh } = useSessions()
      const [sessionId, setSessionId] = useState('')
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')
      const [bubble, setBubble] = useState('')

      useEffect(() => {
        if (!petNs) return
        let alive = true
        const poll = async () => {
          try {
            const s = ok(await petNs.state())
            if (alive) setBubble(s?.lastBubble || '')
          } catch { /* keep last bubble */ }
        }
        void poll()
        const id = setInterval(poll, 2000)
        return () => { alive = false; clearInterval(id) }
      }, [])

      useEffect(() => {
        if (sessionId || sessions.length === 0) return
        // Default to the most recently active, non-blank session.
        const pick = sessions.find(s => s.running) || sessions.find(s => !s.blank) || sessions[0]
        if (pick) setSessionId(pick.sessionId)
      }, [sessions, sessionId])

      async function send() {
        if (!sessionId || !text.trim()) return
        setBusy(true); setMsg('')
        try { ok(await petNs.send(sessionId, text.trim())); setText('') }
        catch (e) { setMsg(String(e?.message || e)) }
        finally { setBusy(false) }
      }

      async function stop() {
        if (!sessionId) return
        setBusy(true); setMsg('')
        try { ok(await petNs.stopSession(sessionId)); await refresh() }
        catch (e) { setMsg(String(e?.message || e)) }
        finally { setBusy(false) }
      }

      const active = sessions.find(s => s.sessionId === sessionId)
      const selectStyle = {
        padding: '4px 8px',
        border: '1px solid var(--dsw-alias-border-primary)',
        borderRadius: 'var(--dsw-radius-sm)',
        background: 'var(--dsw-alias-bg-primary)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        maxWidth: compact ? 140 : 220,
      }
      const inputStyle = {
        flex: 1, minWidth: 0, padding: '5px 8px',
        border: '1px solid var(--dsw-alias-border-primary)',
        borderRadius: 'var(--dsw-radius-sm)',
        background: 'var(--dsw-alias-bg-primary)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
      }

      return h('div', {
        style: compact
          ? { display: 'flex', alignItems: 'center', gap: 6 }
          : { display: 'flex', flexDirection: 'column', gap: 8 },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('select', {
            value: sessionId,
            onChange: e => setSessionId(e.target.value),
            style: selectStyle,
            'aria-label': t('session'),
          },
            h('option', { value: '' }, t('selectSession')),
            sessions.map(s => h('option', { key: s.sessionId, value: s.sessionId },
              (s.blank ? '○ ' : s.running ? '● ' : '') + s.sessionId.slice(0, 8))),
          ),
          active && active.running
            ? h(Button, { onClick: () => void stop(), disabled: busy }, t('stopMessage'))
            : null,
          h(Button, { onClick: () => void refresh() }, t('refresh')),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('input', {
            value: text,
            onChange: e => setText(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } },
            placeholder: t('messagePlaceholder'),
            style: inputStyle,
          }),
          h(Button, { onClick: () => void send(), disabled: busy || !sessionId || !text.trim(), tone: 'primary' },
            t('sendMessage')),
        ),
        bubble ? h('div', {
          style: {
            marginTop: 4, padding: '4px 8px', fontSize: 12,
            color: 'var(--dsw-alias-label-primary)',
            background: 'var(--dsw-alias-bg-tertiary)',
            borderRadius: 'var(--dsw-radius-sm)',
            borderLeft: '2px solid var(--dsw-alias-state-business-primary)',
          },
        }, bubble) : null,
        msg ? h('div', { style: { color: 'var(--dsw-alias-state-danger)', fontSize: 11 } }, msg) : null,
        error ? h('div', { style: { color: 'var(--dsw-alias-state-danger)', fontSize: 11 } }, error) : null,
      )
    }

    return {
      inject: ['slots', 'locale', 'remote'],
      async apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          en: {
            title: 'Desk pet', enabled: 'Enable desk pet',
            enabledHint: 'Start the native floating pet process with DeepSeek Harness.',
            petSlug: 'Pet', petSlugHint: 'Petdex slug to display. Download one from the catalog first.',
            scale: 'Size', opacity: 'Opacity', refresh: 'Refresh catalog',
            catalog: 'Petdex catalog',
            catalogHint: 'Browse approved pets from petdex.dev and download them locally.',
            installed: 'Installed pets', installedHint: 'Pets already downloaded locally.',
            download: 'Download', use: 'Use', remove: 'Remove', active: 'Active',
            loading: 'Loading...', empty: 'No pets found.',
            statusRunning: 'Running', statusStopped: 'Stopped', statusError: 'Error',
            nativeMissing: 'Native pet binary is not built for this platform yet.',
            browse: 'Open on petdex.dev', save: 'Save changes', discard: 'Discard',
            saved: 'Saved', saveFailed: 'Save failed',
            message: 'Quick message', messageHint: 'Send a message to a session from your desk pet.',
            session: 'Session', selectSession: 'Select a session',
            messagePlaceholder: 'Type a message (Enter to send)',
            sendMessage: 'Send', stopMessage: 'Stop',
          },
          zh: {
            title: '桌宠', enabled: '启用桌宠',
            enabledHint: '随 DeepSeek Harness 启动原生悬浮桌宠进程。',
            petSlug: '宠物', petSlugHint: '要显示的 Petdex slug，请先从下方目录下载。',
            scale: '大小', opacity: '不透明度', refresh: '刷新目录',
            catalog: 'Petdex 宠物目录',
            catalogHint: '浏览 petdex.dev 已通过的宠物，下载到本地后即可使用。',
            installed: '已安装桌宠', installedHint: '已经下载到本地的宠物。',
            download: '下载', use: '使用', remove: '卸载', active: '使用中',
            loading: '加载中…', empty: '没有找到宠物。',
            statusRunning: '运行中', statusStopped: '已停止', statusError: '错误',
            nativeMissing: '当前平台尚未编译原生桌宠程序。',
            browse: '在 petdex.dev 打开', save: '保存更改', discard: '放弃更改',
            saved: '已保存', saveFailed: '保存失败',
            message: '快速消息', messageHint: '通过桌宠向某个会话发送消息。',
            session: '会话', selectSession: '选择会话',
            messagePlaceholder: '输入消息（回车发送）',
            sendMessage: '发送', stopMessage: '停止',
          },
        }), 'dsh-pet: locale')

        const t = ctx.locale.bind(NS)

        try { await mountPet(ctx) } catch { /* UI shows the error from state refresh */ }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-pet', order: 30,
          label: () => t('title'), locale: NS,
        }, () => h(PetSettings, { t })))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'dsh-pet', locale: NS,
        }, ({ size }) => h('svg', {
          width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          // cat head: two ears + rounded face, stroked so it reads in both themes
          h('path', { d: 'M3 5.2 L2.7 2.4 L5.4 4.4 M13 5.2 L13.3 2.4 L10.6 4.4' }),
          h('path', { d: 'M8 4.2 C4.9 4.2 3 6 3 8.4 C3 11.2 4.9 13 8 13 C11.1 13 13 11.2 13 8.4 C13 6 11.1 4.2 8 4.2 Z' }),
          h('circle', { cx: 6, cy: 8.4, r: 0.75, fill: 'currentColor', stroke: 'none' }),
          h('circle', { cx: 10, cy: 8.4, r: 0.75, fill: 'currentColor', stroke: 'none' }),
          h('path', { d: 'M6.9 10.6 Q8 11.4 9.1 10.6' }),
        )))
      },
    }
  },
})
