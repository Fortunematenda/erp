import { Injectable } from '@nestjs/common';
import { round2, round4 } from './performance.constants';

export type KpiSnapshot = {
  weight: number | string;
  measurementType: string;
  direction: string;
  scoringMethod: string;
  targetValue?: number | string | null;
  targetText?: string | null;
  minScore?: number | string | null; // for TARGET_RANGE
  dataSource?: string | null;
  [k: string]: any;
};

/**
 * Authoritative performance calculation service.
 * All formulas live here — the frontend only displays backend results.
 */
@Injectable()
export class PerformanceCalculationService {
  /** Default cap on achievement % for a single KPI (prevents domination). */
  static DEFAULT_MAX_ACHIEVEMENT = 120;

  /**
   * calculateAchievement — returns percent (0..cap).
   * Pure function; operates on plain numbers (Prisma Decimal arrives as string/number).
   */
  calculateAchievement(kpi: KpiSnapshot, actual: number | string | null | undefined, enteredScore?: number | null, maxAchievement = PerformanceCalculationService.DEFAULT_MAX_ACHIEVEMENT): { achievement: number | null; capped: boolean } {
    const cap = Math.max(100, Number(maxAchievement) || PerformanceCalculationService.DEFAULT_MAX_ACHIEVEMENT);
    const type = String(kpi.measurementType || 'NUMBER');
    const direction = String(kpi.direction || 'HIGHER_IS_BETTER');
    const actualNum = actual == null || actual === '' ? null : Number(actual);

    // Manual score / manual assessment: reviewer enters achievement % directly.
    if (type === 'MANUAL_SCORE' || kpi.scoringMethod === 'MANUAL') {
      if (enteredScore == null) return { achievement: null, capped: false };
      const v = Math.max(0, Math.min(cap, Number(enteredScore)));
      return { achievement: round2(v), capped: v > 100 };
    }

    // Yes/No & Pass-Fail
    if (type === 'YES_NO' || direction === 'PASS_FAIL' || kpi.scoringMethod === 'BINARY' || kpi.scoringMethod === 'PASS_FAIL') {
      if (actual == null && !kpi.targetText) return { achievement: null, capped: false };
      const target = kpi.targetText || 'YES';
      const actualText = kpi.targetText && actual == null ? null : String(actual == null ? '' : actual).trim().toUpperCase();
      // For YES_NO the actual is boolean-ish: 1/YES/true, else NO.
      const pass = actualText == null ? null : ['YES', 'TRUE', '1', 'Y'].includes(actualText) === (target.toUpperCase() === 'YES') || actualText === target.toUpperCase();
      if (actualText == null) return { achievement: null, capped: false };
      return { achievement: pass ? 100 : 0, capped: false };
    }

    if (actualNum == null || Number.isNaN(actualNum)) return { achievement: null, capped: false };
    const target = kpi.targetValue == null ? null : Number(kpi.targetValue);

    if (target == null || Number.isNaN(target)) return { achievement: null, capped: false };

    if (direction === 'LOWER_IS_BETTER') {
      if (target <= 0) return { achievement: actualNum! <= 0 ? cap : 0, capped: actualNum! <= 0 };
      // Achieving less than the maximum allowed target scores proportionally above 100%.
      const raw = (target / actualNum!) * 100;
      const v = Math.min(cap, raw);
      return { achievement: round2(v), capped: raw > cap };
    }

    if (direction === 'TARGET_RANGE') {
      const min = kpi.minScore == null ? target : Number(kpi.minScore);
      if (actualNum! >= min && actualNum! <= target) return { achievement: 100, capped: false };
      if (actualNum! < min) {
        const raw = min <= 0 ? 0 : (actualNum! / min) * 100;
        const v = Math.min(100, Math.max(0, raw));
        return { achievement: round2(v), capped: false };
      }
      // above range: degrade gracefully below 100
      const raw = (target / actualNum!) * 100;
      return { achievement: round2(Math.min(100, raw)), capped: false };
    }

    // HIGHER_IS_BETTER (also used by rating scale: target e.g. 4 of 5)
    if (target <= 0) return { achievement: 0, capped: false };
    const raw = (actualNum! / target) * 100;
    const v = Math.min(cap, raw);
    return { achievement: round2(v), capped: raw > cap };
  }

  /** calculateWeightedScore — points = achievement% × weight% / 100 */
  calculateWeightedScore(achievement: number | null | undefined, weight: number | string | null | undefined): number | null {
    if (achievement == null) return null;
    return round4((Number(achievement) * Number(weight || 0)) / 100);
  }

  /** calculateOverallScore — Σ weighted points of assessed KPIs */
  calculateOverallScore(weighted: (number | null | undefined)[]): number {
    return round2(weighted.reduce((s: number, w) => s + (w || 0), 0));
  }

  /** resolvePassFail — assessment outcome against the template pass mark */
  resolvePassFail(overall: number | null | undefined, passMark: number | string): 'PASS' | 'FAIL' | null {
    if (overall == null) return null;
    return Number(overall) >= Number(passMark) ? 'PASS' : 'FAIL';
  }

  /** resolvePerformanceBand — configurable bands; falls back to company defaults */
  resolvePerformanceBand(overall: number | null | undefined, bands: { label: string; minScore: number | string; maxScore: number | string }[]): string | null {
    if (overall == null) return null;
    const score = Number(overall);
    for (const b of bands) {
      if (score >= Number(b.minScore) && score <= Number(b.maxScore)) return b.label;
    }
    // bands may have gaps — find closest upper band
    const sorted = [...bands].sort((a, b) => Number(a.minScore) - Number(b.minScore));
    for (const b of sorted) if (score <= Number(b.maxScore)) return b.label;
    return sorted.length ? sorted[sorted.length - 1].label : null;
  }

  /** effective KPI score: QA override > manager override > calculated achievement */
  effectiveScore(kpi: { achievement?: number | string | null; managerScore?: number | string | null; qaScore?: number | string | null }): number | null {
    if (kpi.qaScore != null) return Number(kpi.qaScore);
    if (kpi.managerScore != null) return Number(kpi.managerScore);
    if (kpi.achievement != null) return Number(kpi.achievement);
    return null;
  }

  /** kpi completion % = assessed KPIs / total KPIs (form completeness — NOT performance) */
  calculateCompletion(kpis: { effective: number | null }[]): number {
    if (!kpis.length) return 0;
    const assessed = kpis.filter((k) => k.effective != null).length;
    return round2((assessed / kpis.length) * 100);
  }
}
