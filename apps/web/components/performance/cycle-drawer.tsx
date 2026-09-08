'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { SoftBadge } from '@/components/crud-page';
import { fmtDate, fmtDateTime } from '@/lib/format';

const CYCLE_STATUS_FLOW = ['DRAFT', 'SCHEDULED', 'OPEN', 'EMPLOYEE_SUBMISSION', 'MANAGER_REVIEW', 'QA_REVIEW', 'CALIBRATION', 'APPROVAL', 'COMPLETED', 'LOCKED'];

export function CycleDrawer({ open, onClose, cycleId, onCreated }: { open: boolean; onClose: () => void; cycleId: string | null; onCreated?: (id: string) => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [assignment, setAssignment] = useState<any>(null);
  const isEdit = !!cycleId;
  const detail = useQuery({ queryKey: ['/performance/cycles', cycleId], queryFn: () => api(`/performance/cycles/${cycleId}`), enabled: open && isEdit });

  useEffect(() => {
    if (!open) return;
    if (isEdit && detail.data) {
      const c = detail.data;
      form.setFieldsValue({
        name: c.name, cycleType: c.cycleType, description: c.description,
        periodStart: c.periodStart, periodEnd: c.periodEnd, submissionOpens: c.submissionOpens,
        employeeDeadline: c.employeeDeadline, managerDeadline: c.managerDeadline, qaDeadline: c.qaDeadline, approvalDeadline: c.approvalDeadline,
        includeNewHires: c.includeNewHires, departmentIds: c.departments?.map((d: any) => d.id) || [],
      });
    } else if (!isEdit) { form.resetFields(); }
  }, [open, isEdit, detail.data]);

  async function save() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    setSaving(true);
    try {
      const payload = {
        ...v,
        periodStart: v.periodStart?.format('YYYY-MM-DD'), periodEnd: v.periodEnd?.format('YYYY-MM-DD'),
        submissionOpens: v.submissionOpens?.format('YYYY-MM-DD'), employeeDeadline: v.employeeDeadline?.format('YYYY-MM-DD'),
        managerDeadline: v.managerDeadline?.format('YYYY-MM-DD'), qaDeadline: v.qaDeadline?.format('YYYY-MM-DD') || null,
        approvalDeadline: v.approvalDeadline?.format('YYYY-MM-DD') || null, departmentIds: v.departmentIds || [],
      };
      if (isEdit) await api(`/performance/cycles/${cycleId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else {
        const created = await api('/performance/cycles', { method: 'POST', body: JSON.stringify(payload) });
        message.success('Performance cycle created as DRAFT'); onClose(); onCreated?.(created.id); qc.invalidateQueries({ queryKey: ['/performance/cycles'] }); return;
      }
      message.success('Cycle updated'); qc.invalidateQueries({ queryKey: ['/performance/cycles'] }); qc.invalidateQueries({ queryKey: ['/performance/cycles', cycleId] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function openCycle() {
    setSaving(true);
    try {
      const res = await api(`/performance/cycles/${cycleId}/open`, { method: 'POST' });
      setAssignment(res);
      qc.invalidateQueries({ queryKey: ['/performance/cycles'] }); qc.invalidateQueries({ queryKey: ['/performance/cycles', cycleId] });
      qc.invalidateQueries({ queryKey: ['/performance/dashboard'] });
    } catch (e: any) { message.error(e.message); } finally { setSaving(false); }
  }

  async function setCycleStatus(status: string) {
    try { await api(`/performance/cycles/${cycleId}/status`, { method: 'POST', body: JSON.stringify({ status }) }); message.success(`Cycle ${status.toLowerCase()}`); qc.invalidateQueries({ queryKey: ['/performance/cycles'] }); qc.invalidateQueries({ queryKey: ['/performance/cycles', cycleId] }); }
    catch (e: any) { message.error(e.message); }
  }

  const c = detail.data;
  const status = c?.status || 'DRAFT';

  return (
    <>
      <Drawer open={open} onClose={onClose} width="min(760px, 96vw)" title={isEdit ? `Performance Cycle — ${c?.name || ''}` : 'New Performance Cycle'} destroyOnHidden
        extra={<Space>
          <Button onClick={onClose}>Cancel</Button>
          {(!isEdit || ['DRAFT', 'SCHEDULED'].includes(status)) && <Button type="primary" loading={saving} onClick={save}>{isEdit ? 'Save' : 'Create cycle'}</Button>}
        </Space>}>
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item label="Cycle name" name="name" rules={[{ required: true }]} className="col-span-2"><Input placeholder="e.g. 2026 Q3 Performance" /></Form.Item>
            <Form.Item label="Cycle type" name="cycleType" initialValue="QUARTERLY" rules={[{ required: true }]}>
              <Select options={['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'PROBATION', 'CUSTOM'].map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} />
            </Form.Item>
            <Form.Item label="Include employees hired after cycle start?" name="includeNewHires" initialValue="NO" tooltip="'Prorated' adjusts KPI targets by the fraction of the period the employee was employed. Never automatic without configuration.">
              <Select options={[{ value: 'NO', label: 'No' }, { value: 'YES', label: 'Yes' }, { value: 'PRORATED', label: 'Yes — prorated targets' }]} />
            </Form.Item>
            <Form.Item label="Description" name="description" className="col-span-2"><Input.TextArea rows={2} /></Form.Item>
          </div>
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Performance period</div>
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item label="Period start" name="periodStart" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Period end" name="periodEnd" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
          </div>
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Submission windows</div>
          <div className="grid grid-cols-2 gap-x-4">
            <Form.Item label="Submission opens" name="submissionOpens" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Employee submission deadline" name="employeeDeadline" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Manager review deadline" name="managerDeadline" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="QA review deadline" name="qaDeadline"><DatePicker className="w-full" /></Form.Item>
            <Form.Item label="Final approval deadline" name="approvalDeadline"><DatePicker className="w-full" /></Form.Item>
          </div>
          <div className="text-[13px] font-semibold text-[#171a2e] mb-2">Scope</div>
          <Form.Item label="Departments (empty = all departments)" name="departmentIds">
            <Select mode="multiple" allowClear placeholder="All departments" options={(detail.data?.departments || []).map((d: any) => ({ label: `${d.name} (${d.branch?.name})`, value: d.id }))} />
          </Form.Item>
        </Form>

        {isEdit && c && (
          <div className="mt-5 border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-[#171a2e]">Lifecycle</span><SoftBadge tone={status === 'LOCKED' ? 'purple' : status === 'COMPLETED' ? 'green' : 'amber'} dotless>{status}</SoftBadge></div>
              <Can permission="performance.cycles.manage">
                <Space>
                  {['DRAFT', 'SCHEDULED'].includes(status) && <Button size="small" type="primary" onClick={openCycle}>Open — assign employees & snapshot KPIs</Button>}
                  {status === 'OPEN' && <Button size="small" onClick={() => setCycleStatus('COMPLETED')}>Mark completed</Button>}
                  {status === 'COMPLETED' && <Button size="small" danger onClick={() => setCycleStatus('LOCKED')}>Lock cycle</Button>}
                  {status === 'LOCKED' && <Button size="small" onClick={() => setCycleStatus('COMPLETED')}>Unlock</Button>}
                </Space>
              </Can>
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {CYCLE_STATUS_FLOW.map((s, i) => {
                const idx = CYCLE_STATUS_FLOW.indexOf(status);
                return <Tag key={s} color={i <= idx ? '#003366' : undefined} style={i > idx ? { color: '#94a3b8', borderColor: '#e6e9f2' } : {}}>{s.replace(/_/g, ' ')}</Tag>;
              })}
            </div>
            <div className="grid grid-cols-2 gap-x-6 text-[13px]">
              <Info label="Assessments" value={c._count?.assessments ?? c.assessments?.length ?? 0} />
              <Info label="Opened" value={c.openedAt ? fmtDateTime(c.openedAt) : '—'} />
              <Info label="Performance period" value={`${fmtDate(c.periodStart)} – ${fmtDate(c.periodEnd)}`} />
              <Info label="Employee deadline" value={fmtDate(c.employeeDeadline)} />
              <Info label="Manager deadline" value={fmtDate(c.managerDeadline)} />
              <Info label="QA deadline" value={fmtDate(c.qaDeadline)} />
              <Info label="Approval deadline" value={fmtDate(c.approvalDeadline)} />
            </div>
            <Can permission="performance.cycles.manage">
              <div className="mt-4">
                <Button size="small" type="primary" ghost onClick={async () => { try { const r = await api(`/performance/cycles/${cycleId}/run-incentive-eligibility`, { method: 'POST' }); message.success(`${r.proposed} incentive proposal(s) created${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`); qc.invalidateQueries(); } catch (e: any) { message.error(e.message); } }}>Run incentive eligibility</Button>
                <Button size="small" className="ml-2" onClick={async () => { try { const r = await api(`/performance/cycles/${cycleId}/remind-missing`, { method: 'POST' }); message.success(`${r.sent} reminder(s) sent`); } catch (e: any) { message.error(e.message); } }}>Remind missing submissions</Button>
              </div>
            </Can>
          </div>
        )}
      </Drawer>

      <Modal open={!!assignment} title="Cycle opened — employee assignment result" onCancel={() => { setAssignment(null); onClose(); }} footer={<Button type="primary" onClick={() => { setAssignment(null); onClose(); }}>Done</Button>} width={640}>
        <Alert type={assignment?.missing?.length ? 'warning' : 'success'} showIcon message={`${assignment?.created ?? 0} employee assessment(s) created with snapshotted KPIs`} description={assignment?.missing?.length ? `${assignment.missing.length} employee(s) could not be assigned — no active KPI template for their department/role. See the Needs Attention panel.` : 'All eligible employees were assigned.'} className="mb-4" />
        {!!assignment?.missing?.length && (
          <Table rowKey="employeeId" size="small" dataSource={assignment.missing} pagination={false} columns={[
            { title: 'Employee', dataIndex: 'name' }, { title: 'Employee #', dataIndex: 'employeeNo', width: 110 },
            { title: 'Department', dataIndex: 'department' },
          ]} />
        )}
      </Modal>
    </>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return <div className="flex justify-between border-b border-[#f0f1f6] py-1.5"><span className="text-[#64748b]">{label}</span><span className="font-medium text-[#171a2e]">{value}</span></div>;
}
