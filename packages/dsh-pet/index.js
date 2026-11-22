/**
 * @guyu233/dsh-pet — Host half.
 *
 * A Cordis Service plugin that exposes a Typert Remote namespace `pet`,
 * consumed by the Settings section. Owns the native floating-pet process and
 * maps verified DSH events to Petdex animation states. No loopback HTTP:
 * all Host<->Client traffic rides the official Remote gateway.
 *
 * Shape matches the installed Harness's own pure-JS Remote services: a
 * default-exported Service with bindTypertRemote + a prototype marker
 * descriptor (no TypeScript decorators needed).
 */

import { Service } from '@deepseek-ai/cordis'
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import { homedir, platform as osPlatform, arch as osArch } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/* State machine ported from Petdex (main.zig / state-queue.ts):
 * - steady states persist until the next event: idle, running, waiting
 * - transient states play for their dwell then revert to the steady state:
 *   jumping, waving, failed, review
 * - a stuck `running` with no fresh event reverts after a grace period.
 */
const TRANSIENT_STATES = new Set(['jumping', 'waving', 'failed', 'review'])
const MIN_DWELL_MS = 250
const STALE_RUNNING_GRACE_MS = 30_000
const TRANSIENT_DWELL_MS = {
  jumping: 1200,
  waving: 1200,
  failed: 1200,
  review: 1200,
}

export const Config = z.object({
  enabled: z.boolean().default(false),
  petSlug: z.string().default('boba'),
  scale: z.number().min(50).max(300).step(1).default(100),
  opacity: z.number().min(20).max(100).step(1).default(85),
})

const here = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url))

function nativeBinary() {
  const os = osPlatform()
  const arch = osArch()
  const base = join(here, 'native')
  if (os === 'win32' && arch === 'x64') return join(base, 'win32-x64', 'dsh-pet.exe')
  if (os === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return join(base, `darwin-${arch}`, 'dsh-pet')
  }
  return null
}

function petRoot() { return join(homedir(), '.dsh', 'pets') }
function petDir(slug) { return join(petRoot(), slug) }
function safeSlug(slug) {
  return typeof slug === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(slug) ? slug : null
}

/** Strict boolean coercion for config values arriving from Cordis.
 * Depending on how a profile supplies config, `enabled` may be a primitive,
 * a string, or a schemastery value object with `.get()`. A schema *definition*
 * object is truthy, which would otherwise start the pet while disabled. */
function asBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'false' || s === '0' || s === 'off' || s === 'no' || s === '') return false
    if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
    return false
  }
  if (v && typeof v === 'object' && typeof v.get === 'function') {
    try { return asBool(v.get()) } catch { return false }
  }
  // Anything else (schema descriptors, null, undefined, objects) is NOT enabled.
  return false
}

/** Host Remote service, namespace `pet`. All methods return JSON-safe values. */
export default class PetRemoteService extends Service {
  constructor(ctx, config = {}) {
    super(ctx, 'pet')
    this.config = config
    this.overrides = {}
    this.handle = null
    this.currentState = 'idle'      // currently displayed animation state
    this.steadyState = 'idle'       // state to revert to after a transient
    this.settleTimer = null
    this.staleTimer = null
    this.generation = 0
    this.lastBubble = { text: '', at: 0 }
    this.downloadProgress = null   // { slug, phase, pct }
    this.typertRemote = bindTypertRemote(this, 'pet', { namespace: 'pet' })

    // Observe only events verified against the installed Harness and the
    // official core docs. A plain ctx.on listener on the approval waterfall
    // never calls next(), so it cannot alter behavior.
    ctx.on('agent/status', (payload) => {
      // idle<->running is the authoritative steady signal (emit mode).
      const running = payload?.status === 'running'
      if (running) {
        this._setSteady('running')            // steady: work in progress
      } else if (this.steadyState === 'running' || this.currentState === 'running') {
        this._setSteady('idle')               // turn finished: celebrate then settle
        this._applyState('waving', TRANSIENT_DWELL_MS.waving)
      } else {
        this._setSteady('idle')
      }
    })
    ctx.on('agent/error', () => this._applyState('failed', TRANSIENT_DWELL_MS.failed))
    // approval/request is a waterfall event; observing it means "waiting"
    // until the agent status says otherwise (approval resolved -> running).
    ctx.on('approval/request', () => this._setSteady('waiting'))
    ctx.on('tools/result', () => this._applyState('running'))
    ctx.on('loader/volatile-update', () => {
      const values = this._cfg()
      if (values.enabled) void this._start(); else this._stop()
    })

    // Cordis runs this disposer on unload, HMR and Harness exit: no residue.
    ctx.effect(() => () => {
      this._stop()
      if (this.settleTimer) clearTimeout(this.settleTimer)
      if (this.staleTimer) clearTimeout(this.staleTimer)
    }, 'dsh-pet: pet process and timers cleanup')
    if (this._cfg().enabled) void this._start()
  }

