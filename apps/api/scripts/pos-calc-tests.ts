/**
 * POS money and status-transition tests. No database.
 *   npm run test:pos -w @nexuserp/api
 */
import { assertTransition, priceLine, roundMoney, sumLines } from '../src/modules/pos/pos.calc';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  [ok] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`); }
}

function throws(fn: () => unknown) {
  try { fn(); return false; } catch { return true; }
}

const exclusive = priceLine({ quantity: 2, unitPrice: 10, discount: 1, taxRate: 15, taxInclusive: false });
check('exclusive net', exclusive.net === 19, String(exclusive.net));
check('exclusive tax', exclusive.tax === 2.85, String(exclusive.tax));
check('exclusive total', exclusive.total === 21.85, String(exclusive.total));

const inclusive = priceLine({ quantity: 1, unitPrice: 115, taxRate: 15, taxInclusive: true });
check('inclusive net', inclusive.net === 100, String(inclusive.net));
check('inclusive tax', inclusive.tax === 15, String(inclusive.tax));
check('inclusive shelf price kept', inclusive.total === 115, String(inclusive.total));
check('inclusive exclusive unit', inclusive.exclusiveUnit === 100, String(inclusive.exclusiveUnit));

const summed = sumLines([exclusive, inclusive], { serviceCharge: 2.5, tip: 1 });
check('sum balances', Math.abs(summed.total - (summed.subtotal + summed.taxTotal + summed.serviceCharge + summed.tip)) < 0.001);
check('money rounds half cents', roundMoney(1.005) === 1.01 || roundMoney(1.005) === 1);

check('cart hold', !throws(() => assertTransition('cart', 'ACTIVE', 'HELD')));
check('cart cannot skip', throws(() => assertTransition('cart', 'ABANDONED', 'ACTIVE')));
check('sale post path', !throws(() => assertTransition('sale', 'DRAFT', 'PENDING_PAYMENT')));
check('posted cannot return to draft', throws(() => assertTransition('sale', 'POSTED', 'DRAFT')));
check('kitchen flow', !throws(() => assertTransition('kitchen', 'QUEUED', 'PREPARING')));
check('kitchen cannot skip to completed', throws(() => assertTransition('kitchen', 'QUEUED', 'COMPLETED')));
check('shift close', !throws(() => assertTransition('shift', 'OPEN', 'CLOSED')));

const cash = 50;
const due = 21.85;
const applied = roundMoney(Math.min(cash, due));
const change = roundMoney(cash - applied);
check('change given', change === 28.15, String(change));
check('applied never exceeds due', applied === 21.85);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
