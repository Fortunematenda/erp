export const KPI_MEASUREMENT_TYPES = [
  'NUMBER',
  'PERCENTAGE',
  'CURRENCY',
  'COUNT',
  'DAYS',
  'HOURS',
  'RATING_SCALE',
  'YES_NO',
  'MANUAL_SCORE',
  'SYSTEM_METRIC',
] as const;

export const KPI_DIRECTIONS = ['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TARGET_RANGE', 'PASS_FAIL'] as const;

export const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;

export const CYCLE_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'OPEN',
  'EMPLOYEE_SUBMISSION',
  'MANAGER_REVIEW',
  'QA_REVIEW',
  'CALIBRATION',
  'APPROVAL',
  'COMPLETED',
  'LOCKED',
] as const;

export const CYCLE_TYPES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'PROBATION', 'CUSTOM'] as const;

export const ASSESSMENT_STATUSES = [
  'PENDING_EMPLOYEE',
  'PENDING_MANAGER',
  'PENDING_QA',
  'PENDING_CALIBRATION',
  'PENDING_APPROVAL',
  'APPROVED',
  'COMPLETED',
  'LOCKED',
] as const;

export const SUBMISSION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'OVERDUE'] as const;

// System data sources — authoritative modules are queried, never duplicated.
export const KPI_DATA_SOURCES: { key: string; label: string; module: string; tooltip: string }[] = [
  { key: 'SALES_POSTED', label: 'Sales → Posted Sales', module: 'Sales', tooltip: 'Automatically totals posted sales invoice amounts assigned to this employee (by salesperson name) during the selected performance period. Draft and void invoices are excluded.' },
  { key: 'SALES_COLLECTED', label: 'Sales → Collected Revenue', module: 'Sales', tooltip: 'Automatically totals payments received on this employee\'s posted invoices during the performance period.' },
  { key: 'SALES_NEW_CUSTOMERS', label: 'Sales → New Customers', module: 'Sales', tooltip: 'Counts customers created during the period whose first posted invoice is assigned to this employee.' },
  { key: 'CRM_WON_OPPORTUNITIES', label: 'CRM → Won Opportunities', module: 'CRM', tooltip: 'Counts opportunities moved to Won during the period that are assigned to this employee.' },
  { key: 'CRM_WON_VALUE', label: 'CRM → Won Opportunity Value', module: 'CRM', tooltip: 'Totals the won opportunity value assigned to this employee during the period.' },
  { key: 'ATTENDANCE_PCT', label: 'Attendance → Attendance %', module: 'Attendance', tooltip: 'Automatically computes present days ÷ expected working days (excluding weekends and holidays) for this employee during the period.' },
  { key: 'ATTENDANCE_LATE', label: 'Attendance → Late Arrivals', module: 'Attendance', tooltip: 'Counts attendance records with a late arrival during the period. Lower is better.' },
  { key: 'ATTENDANCE_ABSENCE', label: 'Attendance → Absence Days', module: 'Attendance', tooltip: 'Counts unapproved absence days during the period. Lower is better.' },
  { key: 'ATTENDANCE_OVERTIME', label: 'Attendance → Approved Overtime', module: 'Attendance', tooltip: 'Totals approved overtime hours recorded during the period.' },
  { key: 'QA_AVERAGE_SCORE', label: 'Quality Assurance → Average QA Score', module: 'Quality Assurance', tooltip: 'Averages the employee\'s QA assessment scores (HR → QA assessments) recorded during the period.' },
  { key: 'QA_FAILED_REVIEWS', label: 'Quality Assurance → Failed QA Reviews', module: 'Quality Assurance', tooltip: 'Counts QA assessments scored below their template pass threshold during the period. Lower is better.' },
  { key: 'PROJECTS_TASKS_COMPLETED', label: 'Projects → Tasks Completed', module: 'Projects', tooltip: 'Counts project tasks assigned to this employee and completed during the period.' },
];

export function dataSourceTooltip(key?: string | null): string | null {
  if (!key) return null;
  return KPI_DATA_SOURCES.find((d) => d.key === key)?.tooltip || null;
}

export const DEFAULT_BANDS = [
  { label: 'Unsatisfactory', minScore: 0, maxScore: 49.99, color: '#dc2626', position: 1 },
  { label: 'Needs Improvement', minScore: 50, maxScore: 69.99, color: '#f59e0b', position: 2 },
  { label: 'Meets Expectations', minScore: 70, maxScore: 79.99, color: '#0ea5e9', position: 3 },
  { label: 'Exceeds Expectations', minScore: 80, maxScore: 89.99, color: '#16a34a', position: 4 },
  { label: 'Outstanding', minScore: 90, maxScore: 200, color: '#003366', position: 5 },
];

export const round2 = (n: number) => Number((Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2));
export const round4 = (n: number) => Number((Math.round((Number(n) + Number.EPSILON) * 10000) / 10000).toFixed(4));

// Money-safe addition: accumulate in integer cents to avoid float drift.
export function sumMoney(values: any[]): number {
  let cents = 0;
  for (const v of values) {
    const n = Number(v || 0);
    cents += Math.round(n * 100);
  }
  return cents / 100;
}
