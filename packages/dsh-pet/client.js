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
    const optionalStringCodec = name => codec(`${name}:optional-string`, v => v === undefined || typeof v === 'string')
    const boolCodec = name => codec(`${name}:boolean`, v => typeof v === 'boolean')
    const numberCodec = name => codec(`${name}:number`, v => typeof v === 'number' && Number.isFinite(v))
    const objectCodec = name => codec(`${name}:object`, v => v === undefined || (typeof v === 'object' && v !== null && !Array.isArray(v)))

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
          { name: 'meta', codec: objectCodec('meta') },
        ]),
        method('uninstall', [{ name: 'slug', codec: stringCodec('slug') }]),
        method('sessions'),
        method('active'),
        method('send', [
          { name: 'sessionId', codec: optionalStringCodec('sessionId') },
          { name: 'text', codec: stringCodec('text') },
        ]),
        method('stopSession', [{ name: 'sessionId', codec: optionalStringCodec('sessionId') }]),
      ]),
    })

    // Mounted once in apply(). `petNs` is resolved on the client context, not
    // read from a render callback. Mount may finish AFTER the Settings view
    // first renders, so notify mounted components to re-render.
    let petNs
    let mountError = ''
    const mountListeners = new Set()
    const notifyMount = () => { for (const fn of mountListeners) fn() }

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
      mountError = ''
      notifyMount()
    }

    // React hook: re-render whenever the mount state changes.
    function useMount() {
      const [, bump] = useState(0)
      useEffect(() => {
        const fn = () => bump(n => n + 1)
        mountListeners.add(fn)
        if (petNs || mountError) fn() // catch a mount that finished before first render
        return () => mountListeners.delete(fn)
      }, [])
      return { ns: petNs, error: mountError, ready: Boolean(petNs) && !mountError }
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

    /* ---------- UI primitives ----------
     * Use only tokens observed in the installed Harness, each with a
     * hardcoded fallback so a missing token degrades to a usable control
     * instead of collapsing into plain text. `currentColor` keeps controls
     * readable in both light and dark themes.
     */
    const T = {
      text: 'var(--dsw-alias-label-primary, #1f2329)',
      text2: 'var(--dsw-alias-label-secondary, #6b7280)',
      accent: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
      danger: 'var(--dsw-alias-state-danger, #e5484d)',
      border: 'var(--dsw-alias-border-primary, rgba(128,128,128,0.45))',
      surface: 'var(--dsw-alias-bg-secondary, rgba(128,128,128,0.08))',
      field: 'var(--dsw-alias-bg-primary, rgba(128,128,128,0.12))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.18))',
      active: 'var(--dsw-alias-interactive-bg-active, rgba(128,128,128,0.28))',
      radius: 'var(--dsw-radius-sm, 6px)',
    }

    function Card({ children }) {
      return h('section', {
        style: {
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: T.radius,
          padding: 16,
        },
      }, children)
    }

    function Row({ title, hint, children }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { color: T.text, fontSize: 14 } }, title),
          hint ? h('div', { style: { color: T.text2, fontSize: 12, marginTop: 2 } }, hint) : null,
        ),
        children,
      )
    }

    function Button({ children, onClick, disabled, tone }) {
      const primary = tone === 'primary'
      return h('button', {
        type: 'button', onClick, disabled,
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
          border: `1px solid ${primary ? T.accent : T.border}`,
          borderRadius: T.radius,
          background: primary ? T.accent : T.field,
          color: primary ? '#fff' : T.text,
          padding: '5px 12px', fontSize: 13, lineHeight: '18px',
          opacity: disabled ? 0.5 : 1,
        },
      }, children)
    }

    function Switch({ checked, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label,
        onClick: () => onChange(!checked),
        style: {
          width: 40, height: 22, borderRadius: 11, border: `1px solid ${T.border}`, padding: 2, cursor: 'pointer',
          background: checked ? T.accent : T.field,
        },
      }, h('span', {
        style: {
          display: 'block', width: 18, height: 18, borderRadius: '50%',
          background: checked ? '#fff' : T.text,
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
          border: `1px solid ${T.border}`,
          borderRadius: T.radius,
          background: T.field,
          color: T.text,
        },
      })
    }

    function usePetState() {
      const [status, setStatus] = useState(null)
      const [error, setError] = useState('')
      const mount = useMount()
      const refresh = useCallback(async () => {
        if (!petNs) return
        try { setError(''); setStatus(ok(await petNs.state())) }
        catch (e) { setError(String(e?.message || e)); setStatus(null) }
      }, [])
      useEffect(() => { void refresh() }, [refresh, mount.ready])
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
            // Petdex publishes a dedicated 80x80 single-frame thumbnail per
            // Petdex publishes a 80x80 single-frame thumb and a 6-frame
            // animated preview strip; use both (preview animates on hover).
            thumbUrl: `${String(base || ASSET_BASE).replace(/\/+$/, '')}/pets/${p.slug}/thumb.webp`,
            previewUrl: `${String(base || ASSET_BASE).replace(/\/+$/, '')}/pets/${p.slug}/preview.webp`,
          })).filter(p => p.slug && p.spriteUrl.startsWith('https://'))
          setPets(list)
        } catch (e) {
          setError(String(e?.message || e)); setPets([])
        } finally { setLoading(false) }
      }, [])
      useEffect(() => { void load() }, [load])
      return { pets, loading, error, reload: load }
    }

    // One shared keyframes rule for the hover preview (6-frame strip).
    function PreviewStyle() {
      return h('style', null,
        '@keyframes dshPetPreview{from{background-position:0 0}to{background-position:-192px 0}}')
    }

    // Static thumb; on hover plays Petdex's 6-frame preview.webp via steps().
    function PetThumb({ pet }) {
      const [animate, setAnimate] = useState(false)
      return h('div', {
        onMouseEnter: () => setAnimate(true),
        onMouseLeave: () => setAnimate(false),
        style: {
          width: 32, height: 32, flexShrink: 0, borderRadius: 4,
          backgroundImage: `url("${animate ? pet.previewUrl : pet.thumbUrl}")`,
          backgroundSize: animate ? '600% 100%' : 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: animate ? '0 0' : 'center',
          imageRendering: 'pixelated',
          animation: animate ? 'dshPetPreview 0.9s steps(6, end) infinite' : 'none',
          backgroundColor: 'var(--dsw-alias-bg-tertiary, rgba(128,128,128,0.12))',
        },
      })
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
      const [query, setQuery] = useState('')
      const [progress, setProgress] = useState(null)

      // While a download is in flight, poll Host progress frequently.
      useEffect(() => {
        if (!busy.startsWith('download:') || !petNs) { setProgress(null); return }
        let alive = true
        const poll = async () => {
          try {
            const s = ok(await petNs.state())
            if (alive) setProgress(s?.downloadProgress || null)
          } catch { /* keep last */ }
        }
        void poll()
        const id = setInterval(poll, 400)
        return () => { alive = false; clearInterval(id) }
      }, [busy])

      useEffect(() => {
        if (!pet.status) return
        setEnabled(Boolean(pet.status.enabled))
        setPetSlug(pet.status.active || 'boba')
        setScale(Number(pet.status.scale) || 100)
        setOpacity(Number(pet.status.opacity) || 85)
      }, [pet.status])

      const mount = useMount()
      const ready = mount.ready

      function openHomepage() {
        try {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            const w = window.open('https://petdex.dev/', '_blank', 'noopener,noreferrer')
            if (w) return
          }
        } catch { /* fall through to anchor */ }
        const a = document.createElement('a')
        a.href = 'https://petdex.dev/'
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.click()
      }

      async function run(label, fn, after) {
        setBusy(label); setMsg('')
        try {
          if (!ready) throw new Error(mount.error || t('notReady'))
          const result = ok(await fn())
          if (after) after(result)
          await pet.refresh()
          return result
        } catch (e) {
          setMsg(String(e?.message || e))
          return undefined
        } finally { setBusy('') }
      }

      async function save() {
        await run('save', () => petNs.setConfig(enabled, petSlug, scale, opacity))
      }

      // "Use": activate a pet immediately (persist + start) and reflect it in UI.
      async function usePet(slug) {
        setPetSlug(slug); setEnabled(true)
        await run('use:' + slug, () => petNs.setConfig(true, slug, scale, opacity))
      }

      // "Download": show a clear in-progress state, then auto-activate on success.
      async function download(p) {
        await run('download:' + p.slug, () => petNs.download(p.slug, p.spriteUrl, {
          displayName: p.displayName, kind: p.kind,
          submittedBy: p.submittedBy, spriteVersionNumber: p.spriteVersionNumber,
        }), (result) => {
          setMsg(t('downloadDone', { name: p.displayName }) + (result?.dir ? ' (' + result.dir + ')' : ''))
        })
      }

      async function uninstall(slug) {
        await run('uninstall:' + slug, () => petNs.uninstall(slug))
      }

      // Set of installed slugs for per-card button state.
      const installed = new Set(pet.status?.installed || [])

      // Fuzzy-ish search: split into tokens (AND), each token matches any
      // field as a substring. Petdex's server does ILIKE + embeddings; the
      // client can only do tokenised substring matching.
      const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
      const filtered = tokens.length
        ? catalog.pets.filter(p => {
            const hay = [p.slug, p.displayName, p.submittedBy, p.kind]
              .map(v => String(v || '').toLowerCase())
            return tokens.every(tk => hay.some(field => field.includes(tk)))
          })
        : catalog.pets

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 } },
        h(PreviewStyle),
        !ready ? h('div', {
          style: {
            padding: '8px 12px', color: T.danger, fontSize: 13,
            border: `1px solid ${T.danger}`, borderRadius: T.radius,
          },
        }, t('notReady') + (mount.error ? ': ' + mount.error : '')) : null,
        msg ? h('div', {
          style: {
            padding: '6px 12px', color: T.text, fontSize: 13,
            background: T.field, borderRadius: T.radius,
          },
        }, msg) : null,
        h(Card, null,
          h('div', {
            onClick: openHomepage,
            role: 'link', tabIndex: 0,
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') openHomepage() },
            style: {
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', textDecoration: 'none',
            },
          },
            h('svg', {
              width: 32, height: 32, viewBox: '0 0 64 64', 'aria-hidden': true,
              style: { flexShrink: 0 },
            },
              h('defs', null,
                h('linearGradient', {
                  id: 'dshPetHomeGrad', x1: '8', y1: '8', x2: '56', y2: '56',
                  gradientUnits: 'userSpaceOnUse',
                },
                  h('stop', { stopColor: '#3847f5' }),
                  h('stop', { offset: '1', stopColor: '#1a1d2e' }),
                ),
              ),
              h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 16, fill: 'url(#dshPetHomeGrad)' }),
              h('g', { fill: '#ffffff' },
                h('rect', { x: 22, y: 20, width: 6, height: 6 }),
                h('rect', { x: 36, y: 20, width: 6, height: 6 }),
                h('rect', { x: 16, y: 26, width: 6, height: 18 }),
                h('rect', { x: 42, y: 26, width: 6, height: 18 }),
                h('rect', { x: 22, y: 38, width: 20, height: 6 }),
              ),
            ),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', {
                style: { color: T.accent, fontSize: 14, fontWeight: 600, textDecoration: 'underline' },
              }, t('homepage')),
              h('div', { style: { color: T.text2, fontSize: 12, marginTop: 2 } }, t('homepageHint')),
            ),
          ),
          h('div', {
            style: { color: T.text2, fontSize: 11, marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 8 },
          }, t('attribution')),
        ),
        h(Card, null,
          h('h3', { style: { margin: '0 0 8px', fontSize: 16, color: T.text } }, t('title')),
          h(Row, { title: t('enabled'), hint: t('enabledHint') },
            h(Switch, {
              checked: enabled,
              disabled: !ready || !!busy,
              label: t('enabled'),
              onChange: (next) => {
                // Enable/disable must take effect immediately: the switch is
                // the primary control, not just a draft value behind Save.
                setEnabled(next)
                void run('toggle', () => petNs.setConfig(next, petSlug, scale, opacity))
              },
            }),
          ),
          h(Row, { title: t('petSlug'), hint: t('petSlugHint') },
            h('input', {
              value: petSlug,
              onChange: e => setPetSlug(e.target.value.trim()),
              style: {
                width: 160, padding: '5px 8px',
                border: `1px solid ${T.border}`,
                borderRadius: T.radius,
                background: T.field,
                color: T.text,
              },
            }),
          ),
          h(Row, { title: t('scale') }, h(NumberField, { value: scale, min: 50, max: 300, onChange: setScale })),
          h(Row, { title: t('opacity') }, h(NumberField, { value: opacity, min: 20, max: 100, onChange: setOpacity })),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 } },
            h(Button, { onClick: () => void save(), disabled: !!busy, tone: 'primary' }, t('save')),
            h('span', { style: { color: T.text2, fontSize: 12 } },
              msg || (pet.status ? (pet.status.running ? t('statusRunning') : t('statusStopped')) : '')),
          ),
          pet.error ? h('div', { style: { color: T.danger, fontSize: 12 } }, pet.error) : null,
        ),

        h(Card, null,
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('h3', { style: { margin: 0, fontSize: 16, color: T.text } }, t('installed')),
            h(Button, { onClick: () => void pet.refresh() }, t('refresh')),
          ),
          h('p', { style: { color: T.text2, fontSize: 12 } }, t('installedHint')),
          pet.status?.petsDir
            ? h('div', { style: { color: T.text2, fontSize: 11, marginBottom: 6, wordBreak: 'break-all' } },
                t('petsDir') + ': ' + pet.status.petsDir)
            : null,
          (pet.status?.installed || []).length === 0
            ? h('div', { style: { color: T.text2, fontSize: 13 } }, t('empty'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              pet.status.installed.map(slug => h(Row, {
                key: slug,
                title: slug,
                hint: slug === pet.status.active ? t('active') : '',
              },
                h('div', { style: { display: 'flex', gap: 6 } },
                  h(Button, {
                    onClick: () => void usePet(slug),
                    disabled: !ready || busy === 'use:' + slug,
                    tone: slug === pet.status.active ? 'primary' : undefined,
                  }, t('use')),
                  h(Button, {
                    onClick: () => void uninstall(slug),
                    disabled: !ready || busy === 'uninstall:' + slug || slug === pet.status.active,
                  }, busy === 'uninstall:' + slug ? t('loading') : t('remove')),
                ),
              )),
            ),
        ),

        h(Card, null,
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('h3', { style: { margin: 0, fontSize: 16, color: T.text } }, t('catalog')),
            h(Button, { onClick: () => catalog.reload() }, t('refresh')),
          ),
          h('p', { style: { color: T.text2, fontSize: 12 } }, t('catalogHint')),
          h('input', {
            value: query,
            onChange: e => setQuery(e.target.value),
            placeholder: t('searchPlaceholder'),
            'aria-label': t('searchPlaceholder'),
            style: {
              width: '100%', boxSizing: 'border-box', padding: '6px 10px', marginBottom: 8,
              border: `1px solid ${T.border}`,
              borderRadius: T.radius,
              background: T.field,
              color: T.text,
              fontSize: 13,
            },
          }),
          !catalog.loading && !catalog.error
            ? h('div', { style: { color: T.text2, fontSize: 11, marginBottom: 6 } },
                t('resultCount', { count: filtered.length }))
            : null,
          catalog.loading ? h('div', null, t('loading'))
            : catalog.error ? h('div', { style: { color: T.danger } }, catalog.error)
            : filtered.length === 0 ? h('div', { style: { color: T.text2, fontSize: 13 } }, t('empty'))
            : h('div', {
              style: {
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8, maxHeight: 360, overflowY: 'auto',
              },
            }, filtered.slice(0, 120).map(p => {
              const isDl = busy === 'download:' + p.slug
              const pct = progress && progress.slug === p.slug ? progress.pct : 0
              return h('div', {
                key: p.slug,
                style: {
                  display: 'flex', flexDirection: 'column', gap: 6, padding: 8,
                  border: `1px solid ${T.border}`, borderRadius: T.radius,
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                  h(PetThumb, { pet: p }),
                  h('div', { style: { flex: 1, minWidth: 0 } },
                    h('div', {
                      style: { color: T.text, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    }, p.displayName),
                    h('div', { style: { color: T.text2, fontSize: 11 } },
                      p.slug, ' · v', p.spriteVersionNumber),
                  ),
                  h(Button, {
                    onClick: () => void download(p),
                    disabled: !ready || isDl || installed.has(p.slug),
                  }, isDl ? t('downloading') : installed.has(p.slug) ? t('installedShort') : t('download')),
                  h(Button, {
                    onClick: () => void usePet(p.slug),
                    disabled: !ready || busy === 'use:' + p.slug,
                    tone: petSlug === p.slug ? 'primary' : undefined,
                  }, petSlug === p.slug ? t('active') : t('use')),
                ),
                isDl ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('div', {
                    style: {
                      flex: 1, height: 6, borderRadius: 3, overflow: 'hidden',
                      background: T.field,
                    },
                  }, h('div', {
                    style: {
                      height: '100%', width: `${pct}%`, background: T.accent,
                      transition: 'width 0.2s ease',
                    },
                  })),
                  h('span', { style: { color: T.text2, fontSize: 11, minWidth: 34 } }, `${pct}%`),
                ) : null,
              )
            }),
          ),
        ),

        h(Card, null,
          h('h3', { style: { margin: '0 0 8px', fontSize: 16, color: T.text } }, t('message')),
          h('p', { style: { color: T.text2, fontSize: 12 } }, t('messageHint')),
          h(MessageBar, { t }),
        ),

        pet.status?.nativeMissing ? h('div', {
          style: { color: T.danger, fontSize: 12 },
        }, t('nativeMissing')) : null,
      )
    }

    /* ---------- Session message bar (send / stop, like a pet chat bubble) ---------- */

    function useSessions() {
      const [sessions, setSessions] = useState([])
      const [error, setError] = useState('')
      const mount = useMount()
      const refresh = useCallback(async () => {
        if (!petNs) return
        try {
          const result = ok(await petNs.sessions())
          setSessions(result?.items ?? [])
          setError('')
        } catch (e) { setError(String(e?.message || e)); setSessions([]) }
      }, [])
      useEffect(() => { void refresh() }, [refresh, mount.ready])
      return { sessions, error, refresh }
    }

    function MessageBar({ t, compact }) {
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')
      const [bubble, setBubble] = useState('')
      const [activeId, setActiveId] = useState('')
      const [running, setRunning] = useState(false)
      const mount = useMount()

      // Like Codex: automatically follow the active session, no picker.
      useEffect(() => {
        if (!mount.ready || !petNs) return
        let alive = true
        const poll = async () => {
          try {
            const s = ok(await petNs.state())
            if (alive) setBubble(s?.lastBubble || '')
            const a = ok(await petNs.active())
            if (alive) {
              setActiveId(a?.sessionId || '')
              const list = ok(await petNs.sessions())
              setRunning(Boolean((list?.items ?? []).find(x => x.sessionId === a?.sessionId)?.running))
            }
          } catch { /* keep last values */ }
        }
        void poll()
        const id = setInterval(poll, 2000)
        return () => { alive = false; clearInterval(id) }
      }, [mount.ready])

      async function send() {
        if (!text.trim()) return
        setBusy(true); setMsg('')
        try { ok(await petNs.send('', text.trim())); setText('') }
        catch (e) { setMsg(String(e?.message || e)) }
        finally { setBusy(false) }
      }

      async function stop() {
        setBusy(true); setMsg('')
        try { ok(await petNs.stopSession('')) }
        catch (e) { setMsg(String(e?.message || e)) }
        finally { setBusy(false) }
      }

      const inputStyle = {
        flex: 1, minWidth: 0, padding: '5px 8px',
        border: `1px solid ${T.border}`,
        borderRadius: T.radius,
        background: T.field,
        color: T.text,
        fontSize: 13,
      }

      return h('div', {
        style: compact
          ? { display: 'flex', alignItems: 'center', gap: 6 }
          : { display: 'flex', flexDirection: 'column', gap: 8 },
      },
        h('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: T.text2 },
        },
          h('span', null, activeId ? t('following') + ': ' + activeId.slice(0, 8) : t('noSession')),
          running ? h(Button, { onClick: () => void stop(), disabled: busy }, t('stopMessage')) : null,
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('input', {
            value: text,
            onChange: e => setText(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } },
            placeholder: t('messagePlaceholder'),
            style: inputStyle,
            disabled: !activeId,
          }),
          h(Button, { onClick: () => void send(), disabled: busy || !text.trim() || !activeId, tone: 'primary' },
            t('sendMessage')),
        ),
        bubble ? h('div', {
          style: {
            marginTop: 4, padding: '4px 8px', fontSize: 12,
            color: T.text, background: T.field, borderRadius: T.radius,
            borderLeft: `2px solid ${T.accent}`,
          },
        }, bubble) : null,
        msg ? h('div', { style: { color: T.danger, fontSize: 11 } }, msg) : null,
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
            searchPlaceholder: 'Search pets by name, slug, author, kind...',
            resultCount: '{count} pets',
            notReady: 'The Host bridge is not ready. Confirm the plugin row is enabled and the Host half loaded.',
            downloading: 'Downloading...',
            downloadDone: 'Downloaded {name}. You can now use it.',
            homepage: 'Petdex.dev', homepageHint: 'Browse the full gallery and create pets on the official site.',
            attribution: 'Unofficial plugin. Animation data and brand adapted from Petdex (MIT, © 2026 Crafter Station).',
            following: 'Following session', noSession: 'No active session yet',
            petsDir: 'Local pets directory', installedShort: 'Installed',
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
            searchPlaceholder: '按名称、slug、作者、类型搜索宠物…',
            resultCount: '共 {count} 只宠物',
            notReady: 'Host 桥接尚未就绪。请确认插件行已启用且 Host 半身已加载。',
            downloading: '下载中…',
            downloadDone: '已下载 {name}，现在可以使用了。',
            homepage: 'Petdex.dev 官网', homepageHint: '在官网浏览完整图鉴、制作宠物。',
            attribution: '非官方插件。动画数据与标识借鉴自 Petdex（MIT，© 2026 Crafter Station）。',
            following: '正在跟随会话', noSession: '暂无活跃会话',
            petsDir: '本地宠物目录', installedShort: '已安装',
          },
        }), 'dsh-pet: locale')

        const t = ctx.locale.bind(NS)

        try {
          await mountPet(ctx)
        } catch (e) {
          mountError = String(e?.message || e)
          ctx.logger?.warn('dsh-pet: remote mount failed: %s', mountError)
          notifyMount()
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-pet', order: 30,
          label: () => t('title'), locale: NS,
        }, () => h(PetSettings, { t })))

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'dsh-pet', locale: NS,
        }, ({ size }) => h('svg', {
          width: size, height: size, viewBox: '0 0 64 64', 'aria-hidden': true,
        },
          // Official Petdex mark: rounded tile + pixel face, tinted with
          // currentColor so it stays legible in light and dark themes.
          h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 16, fill: 'currentColor', opacity: 0.18 }),
          h('g', { fill: 'currentColor' },
            h('rect', { x: 22, y: 20, width: 6, height: 6 }),
            h('rect', { x: 36, y: 20, width: 6, height: 6 }),
            h('rect', { x: 16, y: 26, width: 6, height: 18 }),
            h('rect', { x: 42, y: 26, width: 6, height: 18 }),
            h('rect', { x: 22, y: 38, width: 20, height: 6 }),
          ),
        )))
      },
    }
  },
})
