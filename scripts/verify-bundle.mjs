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

// 4. Locale key parity (en/zh) for the pet dictionary
const enKeys = Object.keys(en.pet ?? {}).sort()
const zhKeys = Object.keys(zh.pet ?? {}).sort()
check(JSON.stringify(enKeys) === JSON.stringify(zhKeys), 'en/zh locale keys match')

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

for (const line of ok) console.log('  ok  ', line)
for (const line of fail) console.log('  FAIL', line)
console.log(`\n${ok.length} passed, ${fail.length} failed`)
if (fail.length) process.exit(1)
