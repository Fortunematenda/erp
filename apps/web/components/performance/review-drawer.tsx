'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Table, Tabs, Tag, Tooltip, message } from 'antd';
import { CheckOutlined, SendOutlined, WarningOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { SoftBadge } from '@/components/crud-page';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';

const STATUS_TONE: Record<string, string> = { PENDING_EMPLOYEE: 'amber', PENDING_MANAGER: 'amber', PENDING_QA: 'amber', PENDING_CALIBRATION: 'amber', PENDING_APPROVAL: 'amber', APPROVED: 'green', COMPLETED: 'green', LOCKED: 'purple' };

export function ReviewDrawer({ open, onClose, assessmentId, mode }: { open: boolean; onClose: () => void; assessmentId: string | null; mode?: 'EMPLOYEE' | 'MANAGER' | 'QA' | 'VIEW' }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState('kpis');
  const [edit, setEdit] = useState<Record<string, any>>({});
  const [adjustModal, setAdjustModal] = useState<any>(null);
  const [adjustForm, setAdjustForm] = useState<{ score?: number; comment?: string; reason?: string }>({});
  const [calibModal, setCalibModal] = useState(false);
  const [calibForm, setCalibForm] = useState<{ score?: number; reason?: string }>({});
  const [busy, setBusy] = useState(false);

  const a = useQuery({ queryKey: ['/performance/assessments', assessmentId], queryFn: () => api(`/performance/assessments/${assessmentId}`), enabled: open && !!assessmentId });
  const audit = useQuery({ queryKey: ['/performance/assessments', assessmentId, 'audit'], queryFn: () => api(`/performance/assessments/${assessmentId}/audit`), enabled: open && !!assessmentId && tab === 'audit' });
  const bands = useQuery({ queryKey: ['/performance/bands'], queryFn: () => api('/performance/bands'), enabled: open });

  useEffect(() => { if (open) { setEdit({}); setTab('kpis'); } }, [open, assessmentId]);

  const d = a.data;
  const kpis = d?.kpis || [];
  const completion = kpis.length ? Math.round((kpis.filter((k: any) => k.effectiveScore != null).length / kpis.length) * 100) : 0;
  const effMode = mode || 'VIEW';

  const isLocked = d?.status === 'LOCKED';

  async function refresh() { await a.refetch(); qc.invalidateQueries({ queryKey: ['/performance/assessments'] }); }

  async function submitEmployee() {
    setBusy(true);
    try {
      await api(`/performance/assessments/${assessmentId}/employee-submit`, { method: 'POST', body: JSON.stringify({ kpis: Object.entries(edit).map(([kpiId, v]) => ({ kpiId, ...v })) }) });
      message.success('Self assessment submitted'); setEdit({}); await refresh();
    } catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  }

  async function submitManager() {
    setBusy(true);
    try {
      await api(`/performance/assessments/${assessmentId}/manager-review`, { method: 'POST', body: JSON.stringify({ kpis: Object.entries(edit).map(([kpiId, v]) => ({ kpiId, ...v })) }) });
      message.success('Manager review submitted'); setEdit({}); await refresh();
    } catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  }

  async function qaAction(action: 'qa-start' | 'qa-submit') {
    setBusy(true);
    try {
      if (action === 'qa-submit') await api(`/performance/assessments/${assessmentId}/qa-submit`, { method: 'POST', body: JSON.stringify({}) });
      else await api(`/performance/assessments/${assessmentId}/qa-start`, { method: 'POST' });
      message.success(action === 'qa-start' ? 'QA review started' : 'QA review submitted'); await refresh();
    } catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  }

  async function approve() {
    setBusy(true);
    try { await api(`/performance/assessments/${assessmentId}/approve`, { method: 'POST', body: JSON.stringify({}) }); message.success('Performance result approved'); await refresh(); }
    catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  }

  async function lock() { try { await api(`/performance/assessments/${assessmentId}/lock`, { method: 'POST' }); message.success('Assessment locked'); await refresh(); } catch (e: any) { message.error(e.message); } }
  async function reopen() { try { await api(`/performance/assessments/${assessmentId}/reopen`, { method: 'POST', body: JSON.stringify(calibForm) }); message.success('Assessment reopened for correction'); setCalibModal(false); setCalibForm({}); await refresh(); } catch (e: any) { message.error(e.message); } }
  async function remind() { try { await api(`/performance/assessments/${assessmentId}/remind`, { method: 'POST' }); message.success('Reminder sent to employee'); } catch (e: any) { message.error(e.message); } }
  async function sendAck() { try { await api(`/performance/assessments/${assessmentId}/send-acknowledgement`, { method: 'POST' }); message.success('Acknowledgement request sent'); await refresh(); } catch (e: any) { message.error(e.message); } }

  async function saveAdjust() {
    if (!adjustForm.reason?.trim()) { message.error('Reason is mandatory'); return; }
    setBusy(true);
    try {
      await api(`/performance/assessments/${assessmentId}/qa-adjust`, { method: 'POST', body: JSON.stringify({ kpiId: adjustModal.id, score: adjustForm.score, comment: adjustForm.comment, reason: adjustForm.reason }) });
      message.success('Adjustment saved and audited'); setAdjustModal(null); setAdjustForm({}); await refresh();
    } catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  }

  async function saveCalibration() {
    if (!calibForm.reason?.trim()) { message.error('Reason is mandatory for calibration'); return; }
    setBusy(true);
    try { await api(`/performance/assessments/${assessmentId}/calibrate`, { method: 'POST', body: JSON.stringify(calibForm) }); message.success('Calibration applied'); setCalibModal(false); setCalibForm({}); await refresh(); }
    catch (e: any) { message.error(e.message); } finally { setBusy(false); }
  }

  const cols: ColumnsType<any> = [
    { title: 'KPI', render: (_v, r) => (
      <div>
        <div className="font-medium text-[13px] text-[#171a2e] flex items-center gap-1.5">{r.name}{r.critical && <WarningOutlined className="text-[#dc2626]" title="Critical KPI" />}{r.dataSource && <Tooltip title="System-derived from the authoritative module"><span className="text-[#1d5fb5] cursor-help text-[11px]">ⓘ</span></Tooltip>}</div>
        <div className="text-[11px] text-[#94a3b8]">{r.code}{r.categoryLabel ? ` · ${r.categoryLabel}` : ''}</div>
      </div>
    ) },
    { title: 'Weight', width: 70, align: 'right', render: (_v, r) => `${Number(r.weight)}%` },
    { title: 'Target', width: 110, align: 'right', render: (_v, r) => r.targetText || (r.targetValue != null ? fmtTarget(r) : '—') },
    { title: 'Actual', width: 110, align: 'right', render: (_v, r) => {
      const e = edit[r.id] || {};
      const val = e.actual ?? (r.qaActual ?? r.managerActual ?? r.actualValue);
      if (r.measurementType === 'YES_NO') return e.actualText || r.actualText || (val != null ? (Number(val) === 1 || String(val).toUpperCase() === 'YES' ? 'Yes' : 'No') : '—');
      if (r.scoringMethod === 'MANUAL') return '—';
      if (effMode === 'EMPLOYEE' && !r.systemDerived && !isLocked) return <InputNumber size="small" value={val} onChange={(v) => setEdit((s) => ({ ...s, [r.id]: { ...s[r.id], actual: v } }))} />;
      return val != null ? (r.measurementType === 'CURRENCY' ? fmtMoney(val) : `${Number(val)}${r.unit ? ` ${r.unit}` : ''}`) : '—';
    } },
    { title: 'Achievement', width: 95, align: 'right', render: (_v, r) => r.achievement != null ? <span className={Number(r.achievement) >= Number(d?.version?.passMark ?? 70) ? 'text-[#16a34a] font-semibold' : 'text-[#dc2626] font-semibold'}>{Number(r.achievement)}%{r.capped && <Tooltip title="Capped by maximum achievement"><span className="text-[10px] text-[#b45309] ml-1">cap</span></Tooltip>}</span> : '—' },
    { title: 'Employee', width: 60, align: 'center', render: (_v, r) => r.employeeComment ? <Tooltip title={r.employeeComment}><span>💬</span></Tooltip> : '—' },
    { title: 'Manager', width: 95, align: 'right', render: (_v, r) => r.managerScore != null ? `${Number(r.managerScore)}%` : '—' },
    { title: 'QA', width: 95, align: 'right', render: (_v, r) => r.qaScore != null ? <span className="text-[#1d5fb5] font-semibold">{Number(r.qaScore)}%</span> : '—' },
    { title: 'Weighted', width: 90, align: 'right', render: (_v, r) => r.weightedScore != null ? <span className="font-semibold text-[#171a2e]">{Number(r.weightedScore).toFixed(2)}</span> : '—' },
    ...(effMode === 'QA' && !isLocked ? [{ title: 'Adjust', width: 80, align: 'right' as const, render: (_v: any, r: any) => <Button size="small" onClick={() => { setAdjustModal(r); setAdjustForm({ score: r.effectiveScore != null ? Number(r.effectiveScore) : undefined }); }}>Adjust</Button> }] : []),
  ];

  const overall = d?.totalScore != null ? Number(d.totalScore) : null;
  const bandColor = d?.band ? (bands.data || []).find((b: any) => b.label === d.band)?.color : null;

  return (
    <Drawer open={open} onClose={onClose} width="min(1060px, 97vw)" destroyOnHidden
      title={d ? (
        <div>
          <div className="text-[16px] font-bold text-[#171a2e]">{d.employee?.preferredName || `${d.employee?.firstName} ${d.employee?.lastName}`}</div>
          <div className="text-[12px] text-[#64748b] font-normal">{d.employee?.position || '—'} · {d.employee?.department?.name || '—'} · {d.cycle?.name} · {d.templateName} v{d.version?.version}</div>
          <div className="flex flex-wrap gap-2 mt-1.5 font-normal">
            <Space size={4}><span className="text-[11px] text-[#64748b]">Employee:</span><SoftBadge tone={d.employeeSubmittedAt ? 'green' : 'amber'} dotless>{d.employeeSubmittedAt ? 'SUBMITTED' : 'NOT SUBMITTED'}</SoftBadge></Space>
            <Space size={4}><span className="text-[11px] text-[#64748b]">Manager:</span><SoftBadge tone={d.managerSubmittedAt ? 'green' : 'amber'} dotless>{d.managerSubmittedAt ? 'SUBMITTED' : 'NOT SUBMITTED'}</SoftBadge></Space>
            <Space size={4}><span className="text-[11px] text-[#64748b]">QA:</span><SoftBadge tone={d.qaSubmittedAt ? 'green' : 'amber'} dotless>{d.qaSubmittedAt ? 'SUBMITTED' : 'IN PROGRESS'}</SoftBadge></Space>
          </div>
        </div>
      ) : 'Performance Assessment'}
      extra={d && (
        <Space wrap>
          {effMode === 'EMPLOYEE' && !d.employeeSubmittedAt && !isLocked && <Button size="small" type="primary" icon={<SendOutlined />} loading={busy} onClick={submitEmployee}>Submit self assessment</Button>}
          {effMode === 'MANAGER' && d.employeeSubmittedAt && !d.managerSubmittedAt && !isLocked && <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={submitManager}>Submit manager review</Button>}
          {effMode === 'QA' && !isLocked && !d.qaSubmittedAt && (
            d.qaReviews?.some((q: any) => q.reviewerId && q.status === 'IN_PROGRESS')
              ? <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => qaAction('qa-submit')}>Submit QA review</Button>
              : <Button size="small" loading={busy} onClick={() => qaAction('qa-start')}>Start QA review</Button>
          )}
          {effMode === 'QA' && !isLocked && <Button size="small" onClick={() => setCalibModal(true)}>Calibration</Button>}
          <Can permission="performance.approve">
            {d.status === 'PENDING_APPROVAL' && <Button size="small" type="primary" loading={busy} onClick={approve}>Approve result</Button>}
            {['APPROVED', 'COMPLETED'].includes(d.status) && <Button size="small" onClick={lock}>Lock</Button>}
            {d.status === 'LOCKED' && <Popconfirm title="Reopen this locked assessment?" description="A reason will be requested and audited." onConfirm={() => { setCalibForm({}); setCalibModal(true); }}><Button size="small" danger>Reopen</Button></Popconfirm>}
          </Can>
          {!d.employeeSubmittedAt && (effMode === 'MANAGER' || effMode === 'QA' || effMode === 'VIEW') && <Button size="small" icon={<SendOutlined />} onClick={remind}>Send Reminder</Button>}
          {['APPROVED', 'COMPLETED', 'LOCKED'].includes(d.status) && d.acknowledgementStatus !== 'ACKNOWLEDGED' && <Can permission="performance.cycles.manage"><Button size="small" onClick={sendAck}>Request acknowledgement</Button></Can>}
        </Space>
      )}>

      {d && (
        <>
          {/* Result card */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <div className="nex-card border rounded-lg p-4 text-center">
              <div className="text-[12px] font-semibold text-[#64748b]">Overall Score</div>
              <div className="text-[28px] font-bold text-[#171a2e] mt-1">{overall != null ? `${overall.toFixed(1)}%` : '—'}</div>
            </div>
            <div className="nex-card border rounded-lg p-4 text-center">
              <div className="text-[12px] font-semibold text-[#64748b]">Result</div>
              <div className="mt-2">{d.result ? <SoftBadge tone={d.result === 'PASS' ? 'green' : 'red'}>{d.result}</SoftBadge> : '—'}</div>
            </div>
            <div className="nex-card border rounded-lg p-4 text-center">
              <div className="text-[12px] font-semibold text-[#64748b]">Performance Band</div>
              <div className="text-[14px] font-bold mt-2" style={{ color: bandColor || '#171a2e' }}>{d.band || '—'}</div>
            </div>
            <div className="nex-card border rounded-lg p-4 text-center">
              <div className="text-[12px] font-semibold text-[#64748b]">KPI Completion</div>
              <Progress type="circle" size={52} percent={completion} className="mt-1" />
            </div>
          </div>
          {d.criticalNotMet && <div className="mb-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] text-[#b91c1c] text-[13px] px-4 py-2.5 flex items-center gap-2"><WarningOutlined /> Critical KPI Not Met — this result requires authorized HR review before final approval. It does not automatically change employment status.</div>}
          {d.prorationFactor != null && <div className="mb-4 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] text-[13px] px-4 py-2.5">Prorated eligibility: targets adjusted by factor {Number(d.prorationFactor).toFixed(2)} (employee joined during the period). Original targets shown.</div>}
          {d.employmentEndedDuring && <div className="mb-4 rounded-lg border border-[#fde68a] bg-[#fffbeb] text-[#b45309] text-[13px] px-4 py-2.5">Employment ended during the performance period — HR decision recorded.</div>}

          <Tabs activeKey={tab} onChange={setTab} items={[
            { key: 'kpis', label: 'KPI Assessment', children: (
              <>
                <Table rowKey="id" size="small" dataSource={kpis} columns={cols} pagination={false} expandable={{
                  expandedRowRender: (r: any) => <KpiExpand kpi={r} />,
                }} summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={7}><span className="font-bold text-[13px] text-[#171a2e]">Total Performance Score</span></Table.Summary.Cell>
                    <Table.Summary.Cell index={7} align="right" colSpan={2}><span className="font-bold text-[15px] text-[#171a2e]">{overall != null ? `${overall.toFixed(1)}%` : '—'}</span></Table.Summary.Cell>
                    <Table.Summary.Cell index={9} colSpan={effMode === 'QA' && !isLocked ? 2 : 1} />
                  </Table.Summary.Row>
                )} />
                <div className="text-[12px] text-[#94a3b8] mt-2">Weighted score = achievement % × weight. Achievement is capped by the template's maximum ({Number(d.version?.maxAchievement || 120)}%). Completion {completion}% is form completeness — not the performance score.</div>
              </>
            ) },
            { key: 'qa', label: 'Quality Assurance', children: (
              <div className="space-y-3">
                {(d.qaReviews || []).map((q: any) => (
                  <div key={q.id} className="border rounded-lg p-3">
                    <div className="flex justify-between items-center"><span className="text-[13px] font-medium">Reviewer #{q.reviewerId?.slice(0, 8)}</span><SoftBadge tone={q.status === 'SUBMITTED' ? 'green' : 'amber'} dotless>{q.status}</SoftBadge></div>
                    {q.comment && <div className="text-[13px] text-[#64748b] mt-1">{q.comment}</div>}
                    <div className="text-[12px] text-[#94a3b8] mt-1">Started {fmtDateTime(q.createdAt)}{q.submittedAt ? ` · Submitted ${fmtDateTime(q.submittedAt)}` : ''}</div>
                    {!!(q.adjustments as any[])?.length && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[12px] font-semibold text-[#171a2e]">Adjustments</div>
                        {(q.adjustments as any[]).map((adj: any, i: number) => (
                          <div key={i} className="text-[12px] bg-[#f8fafc] rounded px-2 py-1.5"><b>{adj.kpi}</b>: {adj.from ?? '—'} → {adj.to ?? '—'} — <i>{adj.reason}</i></div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!(d.qaReviews || []).length && <div className="text-[13px] text-[#94a3b8]">No QA review started yet.</div>}
              </div>
            ) },
            { key: 'incentive', label: 'Incentive', children: (
              d.incentive ? (
                <div className="border rounded-lg p-4 max-w-lg">
                  <div className="flex justify-between"><span className="text-[13px] text-[#64748b]">Reference</span><span className="font-mono font-semibold text-[#1d5fb5]">{d.incentive.reference}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-[13px] text-[#64748b]">Plan</span><span className="font-medium">{d.incentive.planName}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-[13px] text-[#64748b]">Score</span><span>{Number(d.incentive.finalScore).toFixed(1)}%</span></div>
                  <div className="flex justify-between mt-1"><span className="text-[13px] text-[#64748b]">Amount</span><span className="font-bold">{fmtMoney(d.incentive.amount)} {d.incentive.currency}</span></div>
                  <div className="flex justify-between mt-1"><span className="text-[13px] text-[#64748b]">Status</span><SoftBadge tone={d.incentive.status === 'PENDING_APPROVAL' ? 'amber' : 'green'} dotless>{d.incentive.status.replace(/_/g, ' ')}</SoftBadge></div>
                </div>
              ) : <div className="text-[13px] text-[#94a3b8]">No incentive proposed yet. Run incentive eligibility from the cycle after approval.</div>
            ) },
            { key: 'audit', label: 'Audit', children: (
              <Table rowKey="id" size="small" loading={audit.isLoading} dataSource={audit.data || []} pagination={{ pageSize: 10 }} columns={[
                { title: 'When', dataIndex: 'createdAt', width: 150, render: (v: any) => fmtDateTime(v) },
                { title: 'User', render: (_v: any, r: any) => r.user ? `${r.user.firstName} ${r.user.lastName}` : '—', width: 140 },
                { title: 'Action', dataIndex: 'action', width: 200, render: (v: any) => <Tag>{String(v).replace(/_/g, ' ')}</Tag> },
                { title: 'Details', render: (_v: any, r: any) => <code className="text-[11px] break-all">{JSON.stringify(r.metadata || r.reason || {})}</code> },
              ] as ColumnsType<any>} />
            ) },
          ]} />

          {/* Calibration modal (also used for reopen reason) */}
          <Modal open={calibModal} title={d?.status === 'LOCKED' ? 'Reopen assessment (correction flow)' : 'Calibration adjustment'} onCancel={() => setCalibModal(false)} onOk={d?.status === 'LOCKED' ? reopen : saveCalibration} okText={d?.status === 'LOCKED' ? 'Reopen' : 'Apply'} confirmLoading={busy} destroyOnHidden>
            <div className="space-y-3">
              {d?.status === 'LOCKED' ? (
                <div><label className="text-[13px] font-medium">Reason for reopening *</label><Input.TextArea rows={2} value={calibForm.reason} onChange={(e) => setCalibForm((s) => ({ ...s, reason: e.target.value }))} /></div>
              ) : (
                <>
                  <div><label className="text-[13px] font-medium">Calibrated overall score %</label><InputNumber className="w-full" min={0} max={200} value={calibForm.score} onChange={(v) => setCalibForm((s) => ({ ...s, score: v ?? undefined }))} /></div>
                  <div><label className="text-[13px] font-medium">Reason *</label><Input.TextArea rows={2} value={calibForm.reason} onChange={(e) => setCalibForm((s) => ({ ...s, reason: e.target.value }))} placeholder="Why is this score being adjusted during calibration?" /></div>
                  <div className="text-[12px] text-[#64748b]">Calibration adjustments are audited with before/after values. Current score: {overall != null ? `${overall.toFixed(1)}%` : '—'} · {d?.band || '—'}</div>
                </>
              )}
            </div>
          </Modal>

          {/* QA adjustment modal */}
          <Modal open={!!adjustModal} title={`QA adjustment — ${adjustModal?.name}`} onCancel={() => setAdjustModal(null)} onOk={saveAdjust} okText="Save adjustment" confirmLoading={busy} destroyOnHidden>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-[13px]">
                <div><div className="text-[#64748b] text-[12px]">Manager score</div>{adjustModal?.managerScore != null ? `${Number(adjustModal.managerScore)}%` : '—'}</div>
                <div><div className="text-[#64748b] text-[12px]">Current effective</div>{adjustModal?.effectiveScore != null ? `${Number(adjustModal.effectiveScore)}%` : '—'}</div>
                <div><div className="text-[#64748b] text-[12px]">Weight</div>{adjustModal ? `${Number(adjustModal.weight)}%` : '—'}</div>
              </div>
              <div><label className="text-[13px] font-medium">New QA score %</label><InputNumber className="w-full" min={0} max={200} value={adjustForm.score} onChange={(v) => setAdjustForm((s) => ({ ...s, score: v ?? undefined }))} /></div>
              <div><label className="text-[13px] font-medium">QA comment</label><Input.TextArea rows={2} value={adjustForm.comment} onChange={(e) => setAdjustForm((s) => ({ ...s, comment: e.target.value }))} /></div>
              <div><label className="text-[13px] font-medium">Reason *</label><Input.TextArea rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm((s) => ({ ...s, reason: e.target.value }))} placeholder="e.g. Supporting evidence did not cover two required quality checks." /></div>
              <div className="text-[12px] text-[#64748b]">Original score, new score, reason, user and timestamp are recorded in the audit trail.</div>
            </div>
          </Modal>
        </>
      )}
    </Drawer>
  );
}

function fmtTarget(kpi: any) {
  const v = Number(kpi.targetValue);
  if (kpi.measurementType === 'CURRENCY') return fmtMoney(v);
  return `${v}${kpi.unit ? ` ${kpi.unit}` : ''}`;
}

function KpiExpand({ kpi }: { kpi: any }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-2 bg-[#fafbfe] rounded-lg p-4 text-[13px]">
      <div><span className="text-[#64748b]">Description: </span>{kpi.description}</div>
      <div><span className="text-[#64748b]">Measurement source: </span>{kpi.dataSourceLabel || kpi.dataSource || 'Manual assessment'}</div>
      <div><span className="text-[#64748b]">Calculation: </span>{kpi.achievement != null && kpi.targetValue != null ? `${Number(kpi.actualValue ?? kpi.managerActual ?? kpi.qaActual ?? 0)} ÷ ${Number(kpi.targetValue)} = ${Number(kpi.achievement)}%` : (kpi.scoringMethod === 'MANUAL' ? 'Reviewer-entered score' : kpi.measurementType === 'YES_NO' ? 'Yes/No binary' : '—')}</div>
      <div><span className="text-[#64748b]">Direction: </span>{kpi.direction.replace(/_/g, ' ').toLowerCase()}</div>
      <div className="col-span-2"><span className="text-[#64748b]">Employee comment: </span>{kpi.employeeComment || '—'}{kpi.employeeEvidence ? <span className="ml-2 inline-block text-[11px] px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#1d5fb5]">📎 Evidence</span> : null}</div>
      <div className="col-span-2"><span className="text-[#64748b]">Manager comment: </span>{kpi.managerComment || '—'}</div>
      <div className="col-span-2"><span className="text-[#64748b]">QA comment: </span>{kpi.qaComment || '—'}</div>
      {kpi.auditNotes && <div className="col-span-2"><span className="text-[#64748b]">Audit notes: </span>{kpi.auditNotes}</div>}
    </div>
  );
}
