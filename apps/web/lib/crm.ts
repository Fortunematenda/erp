export type StageDef = {
  code: string;
  label: string;
  position: number;
  probability: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
};

export const CRM_STAGES: StageDef[] = [
  { code: 'NEW', label: 'New', position: 0, probability: 10, color: '#003366', isWon: false, isLost: false },
  { code: 'CONTACTED', label: 'Contacted', position: 1, probability: 20, color: '#2563eb', isWon: false, isLost: false },
  { code: 'QUALIFIED', label: 'Qualified', position: 2, probability: 40, color: '#0ea5e9', isWon: false, isLost: false },
  { code: 'OPPORTUNITY', label: 'Opportunity', position: 3, probability: 50, color: '#6366f1', isWon: false, isLost: false },
  { code: 'PROPOSAL', label: 'Proposal', position: 4, probability: 65, color: '#f59e0b', isWon: false, isLost: false },
  { code: 'NEGOTIATION', label: 'Negotiation', position: 5, probability: 80, color: '#8b5cf6', isWon: false, isLost: false },
  { code: 'WON', label: 'Won', position: 6, probability: 100, color: '#10b981', isWon: true, isLost: false },
  { code: 'LOST', label: 'Lost', position: 7, probability: 0, color: '#ef4444', isWon: false, isLost: true },
];

export function stageDef(code: string): StageDef {
  return CRM_STAGES.find((s) => s.code === code) || CRM_STAGES[0];
}

export const LEAD_SOURCES = [
  'Website',
  'Referral',
  'Walk-in',
  'Phone',
  'Email',
  'Partner',
  'Social Media',
  'Event',
  'Advertisement',
  'Other',
];

export const LEAD_PRIORITY: Record<string, { label: string; color: string }> = {
  LOW: { label: 'Low', color: 'default' },
  NORMAL: { label: 'Normal', color: 'blue' },
  HIGH: { label: 'High', color: 'orange' },
  URGENT: { label: 'Urgent', color: 'red' },
};

export const LOST_REASONS = [
  'Price',
  'Competitor',
  'No budget',
  'Timing',
  'No decision',
  'Product fit',
  'Other',
];
