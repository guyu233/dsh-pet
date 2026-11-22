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
import { homedir, platform as osPlatform, arch as osArch } from 'node:os'
import { join, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

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

/** Host Remote service, namespace `pet`. All methods return JSON-safe values. */
export default class PetRemoteService extends Service {
  constructor(ctx, config = {}) {
    super(ctx, 'pet')
    this.config = config
    this.overrides = {}
    this.handle = null
    this.currentState = 'idle'
    this.agentStatus = 'idle'
    this.toolTimer = null
    this.generation = 0
    this.typertRemote = bindTypertRemote(this, 'pet', { namespace: 'pet' })

    // Observe only events verified against the installed Harness and the
    // official core docs: agent/status (idle<->running), agent/error,
    // approval/request, tools/result. A plain ctx.on listener on the
    // approval waterfall never calls next(), so it cannot alter behavior.
    ctx.on('agent/status', (payload) => {
      this.agentStatus = payload?.status === 'running' ? 'running' : 'idle'
      this._post(this.agentStatus === 'running' ? 'running' : 'waving')
    })
    ctx.on('agent/error', () => this._post('failed'))
    ctx.on('approval/request', () => this._post('waiting'))
    ctx.on('tools/result', () => {
      this._post('running')
      if (this.toolTimer) clearTimeout(this.toolTimer)
      this.toolTimer = setTimeout(
        () => this._post(this.agentStatus === 'running' ? 'running' : 'idle'),
        400,
      )
    })
    ctx.on('loader/volatile-update', () => {
      const values = this._cfg()
      if (values.enabled) void this._start(); else this._stop()
    })

    // Cordis runs this disposer on unload, HMR and Harness exit: no residue.
    ctx.effect(() => () => this._stop(), 'dsh-pet: pet process cleanup')
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
      enabled: this.overrides.enabled ?? (c.enabled?.get?.() ?? c.enabled),
      petSlug: this.overrides.petSlug ?? (c.petSlug?.get?.() ?? c.petSlug),
      scale: this.overrides.scale ?? (c.scale?.get?.() ?? c.scale),
      opacity: this.overrides.opacity ?? (c.opacity?.get?.() ?? c.opacity),
    }
  }

  _post(state) {
    this.currentState = state
    if (!this.handle?.stdin) return
    try { this.handle.stdin.write(`${state}\n`) } catch { /* process going away */ }
  }

  _stop() {
    this.generation++
    const current = this.handle
    this.handle = null
    if (current) current.terminate()
    this.currentState = 'idle'
  }

  async _start() {
    this._stop()
    const values = this._cfg()
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
      this._post(this.currentState)
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

  async download(slug, spriteUrl) {
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
      const response = await fetch(url)
      if (!response.ok) return { ok: false, error: `download ${response.status}` }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > 20 * 1024 * 1024) return { ok: false, error: 'asset too large' }
      writeFileSync(join(dir, 'spritesheet.webp'), bytes)
      writeFileSync(join(dir, 'pet.json'), JSON.stringify({
        slug: safe, spriteVersionNumber: 2, source: `https://petdex.dev/pets/${safe}`,
      }, null, 2))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  remove(slug) {
    try {
      this._requireTrustedCaller('remove')
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
      { method: 'remove', invocation: { kind: 'direct' } },
    ],
  },
})
