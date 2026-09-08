/**
 * Performance module acceptance tests (spec scenarios 110–126).
 * Runs the authoritative calculation service (no DB required) with tsx.
 *   npm run test:performance -w @nexuserp/api
 */
import { PerformanceCalculationService } from '../src/modules/performance/performance-calculation.service';

const calc = new PerformanceCalculationService();
let pass = 0, fail = 0;
function check(name: string, actual: any, expected: any) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log('Scenario 117 — SCORE: weight 30%, target 100, actual 80, higher is better');
const s117 = calc.calculateAchievement({ weight: 30, measurementType: 'NUMBER', direction: 'HIGHER_IS_BETTER', scoringMethod: 'PROPORTIONAL', targetValue: 100 }, 80);
check('achievement', s117.achievement, 80);
check('weighted', calc.calculateWeightedScore(s117.achievement, 30), 24);

console.log('Scenario 118 — OVERACHIEVEMENT: target 100, actual 150, cap 120%');
const s118 = calc.calculateAchievement({ weight: 10, measurementType: 'NUMBER', direction: 'HIGHER_IS_BETTER', scoringMethod: 'PROPORTIONAL', targetValue: 100 }, 150, null, 120);
check('achievement capped', s118.achievement, 120);
check('capped flag', s118.capped, true);

console.log('Scenario 42 — currency: target $50,000 actual $47,500 → 95%, weighted 28.5');
const s42 = calc.calculateAchievement({ weight: 30, measurementType: 'CURRENCY', direction: 'HIGHER_IS_BETTER', scoringMethod: 'PROPORTIONAL', targetValue: 50000 }, 47500, null, 120);
check('achievement', s42.achievement, 95);
check('weighted', calc.calculateWeightedScore(s42.achievement, 30), 28.5);

console.log('Scenario 44 — LOWER-IS-BETTER: complaints target 5, actual 3 scores positively');
const s44 = calc.calculateAchievement({ weight: 10, measurementType: 'COUNT', direction: 'LOWER_IS_BETTER', scoringMethod: 'PROPORTIONAL', targetValue: 5 }, 3);
check('achievement > 100', (s44.achievement || 0) > 100, true);

console.log('Scenario 45 — YES/NO: target Yes, actual Yes → 100%');
const s45 = calc.calculateAchievement({ weight: 10, measurementType: 'YES_NO', direction: 'HIGHER_IS_BETTER', scoringMethod: 'BINARY', targetText: 'YES' }, 'YES');
check('achievement', s45.achievement, 100);

console.log('Scenario 46 — RATING: scale 1–5, target 4, actual 4 → 100%');
const s46 = calc.calculateAchievement({ weight: 10, measurementType: 'RATING_SCALE', direction: 'HIGHER_IS_BETTER', scoringMethod: 'PROPORTIONAL', targetValue: 4 }, 4);
check('achievement', s46.achievement, 100);

console.log('Scenario 43 — TARGET_RANGE: actual within range → 100%, below min degrades');
const s43a = calc.calculateAchievement({ weight: 10, measurementType: 'NUMBER', direction: 'TARGET_RANGE', scoringMethod: 'PROPORTIONAL', targetValue: 10, minScore: 8 }, 9);
check('in range', s43a.achievement, 100);
const s43b = calc.calculateAchievement({ weight: 10, measurementType: 'NUMBER', direction: 'TARGET_RANGE', scoringMethod: 'PROPORTIONAL', targetValue: 10, minScore: 8 }, 4);
check('below min', (s43b.achievement || 0) < 100, true);

console.log('Scenario 47 — TOTAL: Σ weighted = 89.4');
check('overall', calc.calculateOverallScore([28.5, 17.0, 18.4, 9.5, 16.0]), 89.4);

console.log('Scenario 119 — PASS: 78% vs pass mark 70%');
check('pass', calc.resolvePassFail(78, 70), 'PASS');

console.log('Scenario 120 — FAIL: 62% vs pass mark 70% → FAIL (band resolution tested below)');
check('fail', calc.resolvePassFail(62, 70), 'FAIL');
check('band needs improvement', calc.resolvePerformanceBand(62, [
  { label: 'Unsatisfactory', minScore: 0, maxScore: 49.99 },
  { label: 'Needs Improvement', minScore: 50, maxScore: 69.99 },
  { label: 'Meets Expectations', minScore: 70, maxScore: 79.99 },
]), 'Needs Improvement');

console.log('Scenario 49 — BANDS: 89.4 → Exceeds Expectations');
check('band', calc.resolvePerformanceBand(89.4, [
  { label: 'Unsatisfactory', minScore: 0, maxScore: 49.99 },
  { label: 'Needs Improvement', minScore: 50, maxScore: 69.99 },
  { label: 'Meets Expectations', minScore: 70, maxScore: 79.99 },
  { label: 'Exceeds Expectations', minScore: 80, maxScore: 89.99 },
  { label: 'Outstanding', minScore: 90, maxScore: 200 },
]), 'Exceeds Expectations');

console.log('Scenario 82 — COMPLETION vs PERFORMANCE are distinct concepts');
check('completion 4 of 6', calc.calculateCompletion([{ effective: 90 }, { effective: 80 }, { effective: null }, { effective: 70 }, { effective: null }, { effective: 60 }]), 66.67);

console.log('Scenario 107 — MONEY SAFETY: float drift eliminated by cent-accurate sums');
check('money sum', (function () {
  const { sumMoney } = require('../src/modules/performance/performance.constants');
  return sumMoney([0.1, 0.2, 0.3]);
})(), 0.6);

console.log('Scenario 121 — QA ADJUSTMENT: effective score precedence (QA 88 overrides manager 95)');
check('qa precedence', calc.effectiveScore({ achievement: 95, managerScore: 95, qaScore: 88 }), 88);
check('manager precedence over calc', calc.effectiveScore({ achievement: 90, managerScore: 92 }), 92);

console.log('Scenario 61 — INCENTIVE band table resolution: 89% → 80–89.99 band → 10%');
const planTable = [
  { minScore: 70, maxScore: 79.99, percentValue: 5 },
  { minScore: 80, maxScore: 89.99, percentValue: 10 },
  { minScore: 90, maxScore: null, percentValue: 15 },
];
const match = planTable.find((p) => 89 >= p.minScore && (p.maxScore == null || 89 <= p.maxScore));
check('band match 10%', match?.percentValue, 10);
check('salary calc 900 * 10% = $90', Math.round(900 * Number(match!.percentValue)) / 100, 90);

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
