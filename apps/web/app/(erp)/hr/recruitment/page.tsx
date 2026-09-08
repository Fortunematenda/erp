'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import {
  AppstoreOutlined, CalendarOutlined, CheckCircleOutlined, DollarOutlined,
  PlusOutlined, ReloadOutlined, RiseOutlined, TeamOutlined, UserOutlined,
  FireOutlined, ClockCircleOutlined, SendOutlined,
} from '@ant-design/icons';
import { Button, DatePicker, Drawer, Form, Input, InputNumber, message, Modal, Select, Space, Table, Tabs, Tag, Timeline, Col, Row } from 'antd';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { Can } from '@/components/Can';
import { EmptyState, StatusPill, DetailItem } from '@/components/sales-ui';
import { StatCard } from '@/components/stat-card';
import { EmployeeSelector } from '@/components/employee-selector';
import { fmtDate, fmtMoney, fmtDateTime } from '@/lib/format';

const { TextArea } = Input;

const PIPELINE = [
  { code: 'APPLIED', label: 'Applied', color: '#1d5fb5' },
  { code: 'SCREENING', label: 'Screening', color: '#2563eb' },
  { code: 'SHORTLISTED', label: 'Shortlisted', color: '#0891b2' },
  { code: 'INTERVIEW', label: 'Interview', color: '#7c3aed' },
  { code: 'ASSESSMENT', label: 'Assessment', color: '#ea580c' },
  { code: 'OFFER', label: 'Offer', color: '#8b5cf6' },
  { code: 'HIRED', label: 'Hired', color: '#16a34a' },
  { code: 'REJECTED', label: 'Rejected', color: '#64748b' },
];
const stageMeta = (code: string) => PIPELINE.find((s) => s.code === code) || { code, label: code.replace(/_/g, ' '), color: '#64748b' };

const REQ_STATUS_COLORS: Record<string, string> = { DRAFT: 'default', SUBMITTED: 'blue', PENDING_APPROVAL: 'orange', APPROVED: 'green', REJECTED: 'red', CANCELLED: 'default', FILLED: 'green' };
const VAC_STATUS_COLORS: Record<string, string> = { DRAFT: 'default', PENDING_APPROVAL: 'orange', OPEN: 'green', ON_HOLD: 'orange', CLOSED: 'default', FILLED: 'green', CANCELLED: 'default' };
const OFFER_STATUS_COLORS: Record<string, string> = { DRAFT: 'default', PENDING_APPROVAL: 'orange', APPROVED: 'blue', SENT: 'geekblue', VIEWED: 'cyan', ACCEPTED: 'green', DECLINED: 'red', EXPIRED: 'default', WITHDRAWN: 'default' };
const REQ_REASONS = ['New Position', 'Replacement', 'Expansion', 'Project Requirement', 'Temporary Cover', 'Seasonal', 'Other'];
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP'];
const CANDIDATE_SOURCES = ['Careers Page', 'LinkedIn', 'Employee Referral', 'Agency', 'Direct Application', 'Recruiter Sourced', 'Internal Candidate', 'Other'];

const statusTag = (status?: string, colors?: Record<string, string>) => <StatusPill status={status || '—'} tone={colors?.[status || '']} />;

// ---------- helper to fetch base data ----------
function useDepAndEmps() {
  const departments = useQuery({ queryKey: ['/hr/departments'], queryFn: () => api('/hr/departments') });
  const branches = useQuery({ queryKey: ['/companies/branches'], queryFn: () => api('/companies/branches') });
  return { departments, branches };
}