  /** Only the local owner may start processes or write pet files. */
  _requireTrustedCaller(entry) {
    const invocation = this.ctx && typeof this.ctx === 'object' ? this.ctx.invocation : undefined
    if (invocation === undefined) return
    const peer = invocation && typeof invocation === 'object' ? invocation.peer : undefined
    const principal = peer && typeof peer === 'object' ? peer.principal : undefined
    if (!(principal && principal.kind === 'owner')) {
      throw Object.assign(new Error(`${entry} is only available to the local owner of this Host`), {
        code: 'dsh-pet/forbidden',
      })
    }
  }

  _cfg() {
    const c = this.config
    return {
      enabled: asBool(this.overrides.enabled ?? (c.enabled?.get?.() ?? c.enabled)),
      petSlug: this.overrides.petSlug ?? (c.petSlug?.get?.() ?? c.petSlug),
      scale: this.overrides.scale ?? (c.scale?.get?.() ?? c.scale),
      opacity: this.overrides.opacity ?? (c.opacity?.get?.() ?? c.opacity),
    }
  }

  /** Write a state line to the native renderer. Only on change, so an
   * identical repeated event does not restart the frame animation. */
  _post(state) {
    if (state === this.currentState) return
    this.currentState = state
    if (!this.handle?.stdin) return
    try { this.handle.stdin.write(`${state}\n`) } catch { /* process going away */ }
  }

