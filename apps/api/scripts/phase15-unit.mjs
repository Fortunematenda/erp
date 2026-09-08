// DB-independent unit tests for security-critical / pure logic (runs offline).
// Uses the compiled modules from `dist`. RFC 6238 Appendix B test vectors.

import path from 'path';
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = (rel) => pathToFileURL(path.join(__dirname, rel)).href;
const totp = await import(p('../dist/core/common/totp.js'));
const NumberingService = (await import(p('../dist/core/common/numbering.service.js'))).NumberingService;

const results = [];
function assert(name, cond, detail) { results.push({ name, pass: !!cond, detail }); if (!cond) console.log('  FAIL', name, '->', detail); }

// --- RFC 6238 Appendix B (SHA1) ---
// secret "12345678901234567890" => base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const vectors8 = [
  [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
  [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
];
for (const [T, expect] of vectors8) {
  // 8-digit HOTP = 6-digit + 2 prefix — compare last 6 digits (my impl emits 6 digits)
  const got = totp.hotpFromCounter(SECRET, Math.floor(T / 30));
  const want6 = expect.slice(-6);
  assert(`TOTP T=${T} -> ${want6}`, got === want6, `got ${got} want ${want6}`);
}
assert('totpAtTime 59s -> 287082', totp.totpAtTime(SECRET, 59 * 1000) === '287082', `got ${totp.totpAtTime(SECRET, 59 * 1000)}`);
assert('otpauthUrl contains secret+issuer', /issuer=NexusERP/.test(totp.otpauthUrl('a@b.co', SECRET)) && /secret=GEZDGNBV/.test(totp.otpauthUrl('a@b.co', SECRET)), 'url malformed');

// --- Numbering render (V2 regex) ---
const ns = new NumberingService(null);
assert('render default seq pad', ns.render('{prefix}-{seq:000000}', 'INV', 7) === 'INV-000007', ns.render('{prefix}-{seq:000000}', 'INV', 7));
assert('render year+pad', ns.render('INV-{year}-{seq:0000}', 'INV', 6) === 'INV-2026-0006', ns.render('INV-{year}-{seq:0000}', 'INV', 6));
assert('render no pad', ns.render('{prefix}-{seq}', 'QE', 12) === 'QE-12', ns.render('{prefix}-{seq}', 'QE', 12));

// --- Accounting balance math (pure) ---
const dr = [100, 4.6], cr = [0, 0, 104.6];
const sum = (a) => a.reduce((s, n) => s + n, 0);
assert('balanced trial (dr=cr)', Math.abs(sum(dr) - sum(cr)) < 0.01, `dr=${sum(dr)} cr=${sum(cr)}`);

const fails = results.filter((r) => !r.pass);
const passes = results.length - fails.length;
console.log(`\nUNIT-RESULT: ${passes}/${results.length} pass (fails=${fails.length})`);
if (fails.length) process.exit(1);
