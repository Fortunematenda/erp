const BASE = 'http://localhost:4000/api';
const EPS = 0.01;

async function login() {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.local', password: 'Password123!' }) });
  const d = await r.json();
  return { authorization: `Bearer ${d.token}` };
}

// Expected account-mapping per document source type. dr/cr are accepted codes;
// drAny/crAny=true means "at least one of these present" else "all present".
const MATRIX = {
  SALES_INVOICE:   { dr: ['1100'], drAny: false, cr: ['4000', '2100'], crAny: false, crBan: [], note: 'Dr AR, Cr Revenue+VAT' },
  RECEIPT:         { dr: ['1000'], drAny: false, cr: ['1100'], crAny: false, note: 'Dr Cash, Cr AR' },
  CREDIT_NOTE:     { dr: ['4000', '2100'], cr: ['1100'], note: 'Dr Revenue+VAT, Cr AR' },
  DEBIT_NOTE:      { dr: ['1100'], cr: ['4000', '2100'], note: 'Dr AR, Cr Revenue+VAT' },
  SUPPLIER_INVOICE:{ dr: ['1200', '6000'], drAny: true, cr: ['2000'], note: 'Dr Inventory/Expense, Cr AP' },
  SUPPLIER_PAYMENT:{ dr: ['2000', '6000'], drAny: true, cr: ['1000'], note: 'Dr AP (or ad-hoc expense), Cr Cash' },
  PAYROLL:         { dr: ['6000'], cr: ['1000', '2000', '3000', '2100'], crAny: true, crBan: ['4000'], note: 'Dr Expense, Cr Net to Bank/AP/Tax' },
};

async function main() {
  const auth = await login();
  // 1) All journals balanced? and matrix conformance
  const journals = await (await fetch(`${BASE}/finance/journals`, { headers: auth })).json();
  const linesOf = (j) => j.lines || [];
  let unbalanced = 0;
  const matrixFail = [];
  let matrixChecked = 0;
  const perType = {};
  const journalRows = [];
  for (const j of journals) {
    const lines = linesOf(j);
    const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    const type = j.sourceType || 'MANUAL';
    perType[type] = (perType[type] || 0) + 1;
    if (Math.abs(dr - cr) > EPS) { unbalanced++; journalRows.push(`  UNBALANCED ${j.reference} (${type}): Dr=${dr.toFixed(2)} Cr=${cr.toFixed(2)}`); }
    // matrix conformance
    const m = MATRIX[type];
    if (m) {
      matrixChecked++;
      const drCodes = [...new Set(lines.filter((l) => Number(l.debit) > EPS).map((l) => Number(l.account?.code || l.accountCode || '')))];
      const crCodes = [...new Set(lines.filter((l) => Number(l.credit) > EPS).map((l) => Number(l.account?.code || l.accountCode || '')))];
      const has = (codes, any, list) => (any ? list.some((c) => codes.includes(Number(c))) : list.every((c) => codes.includes(Number(c))));
      const drOk = !m.dr || m.dr.length === 0 || has(drCodes, m.drAny, m.dr);
      const crOk = !m.cr || m.cr.length === 0 || has(crCodes, m.crAny, m.cr);
      const banOk = !m.crBan || !m.crBan.some((c) => crCodes.includes(Number(c)));
      const expected = `Dr${m.drAny ? '~' : ''}=[${m.dr.join(',')}] Cr${m.crAny ? '~' : ''}=[${m.cr.join(',')}]${m.crBan ? ' CrBan=[' + m.crBan + ']' : ''}`;
      if (!drOk || !crOk || !banOk) matrixFail.push(`  MISMATCH ${j.reference} (${type}): Dr=[${drCodes}] Cr=[${crCodes}] expected ${expected}`);
    }
  }
  console.log(`\n=== ACCOUNTING MATRIX ===`);
  console.log(`Journals checked (balance): ${journals.length}`);
  console.log(`Unbalanced journal entries: ${unbalanced}`);
  journalRows.forEach((r) => console.log(r));
  console.log(`Matrix-conformance checked (typed sourceTypes): ${matrixChecked}`);
  matrixFail.forEach((r) => console.log(r));
  console.log(`Type distribution: ${Object.entries(perType).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  // 2) Trial balance balances
  const tb = await (await fetch(`${BASE}/finance/trial-balance`, { headers: auth })).json();
  const tdr = tb.reduce((s, r) => s + Number(r.debit || 0), 0);
  const tcr = tb.reduce((s, r) => s + Number(r.credit || 0), 0);
  console.log(`\n=== TRIAL BALANCE ===`);
  console.log(`Total Debit  = ${tdr.toFixed(2)}`);
  console.log(`Total Credit = ${tcr.toFixed(2)}`);
  console.log(`Balanced?    = ${Math.abs(tdr - tcr) <= EPS ? 'YES' : 'NO (delta ' + Math.abs(tdr - tcr).toFixed(2) + ')'}`);

  const pass = unbalanced === 0 && matrixFail.length === 0 && Math.abs(tdr - tcr) <= EPS;
  console.log(`\nACCOUNTING-RESULT: ${pass ? 'PASS' : 'FAIL'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