// ---- Requisition Drawer ----
function RequisitionDrawer({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
  const [form] = Form.useForm();
  const { departments } = useDepAndEmps();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, targetStartDate: editing.targetStartDate ? dayjs(editing.targetStartDate) : undefined, openings: editing.openings || 1, salaryMin: editing.salaryMin ? Number(editing.salaryMin) : undefined, salaryMax: editing.salaryMax ? Number(editing.salaryMax) : undefined, priority: editing.priority || 'NORMAL' });
    else form.resetFields();
  }, [open, editing]);
  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const payload = { ...v, openings: Number(v.openings || 1), targetStartDate: v.targetStartDate?.format('YYYY-MM-DD'), salaryMin: Number(v.salaryMin || 0), salaryMax: Number(v.salaryMax || 0), requiredSkills: Array.isArray(v.requiredSkills) ? v.requiredSkills : undefined };
    try {
      if (editing) await api(`/hr/recruitment/requisitions/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/hr/recruitment/requisitions', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Requisition updated' : 'Requisition created (DRAFT)'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={820} title={editing ? `Edit requisition ${editing.requisitionNo || ''}` : 'New hiring requisition'} destroyOnHidden
      extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit}>{editing ? 'Save changes' : 'Create requisition'}</Button></Space>}>
      <Form form={form} layout="vertical" className="mt-2">
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mb-2 font-semibold">Role</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Position / Job title" name="position" rules={[{ required: true }]}><Input placeholder="e.g. Network Technician" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Department" name="departmentId"><Select allowClear placeholder="Select department" options={(departments.data || []).map((d: any) => ({ label: d.name, value: d.id }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Number of positions" name="openings" initialValue={1} rules={[{ required: true }]}><InputNumber min={1} className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Employment type" name="employmentType" initialValue="FULL_TIME"><Select options={EMPLOYMENT_TYPES.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Hiring manager" name="hiringManagerId"><EmployeeSelector placeholder="Select hiring manager" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Requested by" name="requestedById"><EmployeeSelector placeholder="Select requester" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Reason for hire" name="reason" initialValue="New Position"><Select allowClear options={REQ_REASONS.map((r) => ({ label: r, value: r }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Priority" name="priority" initialValue="NORMAL"><Select options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ label: p, value: p }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Target start date" name="targetStartDate"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Cost centre" name="costCentre"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Salary min" name="salaryMin"><InputNumber prefix="$" className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Salary max" name="salaryMax"><InputNumber prefix="$" className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Currency" name="currency" initialValue="USD"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Project (if applicable)" name="projectId"><Input placeholder="Project id" /></Form.Item></Col>
        </Row>
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Requirements</div>
        <Form.Item label="Job description" name="jobDescription"><TextArea rows={3} /></Form.Item>
        <Form.Item label="Required skills (add then press Enter)" name="requiredSkills"><Select mode="tags" placeholder="Type a skill and press Enter" /></Form.Item>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Qualifications" name="qualifications"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Experience (years)" name="experienceYears"><InputNumber min={0} className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item label="Notes" name="notes"><TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}

// ---- Vacancy Drawer ----
function VacancyDrawer({ open, onClose, onSaved, editing, requisitionId, preset }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null; requisitionId?: string; preset?: any }) {
  const [form] = Form.useForm();
  const { departments } = useDepAndEmps();
  useEffect(() => {
    if (!open) return;
    const src = editing || preset || {};
    if (editing || preset) form.setFieldsValue({ ...src, title: src.title || src.position, jobTitle: src.jobTitle || src.position, departmentId: src.departmentId, location: src.location, openings: src.openings || 1, employmentType: src.employmentType || 'FULL_TIME', targetStartDate: src.targetStartDate ? dayjs(src.targetStartDate) : undefined, closingDate: src.closingDate ? dayjs(src.closingDate) : undefined, salaryMin: src.salaryMin ? Number(src.salaryMin) : undefined, salaryMax: src.salaryMax ? Number(src.salaryMax) : undefined, requiredSkills: src.requiredSkills || [], });
    else form.resetFields();
  }, [open, editing, preset]);
  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const payload = { ...v, requisitionId: v.requisitionId || requisitionId, openings: Number(v.openings || 1), targetStartDate: v.targetStartDate?.format('YYYY-MM-DD'), closingDate: v.closingDate?.format('YYYY-MM-DD'), salaryMin: Number(v.salaryMin || 0), salaryMax: Number(v.salaryMax || 0), requiredSkills: v.requiredSkills || [], responsibilities: v.responsibilities || [], preferredSkills: v.preferredSkills || [] };
    try {
      if (editing) await api(`/hr/recruitment/vacancies/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/hr/recruitment/vacancies', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Vacancy updated' : 'Vacancy created (OPEN)'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={860} title={editing ? `Edit vacancy ${editing.vacancyNo || ''}` : 'New vacancy'} destroyOnHidden
      extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit}>{editing ? 'Save changes' : 'Publish vacancy'}</Button></Space>}>
      <Form form={form} layout="vertical" className="mt-2">
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mb-2 font-semibold">Position</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Vacancy title" name="title" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Job title" name="jobTitle"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Requisition" name="requisitionId"><Input disabled={!!requisitionId} placeholder="REQ number" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Department" name="departmentId"><Select allowClear options={(departments.data || []).map((d: any) => ({ label: d.name, value: d.id }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Location" name="location"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Number of openings" name="openings" initialValue={1}><InputNumber min={1} className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Hiring manager" name="hiringManagerId"><EmployeeSelector /></Form.Item></Col>
          <Col span={12}><Form.Item label="Recruiter" name="recruiterId"><EmployeeSelector /></Form.Item></Col>
          <Col span={12}><Form.Item label="Employment type" name="employmentType" initialValue="FULL_TIME"><Select options={EMPLOYMENT_TYPES.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Priority" name="priority" initialValue="NORMAL"><Select options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ label: p, value: p }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Target start date" name="targetStartDate"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Closing date" name="closingDate"><DatePicker className="w-full" /></Form.Item></Col>
        </Row>
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Job details</div>
        <Form.Item label="Job summary" name="jobSummary"><TextArea rows={2} /></Form.Item>
        <Form.Item label="Responsibilities (add then press Enter)" name="responsibilities"><Select mode="tags" placeholder="Type then press Enter" /></Form.Item>
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Requirements</div>
        <Form.Item label="Required skills (add then press Enter)" name="requiredSkills"><Select mode="tags" placeholder="e.g. MikroTik" /></Form.Item>
        <Form.Item label="Preferred skills (add then press Enter)" name="preferredSkills"><Select mode="tags" /></Form.Item>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Qualifications" name="qualifications"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Experience (years)" name="experienceYears"><InputNumber min={0} className="w-full" /></Form.Item></Col>
        </Row>
        <Form.Item label="Working conditions" name="workingConditions"><Input /></Form.Item>
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Compensation</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Salary min" name="salaryMin"><InputNumber prefix="$" className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Salary max" name="salaryMax"><InputNumber prefix="$" className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Currency" name="currency" initialValue="USD"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Pay frequency" name="payFrequency" initialValue="MONTHLY"><Select options={['DAILY', 'WEEKLY', 'MONTHLY', 'ANNUAL'].map((f) => ({ label: f, value: f }))} /></Form.Item></Col>
        </Row>
        <Form.Item label="Posting" name="internalOnly" valuePropName="checked" className="col-span-2"><input type="checkbox" className="accent-[#003366] mr-2" />Internal-only posting</Form.Item>
      </Form>
    </Drawer>
  );
}

