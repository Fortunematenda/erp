/**
 * End-to-end smoke test for the integrations API (v1) against a running API.
 * Usage: npx tsx scripts/smoke-integrations-api.ts [baseUrl]
 * Creates throwaway keys (revoked at the end) and test records in the demo company.
 */
const BASE = process.argv[2] || 'http://localhost:4000/api';
const run = Date.now().toString(36);
let failures = 0;

async function call(path: string, opts: { method?: string; token?: string; apiKey?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.apiKey) headers['X-Api-Key'] = opts.apiKey;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json };
}

function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 300)}`);
}

async function main() {
  const login = await call('/auth/login', { method: 'POST', body: { email: 'admin@demo.local', password: 'Password123!' } });
  const token = login.json?.token;
  if (!token) throw new Error(`Login failed (${login.status})`);

  const scopes = await call('/integrations/api-keys/scopes', { token });
  check('list scopes', scopes.status === 200 && scopes.json.length === 7, scopes.json);

  const full = await call('/integrations/api-keys', { method: 'POST', token, body: { name: `smoke ${run}`, source: `smoke-${run}`, scopes: scopes.json.map((s: any) => s.scope) } });
  check('create full-scope key', full.status === 201 && full.json.key?.startsWith('nxk_'), full.json);
  const key = full.json.key as string;
  const listed = await call('/integrations/api-keys', { token });
  check('key list never exposes secret or hash', listed.status === 200 && !JSON.stringify(listed.json).includes(key) && !JSON.stringify(listed.json).includes('keyHash'));

  check('no key -> 401', (await call('/integrations/v1/me')).status === 401);
  check('wrong key -> 401', (await call('/integrations/v1/me', { apiKey: key.slice(0, -2) + 'xx' })).status === 401);
  const me = await call('/integrations/v1/me', { apiKey: key });
  check('GET /me', me.status === 200 && me.json.source === `smoke-${run}`, me.json);
  const meBearer = await fetch(BASE + '/integrations/v1/me', { headers: { Authorization: `Bearer ${key}` } });
  check('Bearer header also accepted', meBearer.status === 200);
  check('user JWT is not an API key', (await call('/integrations/v1/me', { token })).status === 401);

  const cust = `sub-${run}`;
  const c1 = await call(`/integrations/v1/customers/${cust}`, { method: 'PUT', apiKey: key, body: { name: 'Smoke Subscriber', email: 'smoke@example.com' } });
  check('PUT customer creates (201)', c1.status === 201 && c1.json.externalId === cust, c1.json);
  const c2 = await call(`/integrations/v1/customers/${cust}`, { method: 'PUT', apiKey: key, body: { name: 'Smoke Subscriber Renamed' } });
  check('PUT customer again updates same record (200)', c2.status === 200 && c2.json.id === c1.json.id && c2.json.name === 'Smoke Subscriber Renamed', c2.json);
  check('bad external id -> 400', (await call('/integrations/v1/customers/bad%20id', { method: 'PUT', apiKey: key, body: { name: 'x' } })).status === 400);

  const charge = { customerExternalId: cust, currency: 'ZAR', dueDate: '2026-12-01', reference: 'Nov 2026', fiscalRequired: false, lines: [{ description: 'Fibre 50Mbps - Nov 2026', quantity: 1, unitPrice: 400, taxRate: 0 }] };
  const inv = `inv-${run}`;
  const i1 = await call(`/integrations/v1/invoices/${inv}`, { method: 'PUT', apiKey: key, body: charge });
  check('PUT invoice creates draft (201)', i1.status === 201 && i1.json.status === 'DRAFT' && i1.json.total === 400 && i1.json.balanceDue === null, i1.json);
  const i2 = await call(`/integrations/v1/invoices/${inv}`, { method: 'PUT', apiKey: key, body: charge });
  check('PUT same invoice again returns it (200)', i2.status === 200 && i2.json.id === i1.json.id, i2.json);
  const i3 = await call(`/integrations/v1/invoices/${inv}`, { method: 'PUT', apiKey: key, body: { ...charge, lines: [{ ...charge.lines[0], unitPrice: 450 }] } });
  check('PUT invoice with changed charge -> 409', i3.status === 409, i3.json);
  check('invoice for unknown customer -> 404', (await call(`/integrations/v1/invoices/inv-x-${run}`, { method: 'PUT', apiKey: key, body: { ...charge, customerExternalId: 'nobody' } })).status === 404);

  const posted = await call(`/integrations/v1/invoices/${inv}/post`, { method: 'POST', apiKey: key });
  check('post invoice', posted.status === 200 && posted.json.status === 'POSTED' && posted.json.paymentStatus === 'UNPAID' && posted.json.balanceDue === 400, posted.json);
  const postedAgain = await call(`/integrations/v1/invoices/${inv}/post`, { method: 'POST', apiKey: key });
  check('posting twice is harmless', postedAgain.status === 200 && postedAgain.json.balanceDue === 400, postedAgain.json);

  const pay = `pay-${run}`;
  const payment = { customerExternalId: cust, amount: 150, method: 'EFT', reference: 'STRIPE-123', allocations: [{ invoiceExternalId: inv, amount: 150 }] };
  const p1 = await call(`/integrations/v1/payments/${pay}`, { method: 'PUT', apiKey: key, body: payment });
  check('PUT payment records receipt (201)', p1.status === 201 && p1.json.amount === 150 && p1.json.allocations[0]?.invoiceExternalId === inv, p1.json);
  const p2 = await call(`/integrations/v1/payments/${pay}`, { method: 'PUT', apiKey: key, body: payment });
  check('PUT same payment again does not double-pay (200)', p2.status === 200 && p2.json.id === p1.json.id, p2.json);
  check('PUT payment with changed amount -> 409', (await call(`/integrations/v1/payments/${pay}`, { method: 'PUT', apiKey: key, body: { ...payment, amount: 200 } })).status === 409);

  const after = await call(`/integrations/v1/invoices/${inv}`, { apiKey: key });
  check('invoice shows partial payment', after.status === 200 && after.json.paymentStatus === 'PARTIALLY_PAID' && after.json.balanceDue === 250 && after.json.payments[0]?.externalId === pay, after.json);
  const custAfter = await call(`/integrations/v1/customers/${cust}`, { apiKey: key });
  check('customer balance reflects open invoice', custAfter.status === 200 && custAfter.json.balances.some((b: any) => b.currency === 'ZAR' && b.balanceDue === 250), custAfter.json);
  const payRead = await call(`/integrations/v1/payments/${pay}`, { apiKey: key });
  check('GET payment', payRead.status === 200 && payRead.json.receiptNo === p1.json.receiptNo, payRead.json);

  const inv2 = `inv2-${run}`;
  const oneShot = await call(`/integrations/v1/invoices/${inv2}`, { method: 'PUT', apiKey: key, body: { ...charge, post: true } });
  check('create-and-post in one call', oneShot.status === 201 && oneShot.json.status === 'POSTED' && oneShot.json.balanceDue === 400, oneShot.json);

  const raced = `race-${run}`;
  const burst = await Promise.all(Array.from({ length: 6 }, () => call(`/integrations/v1/invoices/${raced}`, { method: 'PUT', apiKey: key, body: charge })));
  const ids = new Set(burst.filter((r) => r.status < 300).map((r) => r.json.id));
  check('6 concurrent PUTs create exactly one invoice', burst.filter((r) => r.status === 201).length === 1 && ids.size === 1 && burst.every((r) => [200, 201, 409].includes(r.status)), burst.map((r) => r.status));

  const limited = await call('/integrations/api-keys', { method: 'POST', token, body: { name: `smoke read-only ${run}`, source: `smoke-${run}`, scopes: ['invoices:read'] } });
  const roKey = limited.json.key as string;
  check('read-only key can read', (await call(`/integrations/v1/invoices/${inv}`, { apiKey: roKey })).status === 200);
  check('read-only key cannot write (403)', (await call(`/integrations/v1/invoices/inv-ro-${run}`, { method: 'PUT', apiKey: roKey, body: charge })).status === 403);
  const otherSource = await call('/integrations/api-keys', { method: 'POST', token, body: { name: `smoke other ${run}`, source: `other-${run}`, scopes: ['invoices:read'] } });
  check('keys from another source cannot see these IDs (404)', (await call(`/integrations/v1/invoices/${inv}`, { apiKey: otherSource.json.key })).status === 404);
  check('unknown scope rejected', (await call('/integrations/api-keys', { method: 'POST', token, body: { name: 'x', source: 'x1', scopes: ['everything'] } })).status === 400);

  for (const k of [full.json, limited.json, otherSource.json]) await call(`/integrations/api-keys/${k.id}/revoke`, { method: 'POST', token });
  check('revoked key -> 401', (await call('/integrations/v1/me', { apiKey: key })).status === 401);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