  /** A steady state persists until the next event; refresh the stale-running
   * watchdog so a `running` with no fresh events eventually settles. */
  _setSteady(state) {
    this.steadyState = state
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null }
    this._post(state)
    if (this.staleTimer) clearTimeout(this.staleTimer)
    this.staleTimer = setTimeout(() => {
      if (this.steadyState === 'running' && !TRANSIENT_STATES.has(this.currentState)) {
        this._setSteady('idle')
      }
    }, STALE_RUNNING_GRACE_MS)
  }

  /** Apply an event state. Transient states revert to the steady state after
   * their dwell (Petdex state-queue semantics); steady states just persist. */
  _applyState(state, dwellMs) {
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null }
    this._post(state)
    if (TRANSIENT_STATES.has(state)) {
      const dwell = Math.max(MIN_DWELL_MS, dwellMs || MIN_DWELL_MS)
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null
        this._post(this.steadyState)
      }, dwell)
    } else {
      // A steady event state (e.g. running from tools/result) also refreshes
      // the stale watchdog.
      this.steadyState = state
      if (this.staleTimer) clearTimeout(this.staleTimer)
      this.staleTimer = setTimeout(() => {
        if (this.steadyState === 'running' && !TRANSIENT_STATES.has(this.currentState)) {
          this._setSteady('idle')
        }
      }, STALE_RUNNING_GRACE_MS)
    }
  }

  _stop() {
    this.generation++
    const current = this.handle
    this.handle = null
    if (current) current.terminate()
    if (this.settleTimer) { clearTimeout(this.settleTimer); this.settleTimer = null }
    if (this.staleTimer) { clearTimeout(this.staleTimer); this.staleTimer = null }
    this.currentState = 'idle'
    this.steadyState = 'idle'
  }

  async _start() {
    this._stop()
    const values = this._cfg()
    // Hard guard: never show a pet while the enable switch is off. This is
    // the last line of defence against stale config or schema-descriptor values.
    if (!values.enabled) return
    const binary = nativeBinary()
    if (!binary || !existsSync(binary)) {
      this.ctx.logger.warn('dsh-pet: native binary missing for %s/%s', osPlatform(), osArch())
      return
    }
    const dir = petDir(values.petSlug)
    if (!existsSync(dir)) {
      this.ctx.logger.warn('dsh-pet: pet "%s" is not downloaded yet', values.petSlug)
      return
    }
    const subprocess = this.ctx.get('subprocess')
    if (!subprocess) {
      this.ctx.logger.warn('dsh-pet: ctx.subprocess is unavailable in this profile')
      return
    }
    const myGeneration = this.generation
    try {
      this.handle = subprocess.spawn({
        argv: [binary, '--pet-dir', dir, '--scale', String(values.scale), '--opacity', String(values.opacity)],
        cwd: here,
        stdio: { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' },
        graceMs: 1500,
        env: { DSH_PET_PARENT_PID: String(process.pid) },
      })
      // New process starts at idle in the renderer; push the live state even
      // if it equals currentState (bypass the dedup guard for a fresh stdin).
      try { this.handle.stdin.write(`${this.currentState}\n`) } catch { /* going away */ }
      void this.handle.done.catch(() => {}).finally(() => {
        if (this.generation === myGeneration) this.handle = null
      })
    } catch (error) {
      this.ctx.logger.warn('dsh-pet: failed to start native pet: %s', error?.message ?? error)
    }
  }

  async _saveConfig(patch) {
    Object.assign(this.overrides, patch)
    const entry = this.ctx.fiber?.entry
    const editor = this.ctx.get?.('configEditor')
    if (entry !== undefined && editor) {
      try {
        const current = this._cfg()
        await editor.edit(entry, () => ({ ...current, ...patch }))
      } catch (error) {
        this.ctx.logger.warn('dsh-pet: could not persist config: %s', error?.message ?? error)
      }
    }
  }

  _installed() {
    const root = petRoot()
    if (!existsSync(root)) return []
    return readdirSync(root).filter(name => {
      try { return statSync(join(root, name)).isDirectory() && safeSlug(name) !== null }
      catch { return false }
    })
  }

  /* ---------------- Remote methods (JSON-safe, positional args) ---------------- */

  state() {
    const c = this._cfg()
    const bin = nativeBinary()
    return {
      ok: true,
      running: this.handle !== null,
      state: this.currentState,
      active: c.petSlug,
      enabled: c.enabled,
      scale: c.scale,
      opacity: c.opacity,
      installed: this._installed(),
      nativeMissing: !bin || !existsSync(bin),
      lastBubble: Date.now() - this.lastBubble.at < 10000 ? this.lastBubble.text : '',
      downloadProgress: this.downloadProgress,
      petsDir: petRoot(),
    }
  }

  async setConfig(enabled, petSlug, scale, opacity) {
    try {
      this._requireTrustedCaller('setConfig')
      const slug = safeSlug(petSlug)
      if (!slug) return { ok: false, error: 'invalid pet slug' }
      await this._saveConfig({
        enabled: Boolean(enabled),
        petSlug: slug,
        scale: Math.max(50, Math.min(300, Number(scale) || 100)),
        opacity: Math.max(20, Math.min(100, Number(opacity) || 85)),
      })
      if (enabled) await this._start(); else this._stop()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  async start() {
    try {
      this._requireTrustedCaller('start')
      await this._saveConfig({ enabled: true })
      await this._start(); return { ok: true }
    } catch (error) { return { ok: false, error: String(error?.message ?? error) } }
  }

  stop() {
    try {
      this._requireTrustedCaller('stop')
      this._stop()
      return { ok: true }
    } catch (error) { return { ok: false, error: String(error?.message ?? error) } }
  }

  async download(slug, spriteUrl, meta) {
    try {
      this._requireTrustedCaller('download')
      const safe = safeSlug(slug)
      if (!safe) return { ok: false, error: 'invalid slug' }
      const url = new URL(spriteUrl)
      const trusted = [
        'assets.petdex.dev',
        'petdex-assets.raillyhugo.workers.dev',
        'pub-94495283df974cfea5e98d6a9e3fa462.r2.dev',
      ]
      if (url.protocol !== 'https:' || !trusted.includes(url.hostname)) {
        return { ok: false, error: 'untrusted asset host' }
      }
      const dir = petDir(safe)
      mkdirSync(dir, { recursive: true })
      this.downloadProgress = { slug: safe, phase: 'connecting', pct: 0 }
      const response = await fetch(url)
      if (!response.ok) {
        this.downloadProgress = null
        return { ok: false, error: `download ${response.status}` }
      }
      const total = Number(response.headers.get('content-length')) || 0
      let received = 0
      const chunks = []
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(Buffer.from(value))
          received += value.byteLength
          const pct = total ? Math.min(99, Math.round(received * 100 / total)) : Math.min(99, Math.round(received / 65536))
          this.downloadProgress = { slug: safe, phase: 'downloading', pct, bytes: received, total }
          if (received > 20 * 1024 * 1024) {
            this.downloadProgress = null
            return { ok: false, error: 'asset too large' }
          }
        }
      } else {
        chunks.push(Buffer.from(await response.arrayBuffer()))
      }
      const bytes = Buffer.concat(chunks)
      this.downloadProgress = { slug: safe, phase: 'saving', pct: 100 }
      writeFileSync(join(dir, 'spritesheet.webp'), bytes)
      // Petdex-compatible pet.json: canonical field names so a downloaded
      // pack could be used by other Petdex tooling later. `meta` comes from
      // the public manifest when available.
      const m = meta && typeof meta === 'object' ? meta : {}
      const version = m.spriteVersionNumber === 1 ? 1 : 2
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        slug: safe,
        displayName: typeof m.displayName === 'string' ? m.displayName : safe,
        kind: typeof m.kind === 'string' ? m.kind : 'creature',
        submittedBy: typeof m.submittedBy === 'string' ? m.submittedBy : null,
        spriteVersionNumber: version,
        license: 'unspecified',
        animationStates: [
          'idle', 'running-right', 'running-left', 'waving', 'jumping',
          'failed', 'waiting', 'running', 'review',
        ],
        spritesheet: 'spritesheet.webp',
        source: `https://petdex.dev/pets/${safe}`,
      }, null, 2))
      this.downloadProgress = null
      return { ok: true }
    } catch (error) {
      this.downloadProgress = null
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  // Named `uninstall` (not `remove`): `remove` is a method on DSH's client
  // RemoteNamespaceService prototype and would fail $mount validation.
  uninstall(slug) {
    try {
      this._requireTrustedCaller('uninstall')
      const safe = safeSlug(slug)
      if (!safe) return { ok: false, error: 'invalid slug' }
      if (this._cfg().petSlug === safe) return { ok: false, error: 'cannot remove the active pet' }
      const dir = petDir(safe)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /* ---------------- Session bridge (message bubble / send / stop) ---------------- */

  _controller() {
    return this.ctx.get('sessionController')
  }

  /** Like Codex: follow the active session automatically — the running one,
   * else the most recently active non-blank session. */
  async _activeSession() {
    const controller = this._controller()
    if (!controller) return null
    const value = await controller.list({}, new AbortController().signal)
    const items = (value?.items ?? []).filter(s => !s.blank && s.agentAvailable !== false)
    items.sort((a, b) => {
      if (Boolean(a.running) !== Boolean(b.running)) return a.running ? -1 : 1
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    })
    if (items.length === 0) return null
    return String(items[0].sessionId)
  }

  /** Current auto-followed session for the UI (no picker needed). */
  async active() {
    try {
      const sessionId = await this._activeSession()
      return { ok: true, sessionId: sessionId || '' }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** List visible sessions (kept for diagnostics; UI no longer needs a picker). */
  async sessions() {
    try {
      const controller = this._controller()
      if (!controller) return { ok: false, error: 'sessionController is unavailable in this profile' }
      const value = await controller.list({}, new AbortController().signal)
      const items = (value?.items ?? []).map(item => ({
        sessionId: String(item.sessionId),
        running: Boolean(item.running),
        blank: Boolean(item.blank),
        updatedAt: Number(item.updatedAt) || 0,
        cwd: typeof item.cwd === 'string' ? item.cwd : undefined,
        origin: item.origin === 'subagent' ? 'subagent' : undefined,
        agentAvailable: Boolean(item.agentAvailable),
      }))
      // Prefer the most recently active session.
      items.sort((a, b) => b.updatedAt - a.updatedAt)
      return { ok: true, items: items.slice(0, 50) }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** Send a text message into a session's inbox via the official controller. */
  async send(sessionId, text) {
    try {
      this._requireTrustedCaller('send')
      const content = typeof text === 'string' ? text.trim() : ''
      if (!content) return { ok: false, error: 'text is required' }
      const target = sessionId || (await this._activeSession())
      if (!target) return { ok: false, error: 'no active session to send to' }
      const controller = this._controller()
      if (!controller) return { ok: false, error: 'sessionController is unavailable in this profile' }
      const value = await controller.prompt({
        requestId: randomUUID(),
        sessionId: target,
        mode: 'queue',
        content: [{ type: 'text', text: content }],
      }, new AbortController().signal)
      this._bubble(`you: ${content.slice(0, 120)}`)
      return { ok: Boolean(value?.accepted), error: value?.accepted ? undefined : 'prompt not accepted' }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** Cancel the active turn (stop current message), auto-following session. */
  async stopSession(sessionId) {
    try {
      this._requireTrustedCaller('stopSession')
      const target = sessionId || (await this._activeSession())
      if (!target) return { ok: false, error: 'no active session to stop' }
      const controller = this._controller()
      if (!controller) return { ok: false, error: 'sessionController is unavailable in this profile' }
      const value = controller.cancel({ sessionId: target })
      this._bubble('stopped')
      return { ok: Boolean(value?.accepted), error: value?.accepted ? undefined : 'cancel not accepted' }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** Record a short, content-light bubble for the Client UI. The native
   * renderer only animates sprites; bubbles are shown in the settings/companion
   * UI so no text rendering is needed in the OS-level window. */
  _bubble(text) {
    // Bubbles are UI-only hints; they must not drive the animation state —
    // that is exclusively the state machine's job.
    this.lastBubble = { text: String(text).slice(0, 120), at: Date.now() }
  }
}

// Prototype @Remote marker descriptor — the generated equivalent of
// @Remote('state') etc., discovered by the gateway's SRC source mode.
Object.defineProperty(PetRemoteService.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: {
    version: 1,
    methods: [
      { method: 'state', invocation: { kind: 'direct' } },
      { method: 'setConfig', invocation: { kind: 'direct' } },
      { method: 'start', invocation: { kind: 'direct' } },
      { method: 'stop', invocation: { kind: 'direct' } },
      { method: 'download', invocation: { kind: 'direct' } },
      { method: 'uninstall', invocation: { kind: 'direct' } },
      { method: 'sessions', invocation: { kind: 'direct' } },
      { method: 'active', invocation: { kind: 'direct' } },
      { method: 'send', invocation: { kind: 'direct' } },
      { method: 'stopSession', invocation: { kind: 'direct' } },
    ],
  },
})