// ---- Candidate Drawer ----
function CandidateDrawer({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, expectedCompensation: editing.expectedCompensation ? Number(editing.expectedCompensation) : undefined, skills: editing.skills || [], languages: editing.languages || [], certifications: editing.certifications || [] });
    else form.resetFields();
  }, [open, editing]);
  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const payload = { ...v, firstName: v.firstName, lastName: v.lastName, yearsExperience: Number(v.yearsExperience || 0), expectedCompensation: Number(v.expectedCompensation || 0), skills: v.skills || [], languages: v.languages || [], certifications: v.certifications || [], education: v.education || [], experience: v.experience || [] };
    try {
      if (editing) await api(`/hr/recruitment/candidates/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/hr/recruitment/candidates', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Candidate updated' : 'Candidate created'); onClose(); onSaved();
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open={open} onClose={onClose} width={840} title={editing ? `Edit ${editing.name}` : 'New candidate'} destroyOnHidden
      extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit}>{editing ? 'Save changes' : 'Create candidate'}</Button></Space>}>
      <Form form={form} layout="vertical" className="mt-2">
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mb-2 font-semibold">Contact</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="First name" name="firstName" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Last name" name="lastName" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Email" name="email" rules={[{ type: 'email' }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Mobile" name="mobile"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Location" name="location"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Availability" name="availability"><Input placeholder="e.g. 2 weeks" /></Form.Item></Col>
        </Row>
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Professional</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Current position" name="currentPosition"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Current employer" name="currentEmployer"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Years experience" name="yearsExperience"><InputNumber min={0} className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Notice period" name="noticePeriod"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Expected compensation" name="expectedCompensation"><InputNumber prefix="$" className="w-full" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Currency" name="currency" initialValue="USD"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Source" name="source" initialValue="Careers Page"><Select allowClear options={CANDIDATE_SOURCES.map((s) => ({ label: s, value: s }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Portfolio / links" name="portfolio"><Input /></Form.Item></Col>
        </Row>
        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Skills & education</div>
        <Form.Item label="Skills (add then press Enter)" name="skills"><Select mode="tags" placeholder="e.g. MikroTik, Networking" /></Form.Item>
        <Form.Item label="Languages (add then press Enter)" name="languages"><Select mode="tags" /></Form.Item>
        <Form.Item label="Certifications (add then press Enter)" name="certifications"><Select mode="tags" /></Form.Item>
        <Form.Item label="Education (JSON per line: qualification | institution | year)" name="education"><TextArea rows={2} placeholder="Network Technician | City & Guilds | 2020" /></Form.Item>
        <Form.Item label="Experience (JSON per line: employer | role | start | end)" name="experience"><TextArea rows={3} placeholder="Acme ISP | Network Engineer | Jan 2021 | Present" /></Form.Item>
        <Form.Item label="Notes" name="notes"><TextArea rows={2} /></Form.Item>
      </Form>
    </Drawer>
  );
}

// ---- Application Drawer (detail) ----
function ApplicationDrawer({ app, onClose, onSaved }: { app: any | null; onClose: () => void; onSaved: () => void }) {
  async function doAction(a: string, extra?: any) {
    if (!app) return;
    try {
      if (a === 'stage') await api(`/hr/recruitment/applications/${app.id}/stage`, { method: 'POST', body: JSON.stringify({ stage: extra.stage, comment: extra.comment }) });
      else if (a === 'reject') await api(`/hr/recruitment/applications/${app.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: extra.reason, notes: extra.notes }) });
      else if (a === 'withdraw') await api(`/hr/recruitment/applications/${app.id}/withdraw`, { method: 'POST', body: JSON.stringify({ reason: extra.reason }) });
      message.success('Application updated'); onSaved();
    } catch (e: any) { message.error(e.message); }
  }
  return (
    <Drawer open={!!app} onClose={onClose} width={760} title={`Application ${app?.applicationNo || ''}`} destroyOnHidden
      extra={<Button onClick={onClose}>Close</Button>}>
      {app && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-[15px] shrink-0" style={{ background: 'linear-gradient(135deg,#003366,#1d5fb5)' }}>{(app.candidate?.name || '?').charAt(0)}</div>
            <div>
              <div className="text-[16px] font-semibold text-[#171a2e]">{app.candidate?.name}</div>
              <div className="text-[12px] text-[#64748b]">{app.vacancy?.title} · {fmtDate(app.appliedAt)}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag color={stageMeta(app.stage).color}>{app.stage}</Tag>
            <Tag color={app.status === 'ACTIVE' ? 'green' : app.status === 'HIRED' ? 'green' : app.status === 'WITHDRAWN' ? 'default' : 'red'}>{app.status}</Tag>
          </div>
          <Row gutter={16}>
            <Col span={8}><DetailItem label="Candidate" value={app.candidate?.name} /></Col>
            <Col span={8}><DetailItem label="Vacancy" value={app.vacancy?.title} /></Col>
            <Col span={8}><DetailItem label="Source" value={app.source} /></Col>
          </Row>
          <div className="border rounded-lg overflow-hidden">
            <div className="text-[12px] font-semibold text-[#64748b] px-3 py-2 bg-[#f8fafc] border-b">Stage history</div>
            <Timeline className="p-4" items={(app.stageHistory || []).map((h: any) => ({
              color: stageMeta(h.toStage).color,
              children: <div className="text-[13px]"><span className="font-semibold text-[#171a2e]">{stageMeta(h.toStage).label}</span> <span className="text-[#94a3b8]">· {fmtDateTime(h.at)}</span>{h.comment ? <div className="text-[12px] text-[#64748b] mt-0.5">{h.comment}</div> : null}</div>,
            }))} />
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-[12px] font-semibold text-[#64748b] mb-2">Move stage</div>
            <div className="flex flex-wrap gap-2">
              {PIPELINE.map((s) => (
                <Button key={s.code} size="small" disabled={app.stage === s.code} style={app.stage === s.code ? { background: s.color, color: '#fff' } : {}} onClick={() => doAction('stage', { stage: s.code })}>{s.label}</Button>
              ))}
            </div>
            {canReject(app) && <Button size="small" danger className="mt-3" onClick={() => doAction('reject', { reason: 'Position filled' })}>Reject application</Button>}
          </div>
        </div>
      )}
    </Drawer>
  );
}
function canReject(app: any) { return app && app.status !== 'HIRED' && app.status !== 'REJECTED' && app.status !== 'WITHDRAWN'; }

