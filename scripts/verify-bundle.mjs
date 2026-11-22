/**
 * Static consistency checks for the dsh-pet bundle. Runs with plain Node,
 * no dependencies. Verifies what can be verified without a DSH runtime.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages', 'dsh-pet')
const read = (p) => readFileSync(join(pkgDir, p), 'utf8')
const fail = []
const ok = []

function check(cond, label) {
  (cond ? ok : fail).push(label)
}

// 1. JSON validity
let pkg, en, zh
try {
  pkg = JSON.parse(read('package.json'))
  en = JSON.parse(read('locale/en.json'))
  zh = JSON.parse(read('locale/zh.json'))
  check(true, 'JSON files parse')
} catch (e) {
  check(false, `JSON files parse: ${e.message}`)
}

// 2. JS syntax via node --check
for (const f of ['index.js', 'client.js']) {
  try {
    execFileSync(process.execPath, ['--check', join(pkgDir, f)], { stdio: 'pipe' })
    check(true, `${f} syntax`)
  } catch (e) {
    check(false, `${f} syntax: ${e.stderr?.toString().split('\n')[0]}`)
  }
}

// 3. Host descriptor methods vs implemented methods
const host = read('index.js')
const client = read('client.js')
const descriptorBlock = host.match(/Remote methods[\s\S]*?methods:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
const hostMethods = [...descriptorBlock.matchAll(/method:\s*'([^']+)'/g)].map(m => m[1])
const implMethods = [...host.matchAll(/^  (?:async )?([a-zA-Z][\w]*)\([^)]*\) \{/gm)].map(m => m[1])
const clientMethods = [...client.matchAll(/method\('([^']+)'/g)].map(m => m[1])

check(hostMethods.length > 0, `Host descriptor has methods (${hostMethods.length})`)
for (const m of hostMethods) {
  check(implMethods.includes(m), `Host implements descriptor method ${m}`)
  check(clientMethods.includes(m), `Client declares descriptor method ${m}`)
}
check(hostMethods.length === clientMethods.length, 'Host/Client method counts match')

// DSH RemoteNamespaceService reserved field/prototype names: a Remote method
// with one of these fails `remote.$mount` with a name-conflict error.
const RESERVED = new Set([
  'ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace',
  'assertMethodAvailable', 'has', 'installDirect', 'installScoped', 'install', 'remove',
])
for (const m of hostMethods) {
  check(!RESERVED.has(m), `Remote method '${m}' is not a reserved namespace name`)
}

// 4. Locale key parity (en/zh) for the pet dictionary
const enKeys = Object.keys(en.pet ?? {}).sort()
const zhKeys = Object.keys(zh.pet ?? {}).sort()
check(JSON.stringify(enKeys) === JSON.stringify(zhKeys), 'en/zh locale keys match')

// 4b. The inline dictionaries in client.js must cover every file locale key.
// Check at least twice (en block + zh block) by counting `key:` occurrences.
for (const key of enKeys) {
  const re = new RegExp(`\\b${key}:`, 'g')
  const hits = (client.match(re) ?? []).length
  check(hits >= 2, `client.js inline dictionaries include '${key}' (en+zh)`)
}

// 5. Config fields vs patch config fields (no unknown keys)
const cfgBlock = host.match(/export const Config = z\.object\(\{([\s\S]*?)\}\)/)?.[1] ?? ''
const cfgFields = [...cfgBlock.matchAll(/^\s*(\w+):\s*z\./gm)].map(m => m[1])
const patch = read('cordis.patch.yml')
const patchCfgBlock = patch.match(/config:\s*([\s\S]*)/)?.[1] ?? ''
const patchFields = [...patchCfgBlock.matchAll(/^\s*(\w+):/gm)].map(m => m[1])
for (const f of patchFields) {
  check(cfgFields.includes(f), `patch config field '${f}' exists in Config schema`)
}

// 6. package.json files list covers runtime files
for (const f of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg']) {
  check((pkg.files ?? []).includes(f), `package.json files includes ${f}`)
}
check((pkg.files ?? []).some(x => x.includes('native/')), 'package.json files includes native binaries')

// 7. No loopback HTTP remnants
check(!/127\.0\.0\.1|createServer|localhost/.test(host + client), 'no loopback HTTP remnants')

// 8. DSH install-format compliance (from official host-plugin.md /
//    plugin-manager source): bundle must be a package with dsh.bundle.patch
//    pointing at a real, loadable YAML file; entry must be a valid module.
check(pkg.name?.startsWith('@') || typeof pkg.name === 'string', 'package.json has a name')
check(typeof pkg.version === 'string' && pkg.version.length > 0, 'package.json has a version')
check(pkg.type === 'module', 'package.json type is module')
check(pkg.private === true, 'package.json private is true (local bundle)')
check(typeof pkg.dsh?.bundle?.patch === 'string', 'dsh.bundle.patch is declared')
const patchRef = (pkg.dsh?.bundle?.patch ?? '').replace(/^\.\//, '')
check(patchRef === 'cordis.patch.yml', 'dsh.bundle.patch points to cordis.patch.yml')
check(patch.includes('insert:') && patch.includes('@guyu233/dsh-pet'), 'patch inserts the plugin row')
check(pkg.exports?.['.'] === './index.js', 'exports "." maps to ./index.js')
check(pkg.exports?.['./client'] === './client.js', 'exports "./client" maps to ./client.js')
check(pkg.exports?.['./locale/*.json'] === './locale/*.json', 'exports locale glob')
check(pkg.exports?.['./icon'] === './icon.svg', 'exports icon')
check(typeof pkg.engines?.dsh === 'string', 'engines.dsh is declared')

// Every path in `files` that points at a concrete file must exist.
const { existsSync } = await import('node:fs')
for (const f of (pkg.files ?? [])) {
  if (f.includes('*')) continue
  check(existsSync(join(pkgDir, f)), `files entry exists: ${f}`)
}

// Native binary for at least one platform must be present and listed.
const nativeFiles = (pkg.files ?? []).filter(x => x.startsWith('native/'))
check(nativeFiles.length > 0 && nativeFiles.some(f => existsSync(join(pkgDir, f))),
  'at least one listed native binary exists on disk')

for (const line of ok) console.log('  ok  ', line)
for (const line of fail) console.log('  FAIL', line)
console.log(`\n${ok.length} passed, ${fail.length} failed`)
if (fail.length) process.exit(1)
