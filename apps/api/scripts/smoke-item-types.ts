const API = 'http://localhost:4000/api';

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.local', password: 'Password123!' }),
  }).then((r) => r.json());
  if (!login.accessToken && !login.token) {
    console.error('login failed', login);
    process.exit(1);
  }
  const token = login.accessToken || login.token;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-company-id': login.companyId || login.user?.companyId || '' };

  // resolve company from /companies if needed
  if (!headers['x-company-id']) {
    const cos = await fetch(`${API}/companies`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    headers['x-company-id'] = cos?.[0]?.companyId || cos?.[0]?.company?.id || '';
  }

  const mk = async (body: any) => {
    const r = await fetch(`${API}/inventory/items`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));
    return j;
  };

  const inv = await mk({ name: 'Smoke Inv Camera', type: 'INVENTORY_PRODUCT', unit: 'EA', sellingPrice: 1500, purchaseCost: 900 });
  const non = await mk({ name: 'Smoke HDMI Cable', type: 'NON_INVENTORY_PRODUCT', unit: 'EA', sellingPrice: 25, purchaseCost: 10 });
  const svc = await mk({ name: 'Smoke Installation', type: 'SERVICE', unit: 'Job', sellingPrice: 2500, purchaseCost: 0 });
  console.log('created', { inv: inv.type, non: non.type, svc: svc.type });

  const wh = await fetch(`${API}/inventory/warehouses`, { headers }).then((r) => r.json());
  const warehouseId = wh[0]?.id;
  if (!warehouseId) throw new Error('no warehouse');

  const tryMove = async (itemId: string, label: string) => {
    const r = await fetch(`${API}/inventory/movements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ warehouseId, itemId, type: 'RECEIPT', quantity: 1, unitCost: 10 }),
    });
    const j = await r.json().catch(() => ({}));
    console.log(label, r.status, j.message || j.id || 'ok');
  };

  await tryMove(inv.id, 'INV_MOVE');
  await tryMove(non.id, 'NON_MOVE');
  await tryMove(svc.id, 'SVC_MOVE');

  // type lock after movement
  const patch = await fetch(`${API}/inventory/items/${inv.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ type: 'SERVICE' }),
  });
  const pj = await patch.json().catch(() => ({}));
  console.log('type-change-after-history', patch.status, pj.message || 'unexpected ok');

  const val = await fetch(`${API}/inventory/valuation`, { headers }).then((r) => r.json());
  const hasSvc = (val.rows || []).some((r: any) => r.id === svc.id || r.id === non.id);
  console.log('valuation_excludes_non_stock', !hasSvc, 'totalValue', val.totalValue);
}

main().catch((e) => { console.error(e); process.exit(1); });