export default function RecruitmentPage() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ['recruit', 'dashboard'], queryFn: () => api('/hr/recruitment/dashboard') });
  const requisitions = useQuery({ queryKey: ['recruit', 'requisitions'], queryFn: () => api('/hr/recruitment/requisitions') });
  const vacancies = useQuery({ queryKey: ['recruit', 'vacancies'], queryFn: () => api('/hr/recruitment/vacancies') });
  const candidates = useQuery({ queryKey: ['recruit', 'candidates'], queryFn: () => api('/hr/recruitment/candidates') });
  const applications = useQuery({ queryKey: ['recruit', 'applications'], queryFn: () => api('/hr/recruitment/applications') });
  const offers = useQuery({ queryKey: ['recruit', 'offers'], queryFn: () => api('/hr/recruitment/offers') });

  const [tab, setTab] = useState('dashboard');
  const [reqDrawer, setReqDrawer] = useState(false);
  const [editingReq, setEditingReq] = useState<any>(null);
  const [vacDrawer, setVacDrawer] = useState(false);
  const [editingVac, setEditingVac] = useState<any>(null);
  const [presetVac, setPresetVac] = useState<any>(null);
  const [candDrawer, setCandDrawer] = useState(false);
  const [editingCand, setEditingCand] = useState<any>(null);
  const [selApp, setSelApp] = useState<any>(null);
  const [stageFilter, setStageFilter] = useState('');

  function refresh() {
    ['dashboard', 'requisitions', 'vacancies', 'candidates', 'applications', 'offers', 'interviews'].forEach((k) => qc.invalidateQueries({ queryKey: ['recruit', k] }));
  }
  function openPresetVac(requisitionId: string, p: any) { setEditingVac(null); setPresetVac({ ...p, requisitionId }); setVacDrawer(true); }

  // tables
  const reqCols: ColumnsType<any> = [
    { title: 'Requisition #', dataIndex: 'requisitionNo', width: 150, render: (v) => <span className="font-medium text-[#171a2e]">{v}</span> },
    { title: 'Position', dataIndex: 'position', render: (v) => <span className="text-[13px]">{v}</span> },
    { title: 'Department', width: 140, render: (_, r) => r.department?.name },
    { title: 'Openings', dataIndex: 'openings', width: 90 },
    { title: 'Hiring manager', width: 150, render: (_, r) => r.hiredManager?.name },
    { title: 'Status', dataIndex: 'status', width: 140, render: (v) => statusTag(v, REQ_STATUS_COLORS) },
    { title: 'Created', dataIndex: 'createdAt', width: 120, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtDate(v)}</span> },
    { title: 'Actions', width: 220, align: 'right', render: (_, r: any) => (
      <div className="flex gap-1 justify-end">
        {r.status === 'DRAFT' && <Button size="small" onClick={() => api(`/hr/recruitment/requisitions/${r.id}/submit`, { method: 'POST' }).then(() => { message.success('Submitted'); refresh(); }).catch((e) => message.error(e.message))}>Submit</Button>}
        {['SUBMITTED', 'PENDING_APPROVAL'].includes(r.status) && <Can permission="recruitment.requisitions.approve"><><Button size="small" type="primary" onClick={() => api(`/hr/recruitment/requisitions/${r.id}/approve`, { method: 'POST' }).then(() => { message.success('Approved'); refresh(); }).catch((e) => message.error(e.message))}>Approve</Button><Button size="small" danger onClick={() => api(`/hr/recruitment/requisitions/${r.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'Not approved' }) }).then(() => { message.success('Rejected'); refresh(); }).catch((e) => message.error(e.message))}>Reject</Button></></Can>}
        {r.status === 'APPROVED' && <Button size="small" onClick={() => openPresetVac(r.id, { position: r.position, departmentId: r.departmentId, openings: r.openings, employmentType: r.employmentType, location: r.branchId && undefined })}>Create vacancy</Button>}
        <Button size="small" onClick={() => { setEditingReq(r); setReqDrawer(true); }}>Edit</Button>
      </div>
    ) },
  ];

  const vacCols: ColumnsType<any> = [
    { title: 'Vacancy #', dataIndex: 'vacancyNo', width: 110, render: (v) => <span className="font-medium text-[#171a2e]">{v}</span> },
    { title: 'Position', dataIndex: 'title', render: (v) => <span className="text-[13px] font-medium text-[#171a2e]">{v}</span> },
    { title: 'Department', width: 130, render: (_, r) => r.department?.name },
    { title: 'Manager', width: 130, render: (_, r) => r.hiringManager?.name },
    { title: 'Openings', dataIndex: 'openings', width: 80 },
    { title: 'Applicants', width: 90, render: (_, r) => r._count?.applications || 0 },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => statusTag(v, VAC_STATUS_COLORS) },
    { title: 'Posted', dataIndex: 'postedAt', width: 110, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtDate(v)}</span> },
    { title: 'Actions', width: 110, align: 'right', render: (_, r) => <Button size="small" onClick={() => { setEditingVac(r); setPresetVac(null); setVacDrawer(true); }}>Edit</Button> },
  ];

  const candCols: ColumnsType<any> = [
    { title: 'Candidate', width: 200, render: (_, r) => <div><div className="text-[13px] font-medium text-[#171a2e]">{r.name}</div><div className="text-[11px] text-[#94a3b8]">{r.candidateNo}</div></div> },
    { title: 'Email', dataIndex: 'email', width: 200, render: (v) => <span className="text-[12px]">{v}</span> },
    { title: 'Current role', width: 160, render: (_, r) => r.currentPosition },
    { title: 'Location', dataIndex: 'location', width: 120 },
    { title: 'Source', dataIndex: 'source', width: 140 },
    { title: 'Applications', width: 110, render: (_, r) => r.applications?.length || 0 },
    { title: 'Status', dataIndex: 'status', width: 120, render: (v) => statusTag(v) },
    { title: 'Actions', width: 110, align: 'right', render: (_, r) => <Button size="small" onClick={() => { setEditingCand(r); setCandDrawer(true); }}>Edit</Button> },
  ];

  const appCols: ColumnsType<any> = [
    { title: 'Application #', dataIndex: 'applicationNo', width: 120, render: (v) => <span className="font-medium text-[#171a2e]">{v || '—'}</span> },
    { title: 'Candidate', width: 180, render: (_, r) => r.candidate?.name },
    { title: 'Vacancy', width: 160, render: (_, r) => r.vacancy?.title },
    { title: 'Applied', dataIndex: 'appliedAt', width: 110, render: (v) => <span className="text-[12px] text-[#64748b]">{fmtDate(v)}</span> },
    { title: 'Stage', dataIndex: 'stage', width: 130, render: (v) => <Tag color={stageMeta(v).color}>{stageMeta(v).label}</Tag> },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => statusTag(v) },
    { title: 'Actions', width: 200, align: 'right', render: (_, r) => (
      <div className="flex gap-1 justify-end">
        {!r.offer && <Button size="small" onClick={() => createOfferFor(r)}>Offer</Button>}
        {r.offer?.status === 'ACCEPTED' && <Can permission="recruitment.hire"><Button size="small" type="primary" onClick={() => hireCandidateByApp(r)}>Hire</Button></Can>}
        <Button size="small" onClick={() => setSelApp(r)}>Open</Button>
      </div>
    ) },
  ];

  const offerCols: ColumnsType<any> = [
    { title: 'Offer #', dataIndex: 'offerNo', width: 120, render: (v) => <span className="font-medium text-[#171a2e]">{v}</span> },
    { title: 'Candidate', width: 180, render: (_, r) => r.application?.candidate?.name },
    { title: 'Position', width: 160, render: (_, r) => r.application?.vacancy?.title },
    { title: 'Base', width: 120, render: (_, r) => fmtMoney(r.baseSalary) },
    { title: 'Start', dataIndex: 'startDate', width: 110, render: (v) => <span className="text-[12px]">{fmtDate(v)}</span> },
    { title: 'Status', dataIndex: 'status', width: 150, render: (v) => statusTag(v, OFFER_STATUS_COLORS) },
    { title: 'Actions', width: 240, align: 'right', render: (_, r: any) => (
      <div className="flex gap-1 justify-end">
        {r.status === 'DRAFT' && <Button size="small" onClick={() => api(`/hr/recruitment/offers/${r.id}/submit`, { method: 'POST' }).then(() => { message.success('Submitted for approval'); refresh(); }).catch((e) => message.error(e.message))}>Submit</Button>}
        {r.status === 'PENDING_APPROVAL' && <Can permission="recruitment.offers.approve"><Button size="small" type="primary" onClick={() => api(`/hr/recruitment/offers/${r.id}/approve`, { method: 'POST' }).then(() => { message.success('Offer approved'); refresh(); }).catch((e) => message.error(e.message))}>Approve</Button></Can>}
        {r.status === 'APPROVED' && <Button size="small" onClick={() => api(`/hr/recruitment/offers/${r.id}/send`, { method: 'POST' }).then(() => { message.success('Offer sent'); refresh(); }).catch((e) => message.error(e.message))}>Send</Button>}
        {['SENT', 'VIEWED'].includes(r.status) && <Button size="small" type="primary" onClick={() => api(`/hr/recruitment/offers/${r.id}/accept`, { method: 'POST' }).then(() => { message.success('Offer accepted'); refresh(); }).catch((e) => message.error(e.message))}>Accept</Button>}
        {r.status === 'ACCEPTED' && <Can permission="recruitment.hire"><Button size="small" danger onClick={() => hireConfirmed(r)}>Hire</Button></Can>}
      </div>
    ) },
  ];

  async function hireConfirmed(offer: any) {
    try {
      const res = await api(`/hr/recruitment/applications/${offer.applicationId}/hire`, { method: 'POST', body: JSON.stringify({}) });
      message.success(`Hired — Employee ${res.employeeNo}`); refresh();
    } catch (e: any) { message.error(e.message); }
  }

  async function hireCandidateByApp(app: any) {
    try {
      const res = await api(`/hr/recruitment/applications/${app.id}/hire`, { method: 'POST', body: JSON.stringify({}) });
      message.success(`Hired — Employee ${res.employeeNo}`); refresh();
    } catch (e: any) { message.error(e.message); }
  }

  function createOfferFor(app: any) {
    let sal = 0;
    Modal.confirm({
      title: `Offer — ${app.candidate?.name}`,
      content: (
        <div className="mt-2 space-y-3">
          <div className="text-[13px] text-[#344054]">Position: {app.vacancy?.title}</div>
          <InputNumber style={{ width: '100%' }} prefix="$" min={0} placeholder="Monthly base salary" onChange={(v) => (sal = Number(v || 0))} />
        </div>
      ),
      okText: 'Create offer',
      onOk: async () => {
        try {
          await api('/hr/recruitment/offers', { method: 'POST', body: JSON.stringify({ applicationId: app.id, baseSalary: sal, position: app.vacancy?.title, startDate: dayjs().add(1, 'month').format('YYYY-MM-DD'), employmentType: app.vacancy?.employmentType || 'FULL_TIME' }) });
          message.success('Offer created (DRAFT)'); refresh();
        } catch (e: any) { message.error(e.message); }
      },
    });
  }

  const d = dash.data || {};
  const funnel = d.funnel || [];
  const attention = d.needsAttention || {};
  const filteredApps = useMemo(() => applications.data?.filter((a: any) => !stageFilter || a.stage === stageFilter), [applications.data, stageFilter]);

  const stageTotals = funnel.reduce((a: any, s: any) => { a[s.stage] = s.count; return a; }, {});

  return (
    <div className="nex-fade">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-[26px] font-bold text-[#171a2e] leading-tight">Recruitment</h1><p className="text-[13px] text-[#64748b] mt-1">Manage vacancies, candidates and hiring workflows</p></div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={refresh}>Refresh</Button>
          <Can permission="recruitment.requisitions.create"><Button icon={<PlusOutlined />} onClick={() => { setEditingReq(null); setReqDrawer(true); }}>Requisition</Button></Can>
          <Can permission="recruitment.vacancies.create"><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingVac(null); setPresetVac(null); setVacDrawer(true); }}>Vacancy</Button></Can>
        </div>
      </div>

      {tab === 'dashboard' && (
        <div className="nex-card mb-5 p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard icon={<AppstoreOutlined />} label="Open Vacancies" value={d.openVacancies ?? 0} hint="Active openings" color="#1d5fb5" />
            <StatCard icon={<TeamOutlined />} label="Active Candidates" value={d.activeCandidates ?? 0} hint="In pipeline" color="#7c3aed" />
            <StatCard icon={<CalendarOutlined />} label="Interviews This Week" value={d.interviewsThisWeek ?? 0} hint="Scheduled" color="#ea580c" />
            <StatCard icon={<DollarOutlined />} label="Offers Pending" value={d.offersPending ?? 0} hint="Awaiting response" color="#16a34a" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <StatCard icon={<RiseOutlined />} label="Applications This Month" value={d.applicationsThisMonth ?? 0} color="#2563eb" />
            <StatCard icon={<ClockCircleOutlined />} label="Avg Time to Hire" value={`${d.timeToHire ?? 0}d`} color="#64748b" />
            <StatCard icon={<FireOutlined />} label="Awaiting Approval" value={d.positionsAwaitingApproval ?? 0} color="#f59e0b" />
            <StatCard icon={<CheckCircleOutlined />} label="Offers Accepted" value={d.offersAcceptedHires ?? 0} color="#16a34a" />
          </div>
          <div className="grid grid-cols-2 gap-6 mt-6">
            <div className="nex-card p-4">
              <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Hiring funnel</div>
              <div className="space-y-2">
                {PIPELINE.map((s) => (
                  <div key={s.code} className="flex items-center gap-3">
                    <span className="w-28 text-[12px] text-[#64748b]">{s.label}</span>
                    <div className="flex-1 h-2.5 rounded-full" style={{ background: `${s.color}1f` }}><div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, ((stageTotals[s.code] || 0) / Math.max(1, (stageTotals.APPLIED || 1)) * 100))}%`, background: s.color }} /></div>
                    <span className="w-8 text-right text-[12px] font-semibold text-[#171a2e]">{stageTotals[s.code] || 0}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="nex-card p-4">
              <div className="text-[13px] font-semibold text-[#171a2e] mb-3">Needs attention</div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-[13px] text-[#344054]"><ClockCircleOutlined className="text-[#f59e0b]" /> {attention.interviewsFeedbackPending || 0} interviews need feedback</div>
                <div className="flex items-center gap-2 text-[13px] text-[#344054]"><DollarOutlined className="text-[#e11d48]" /> {attention.offersExpiringSoon || 0} offers expire this week</div>
                <div className="flex items-center gap-2 text-[13px] text-[#344054]"><FireOutlined className="text-[#0ea5e9]" /> {attention.requisitionsAwaitingApproval || 0} requisitions awaiting approval</div>
                <div className="flex items-center gap-2 text-[13px] text-[#344054]"><UserOutlined className="text-[#64748b]" /> {attention.staleCandidates || 0} candidates with no activity for 7 days</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Tabs activeKey={tab} onChange={setTab}
        items={[
          { key: 'dashboard', label: 'Dashboard', children: null },
          { key: 'requisitions', label: `Requisitions (${requisitions.data?.length || 0})`, children: <div className="nex-card"><Table rowKey="id" loading={requisitions.isLoading} dataSource={requisitions.data || []} columns={reqCols} pagination={false} /></div> },
          { key: 'vacancies', label: `Vacancies (${vacancies.data?.length || 0})`, children: <div className="nex-card">{vacancies.data?.length ? <Table rowKey="id" loading={vacancies.isLoading} dataSource={vacancies.data || []} columns={vacCols} pagination={false} /> : <EmptyState title="No vacancies yet." description="Create an approved hiring requisition to open your first vacancy." />}</div> },
          { key: 'candidates', label: `Candidates (${candidates.data?.length || 0})`, children: <div className="nex-card">{candidates.data?.length ? <Table rowKey="id" loading={candidates.isLoading} dataSource={candidates.data || []} columns={candCols} pagination={false} /> : <EmptyState title="No candidates found." />}</div> },
          { key: 'applications', label: `Applications (${applications.data?.length || 0})`, children: (
            <div className="nex-card">
              <div className="flex items-center gap-2 px-4 pt-3 mb-3">
                <span className="text-[12px] text-[#64748b]">Stage:</span>
                <Select size="small" allowClear placeholder="All stages" style={{ width: 180 }} value={stageFilter || undefined} onChange={(v) => setStageFilter(v || '')} options={PIPELINE.map((s) => ({ label: s.label, value: s.code }))} />
              </div>
              {filteredApps?.length ? <Table rowKey="id" loading={applications.isLoading} dataSource={filteredApps} columns={appCols} pagination={false} /> : <EmptyState title="No applications match the selected filters." />}
            </div>
          ) },
          { key: 'more', label: 'More', children: (
            <div className="grid grid-cols-1 gap-4">
              <div className="nex-card p-4">
                <div className="text-[14px] font-semibold text-[#171a2e] mb-3 flex items-center gap-2"><SendOutlined className="text-[#1d5fb5]" /> Offers</div>
                <Table rowKey="id" loading={offers.isLoading} dataSource={offers.data || []} columns={offerCols} pagination={false} />
              </div>
            </div>
          ) },
        ]} />

      <RequisitionDrawer open={reqDrawer} onClose={() => setReqDrawer(false)} onSaved={refresh} editing={editingReq} />
      <VacancyDrawer open={vacDrawer} onClose={() => setVacDrawer(false)} onSaved={refresh} editing={editingVac} preset={presetVac} />
      <CandidateDrawer open={candDrawer} onClose={() => setCandDrawer(false)} onSaved={refresh} editing={editingCand} />
      <ApplicationDrawer app={selApp} onClose={() => { setSelApp(null); }} onSaved={() => { refresh(); }} />
    </div>
  );
}
