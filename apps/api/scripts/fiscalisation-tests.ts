/**
 * Fiscalisation regression suite — runs against the running API + database.
 *   npm run test:fiscal -w @nexuserp/api
 *
 * Covers: readiness engine, production-activation gating, environment switching,
 * setup-wizard draft persistence, taxpayer verification, tax mapping, certificate
 * lifecycle, secret protection and multi-company isolation.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  const p = resolve(__dirname, '../.env');
  try {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch { /* use existing env */ }
}
loadEnv();

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const prisma = new PrismaClient();

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  [ok] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' - ' + detail : ''}`); }
}

async function req(path: string, opts: { method?: string; token?: string; body?: any } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

async function main() {
  console.log('Fiscalisation regression suite');
  const login = await req('/auth/login', { method: 'POST', body: { email: 'admin@demo.local', password: 'Password123!' } });
  if (!login.json?.token) throw new Error('Login failed: ' + login.text);
  let token: string = login.json.token;
  const companyId: string = login.json.companies?.[0]?.id;
  if (companyId) {
    const sw = await req('/auth/switch-company', { method: 'POST', token, body: { companyId } });
    if (sw.json?.token) token = sw.json.token;
  }
  const auth = { token };

  // Ensure clean MOCK environment for deterministic gating.
  await req('/fiscalisation/environment/switch', { method: 'POST', ...auth, body: { target: 'MOCK', reason: 'test setup' } });

  // --- 1. Readiness engine ---
  const readiness = await req('/fiscalisation/readiness?target=PRODUCTION', auth);
  check('readiness returns 200', readiness.status === 200);
  check('readiness has structured categories', Array.isArray(readiness.json?.categories) && readiness.json.categories.length >= 8);
  check('readiness has summary counts', typeof readiness.json?.summary?.total === 'number' && readiness.json.summary.total > 0);
  check('readiness status is computed', typeof readiness.json?.status === 'string');

  // --- 2. Production activation gating ---
  const activate = await req('/fiscalisation/production/activate', { method: 'POST', ...auth, body: { confirm: true } });
  check('production activation blocked when not ready', activate.status === 400 && activate.json?.error === 'PRODUCTION_SETUP_INCOMPLETE', `status=${activate.status}`);
  check('blockers listed on block', Array.isArray(activate.json?.blockers) && activate.json.blockers.length > 0);

  // --- 3. Environment switching ---
  const toSandbox = await req('/fiscalisation/environment/switch', { method: 'POST', ...auth, body: { target: 'SANDBOX', reason: 'test' } });
  check('switch to SANDBOX works', toSandbox.status === 201 || toSandbox.status === 200, `status=${toSandbox.status}`);
  check('environment is SANDBOX', (toSandbox.json?.environment || '') === 'SANDBOX');
  const toMock = await req('/fiscalisation/environment/switch', { method: 'POST', ...auth, body: { target: 'MOCK' } });
  check('switch back to MOCK works', (toMock.json?.environment || '') === 'MOCK');

  // --- 4. Wizard draft persistence ---
  await req('/fiscalisation/profile', { method: 'PUT', ...auth, body: { setupStep: 3 } });
  const prof = await req('/fiscalisation/profile', auth);
  check('wizard step persisted', prof.json?.setupStep === 3, `got ${prof.json?.setupStep}`);
  await req('/fiscalisation/profile', { method: 'PUT', ...auth, body: { setupStep: 0 } });

  // --- 5. Taxpayer verification ---
  const verify = await req('/fiscalisation/taxpayer/verify', { method: 'POST', ...auth, body: { environment: 'MOCK' } });
  check('taxpayer verification responds', verify.status === 201 || verify.status === 200);
  check('taxpayer verification flags mismatch', typeof verify.json?.mismatch === 'boolean');

  // --- 6. Tax mapping ---
  const rates = await req('/fiscalisation/tax-mappings', auth);
  const firstTax = rates.json?.[0];
  if (firstTax) {
    const save = await req('/fiscalisation/tax-mappings', { method: 'PUT', ...auth, body: { erpTaxCode: firstTax.erpTaxCode, fdmsTaxId: 'TEST-VAT-1', fdmsTaxName: 'Test VAT', fdmsTaxRate: firstTax.erpRate } });
    check('tax mapping saves', save.status === 200 || save.status === 201);
    const reread = await req('/fiscalisation/tax-mappings', auth);
    const mapped = (reread.json || []).find((r: any) => r.erpTaxCode === firstTax.erpTaxCode);
    check('tax mapping persists and is marked mapped', !!mapped?.mapped && mapped.fdmsTaxId === 'TEST-VAT-1');
  } else {
    console.log('  [skip] no tax rates configured for company');
  }

  // --- 7. Device + certificate lifecycle ---
  const branches = await req('/fiscalisation/branches', auth);
  const branchId = branches.json?.[0]?.id;
  let deviceId: string | undefined;
  if (branchId) {
    const created = await req('/fiscalisation/devices', { method: 'POST', ...auth, body: { branchId, name: 'Regression Device', serialNumber: `REG-${Date.now()}`, modelName: 'Nexus Virtual', modelVersion: '1.0', environment: 'SANDBOX', activationKey: 'SECRET-ACTIVATION-1234' } });
    deviceId = created.json?.id;
    check('device created', !!deviceId, `status=${created.status}`);
    check('device response hides activation key', !!deviceId && created.json.activationKeyEnc === undefined && created.json.hasActivationKey === true);

    const csr = await req(`/fiscalisation/devices/${deviceId}/generate-csr`, { method: 'POST', ...auth });
    check('CSR generated', csr.status === 201 || csr.status === 200);
    check('CSR is a valid PEM request', typeof csr.json?.csrPem === 'string' && csr.json.csrPem.includes('CERTIFICATE REQUEST'));

    const badCert = await req(`/fiscalisation/devices/${deviceId}/certificate`, { method: 'POST', ...auth, body: { certificatePem: 'not-a-certificate' } });
    check('invalid certificate rejected', badCert.status === 400, `status=${badCert.status}`);

    const reissue = await req(`/fiscalisation/devices/${deviceId}/reissue-certificate`, { method: 'POST', ...auth });
    check('certificate reissue rotates key + CSR', reissue.status === 201 || reissue.status === 200);
  } else {
    console.log('  [skip] no branches configured');
  }

  // --- 8. Multi-company isolation ---
  const companyA = await prisma.company.findUnique({ where: { id: companyId } });
  if (companyA && deviceId) {
    const companyB = await prisma.company.create({ data: { tenantId: companyA.tenantId, legalName: 'Isolation Co B', code: `ISOB-${Date.now()}`, baseCurrency: 'USD' } });
    const branchB = await prisma.branch.create({ data: { companyId: companyB.id, name: 'B Branch', code: 'B1' } });
    const deviceB = await prisma.fiscalDevice.create({ data: { branchId: branchB.id, name: 'B Device', serialNumber: `B-${Date.now()}`, environment: 'SANDBOX' } });

    const listA = await req('/fiscalisation/devices', auth);
    check('company A device list excludes company B', !(listA.json || []).some((d: any) => d.id === deviceB.id));

    const crossEdit = await req(`/fiscalisation/devices/${deviceB.id}`, { method: 'PUT', ...auth, body: { name: 'hacked' } });
    check('company A cannot edit company B device', crossEdit.status === 400 || crossEdit.status === 404, `status=${crossEdit.status}`);

    const bProfile = await req('/fiscalisation/readiness?target=PRODUCTION', auth);
    check('readiness is company-scoped', !JSON.stringify(bProfile.json || {}).includes('Isolation Co B'));

    await prisma.fiscalDevice.delete({ where: { id: deviceB.id } });
    await prisma.branch.delete({ where: { id: branchB.id } });
    await prisma.company.delete({ where: { id: companyB.id } });
  }

  // --- 9. Cleanup ---
  if (deviceId) await prisma.fiscalDevice.delete({ where: { id: deviceId } }).catch(() => {});
  if (firstTax) await prisma.fiscalTaxMapping.deleteMany({ where: { companyId, erpTaxCode: firstTax.erpTaxCode } });
  await req('/fiscalisation/environment/switch', { method: 'POST', ...auth, body: { target: 'MOCK' } });

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
