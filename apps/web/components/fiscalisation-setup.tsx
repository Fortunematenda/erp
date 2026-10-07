'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Drawer, Form, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Table, Tag, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, SyncOutlined, SafetyCertificateOutlined,
  CloudUploadOutlined, ExperimentOutlined, FileSearchOutlined, MailOutlined, PlusOutlined, QuestionCircleOutlined, RocketOutlined,
} from '@ant-design/icons';
import { api } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { FiscalisationWizard } from '@/components/fiscalisation-wizard';

type ItemStatus = 'OK' | 'MISSING' | 'INCOMPLETE' | 'WARNING';

const STATUS_META: Record<string, { color: string; label: string }> = {
  OK: { color: 'green', label: 'OK' },
  MISSING: { color: 'red', label: 'Missing' },
  INCOMPLETE: { color: 'orange', label: 'Incomplete' },
  WARNING: { color: 'gold', label: 'Warning' },
};

const ENV_META: Record<string, { color: string; label: string; hint: string }> = {
  MOCK: { color: 'default', label: 'MOCK', hint: 'Simulated provider — no ZIMRA transmission' },
  SANDBOX: { color: 'blue', label: 'SANDBOX', hint: 'ZIMRA test environment (fdmsapitest.zimra.co.zw)' },
  PRODUCTION: { color: 'red', label: 'PRODUCTION', hint: 'Live ZIMRA FDMS (fdmsapi.zimra.co.zw)' },
};

const READINESS_META: Record<string, { color: string; label: string }> = {
  NOT_CONFIGURED: { color: 'default', label: 'Not Configured' },
  PARTIALLY_CONFIGURED: { color: 'orange', label: 'Partially Configured' },
  READY_FOR_SANDBOX: { color: 'blue', label: 'Ready for Sandbox' },
  SANDBOX_TESTING: { color: 'cyan', label: 'Sandbox Testing' },
  AWAITING_APPROVAL: { color: 'gold', label: 'Awaiting Approval' },
  PRODUCTION_CONFIGURATION_INCOMPLETE: { color: 'volcano', label: 'Production Configuration Incomplete' },
  PRODUCTION_READY: { color: 'green', label: 'Production Ready' },
  PRODUCTION_ACTIVE: { color: 'green', label: 'Production Active' },
  PRODUCTION_DEGRADED: { color: 'red', label: 'Production Degraded' },
  SUSPENDED: { color: 'red', label: 'Suspended' },
};

export function FiscalisationSetup() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [prodOpen, setProdOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState<any>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [taxEdit, setTaxEdit] = useState<any>(null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [csrOpen, setCsrOpen] = useState(false);
  const [csr, setCsr] = useState('');
  const [creatingDevice, setCreatingDevice] = useState(false);
  const taxFormRef = useRef<any>(null);
  const [deviceForm] = Form.useForm();
  const [profileForm] = Form.useForm();
  const [reqForm] = Form.useForm();
  const [companyForm] = Form.useForm();
  const [branchForm] = Form.useForm();
  const [certForm] = Form.useForm();

  const profile = useQuery({ queryKey: ['fiscal-profile'], queryFn: () => api('/fiscalisation/profile') });
  const readiness = useQuery({ queryKey: ['fiscal-readiness'], queryFn: () => api('/fiscalisation/readiness?target=PRODUCTION') });
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices') });
  const taxMappings = useQuery({ queryKey: ['fiscal-tax-mappings'], queryFn: () => api('/fiscalisation/tax-mappings') });
  const requests = useQuery({ queryKey: ['fiscal-requests'], queryFn: () => api('/fiscalisation/requests') });
  const logs = useQuery({ queryKey: ['fiscal-logs'], queryFn: () => api('/fiscalisation/integration-logs') });
  const classification = useQuery({ queryKey: ['fiscal-classification'], queryFn: () => api('/fiscalisation/classification') });
  const branches = useQuery({ queryKey: ['fiscal-branches'], queryFn: () => api('/fiscalisation/branches') });

  const env = profile.data?.environment || 'MOCK';
  const rd = readiness.data;
  const rdMeta = READINESS_META[rd?.status || 'NOT_CONFIGURED'] || READINESS_META.NOT_CONFIGURED;

  const refresh = () => ['fiscal-profile', 'fiscal-readiness', 'fiscal-devices', 'fiscal-branches', 'fiscal-tax-mappings', 'fiscal-requests', 'fiscal-logs', 'fiscal-config', 'fiscal-dashboard', 'fiscal-classification'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  async function run(key: string, fn: () => Promise<any>, okMsg: string) {
    setBusy(key);
    try { await fn(); message.success(okMsg); refresh(); return true; }
    catch (e: any) { message.error(e.message || 'Operation failed'); return false; }
    finally { setBusy(null); }
  }

  const switchEnv = (target: string) => {
    if (target === env) return;
    if (target === 'PRODUCTION') { setProdOpen(true); return; }
    setReason(''); setSwitchTarget(target);
  };

  async function confirmSwitch() {
    if (!switchTarget) return;
    await run('switch', () => api('/fiscalisation/environment/switch', { method: 'POST', body: JSON.stringify({ target: switchTarget, reason }) }), `Environment set to ${switchTarget}`);
    setSwitchTarget(null); setReason('');
  }

  async function activateProduction() {
    await run('activate', () => api('/fiscalisation/production/activate', { method: 'POST', body: JSON.stringify({ confirm: true, reason: 'Activated from readiness drawer' }) }), 'Production fiscalisation activated');
    setProdOpen(false);
  }

  function openProfileEdit() {
    profileForm.setFieldsValue({
      taxpayerName: profile.data?.taxpayerName, vatRegistered: profile.data?.vatRegistered, taxpayerEmail: profile.data?.taxpayerEmail,
      integratorName: profile.data?.integratorName, softwareName: profile.data?.softwareName, deviceModelName: profile.data?.deviceModelName,
      deviceModelVersion: profile.data?.deviceModelVersion, technicalContactName: profile.data?.technicalContactName,
      technicalContactEmail: profile.data?.technicalContactEmail, technicalContactPhone: profile.data?.technicalContactPhone,
      businessAddress: profile.data?.businessAddress, testRegistrationRef: profile.data?.testRegistrationRef,
      productionApprovalRef: profile.data?.productionApprovalRef, productionApprovalDate: profile.data?.productionApprovalDate,
      productionApprovalEvidence: profile.data?.productionApprovalEvidence,
    });
  }

  async function saveProfile(values: any) {
    if (await run('profile', () => api('/fiscalisation/profile', { method: 'PUT', body: JSON.stringify(values) }), 'Profile saved')) setProfileOpen(false);
  }

  function openCompany() {
    companyForm.setFieldsValue({
      legalName: rd?.company?.name || profile.data?.taxpayerName || '',
      tin: rd?.company?.tin || '',
      vatNumber: rd?.company?.vatNumber || '',
    });
    setCompanyOpen(true);
  }

  async function saveCompany(values: any) {
    if (await run('company', () => api('/fiscalisation/company', { method: 'PUT', body: JSON.stringify(values) }), 'Company details saved')) setCompanyOpen(false);
  }

  function openBranch() {
    const current = branches.data?.[0];
    branchForm.setFieldsValue(current || {});
    setBranchOpen(true);
  }

  async function saveBranch(values: any) {
    if (!values.id) { message.warning('Select a branch first. Branches are created in Administration.'); return; }
    if (await run('branch', () => api(`/fiscalisation/branches/${values.id}`, { method: 'PUT', body: JSON.stringify(values) }), 'Branch saved')) setBranchOpen(false);
  }

  function openDeviceCreate() {
    setCreatingDevice(true);
    deviceForm.resetFields();
    deviceForm.setFieldsValue({ branchId: branches.data?.[0]?.id, environment: env });
    setDeviceOpen(true);
  }

  async function verifyTaxpayer() {
    await run('verify', async () => {
      const res = await api('/fiscalisation/taxpayer/verify', { method: 'POST', body: JSON.stringify({ environment: env }) });
      if (res.mismatch) modal.warning({ title: 'Taxpayer mismatch', content: `ZIMRA returned "${res.taxpayerName}" which does not match "${res.companyName}". Review before proceeding.` });
      else message.success('Taxpayer verified');
    }, 'Taxpayer verification complete');
  }

  const selectedDevice = devices.data?.[0];

  function openDeviceEdit() {
    if (!selectedDevice) return;
    setCreatingDevice(false);
    deviceForm.setFieldsValue({
      id: selectedDevice.id, name: selectedDevice.name, serialNumber: selectedDevice.serialNumber,
      modelName: selectedDevice.modelName, modelVersion: selectedDevice.modelVersion, integratorName: selectedDevice.integratorName,
      posLocation: selectedDevice.posLocation, zimraDeviceId: selectedDevice.zimraDeviceId, environment: selectedDevice.environment,
      certificateExpiresAt: selectedDevice.certificateExpiresAt,
    });
    setDeviceOpen(true);
  }

  async function saveDevice(values: any) {
    const id = values.id;
    const payload = { ...values };
    delete payload.id;
    const ok = id
      ? await run('device', () => api(`/fiscalisation/devices/${id}`, { method: 'PUT', body: JSON.stringify(payload) }), 'Device saved')
      : await run('device', () => api('/fiscalisation/devices', { method: 'POST', body: JSON.stringify(payload) }), 'Device created');
    if (ok) { setDeviceOpen(false); setCreatingDevice(false); }
  }

  function requireDevice() {
    if (selectedDevice) return selectedDevice;
    message.warning('Add a fiscal device first.');
    openDeviceCreate();
    return null;
  }

  async function generateCsr(deviceId: string) {
    await run('csr', async () => {
      const res = await api(`/fiscalisation/devices/${deviceId}/generate-csr`, { method: 'POST' });
      setCsr(res.csrPem || '');
      setCsrOpen(true);
    }, 'CSR generated');
  }

  async function installCertificate(values: { certificatePem: string }) {
    const device = requireDevice();
    if (!device) return;
    if (await run('cert', () => api(`/fiscalisation/devices/${device.id}/certificate`, { method: 'POST', body: JSON.stringify({ certificatePem: values.certificatePem }) }), 'Certificate installed')) {
      setCertOpen(false);
      certForm.resetFields();
    }
  }

  function openTax() {
    const rows = taxMappings.data || [];
    if (!rows.length) {
      message.info('Add a tax rate first, then map it here.');
      router.push('/finance/tax-rates');
      return;
    }
    setTaxEdit(rows.find((r: any) => !r.fdmsTaxId) || rows[0]);
    document.getElementById('fiscal-tax-mapping')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openWizard(step: number) {
    setWizardStep(step);
    setWizardOpen(true);
  }

  function handleAction(item: any) {
    const href = String(item?.action?.href || '');
    if (href.startsWith('http')) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (href === '/settings/company') { openCompany(); return; }
    if (href.startsWith('/inventory')) { router.push('/inventory'); return; }
    if (href.startsWith('/finance/')) { router.push(href); return; }
    if (href.startsWith('/administration')) { router.push(href); return; }
    switch (item.key) {
      case 'tin':
      case 'name':
        openCompany();
        return;
      case 'vatNumber':
        openCompany();
        return;
      case 'vatStatus':
      case 'samples':
      case 'approval':
      case 'evidence':
        openProfileEdit();
        setProfileOpen(true);
        return;
      case 'verified':
      case 'identity':
      case 'belongsToTaxpayer':
        verifyTaxpayer();
        return;
      case 'selected':
      case 'address':
      case 'contact':
        openBranch();
        return;
      case 'pos':
      case 'model':
      case 'modelVersion':
      case 'activationKey':
      case 'prodCredentials':
      case 'deviceRules':
      case 'serial':
        if (selectedDevice) openDeviceEdit();
        else openDeviceCreate();
        return;
      case 'registered':
      case 'prodDevice': {
        const device = requireDevice();
        if (device) run('register', () => api(`/fiscalisation/devices/${device.id}/register`, { method: 'POST' }), 'Device registered');
        return;
      }
      case 'privateKey':
      case 'csr': {
        const device = requireDevice();
        if (device) generateCsr(device.id);
        return;
      }
      case 'certificate':
      case 'certValid':
      case 'prodCert':
      case 'certDevice':
      case 'keyAvailable':
        if (requireDevice()) setCertOpen(true);
        return;
      case 'mtls':
      case 'getConfig':
      case 'taxpayerConfig':
      case 'operatingMode':
      case 'qrConfig': {
        const device = requireDevice();
        if (device) run('sync', () => api(`/fiscalisation/devices/${device.id}/sync-config`, { method: 'POST' }), 'Configuration synchronised');
        return;
      }
      case 'fiscalDayConfig':
        router.push('/fiscalisation?tab=dashboard');
        return;
      case 'taxes':
      case 'taxMappings':
        openTax();
        return;
      case 'classification':
        router.push('/inventory');
        return;
      case 'testingComplete':
      case 'deviceRegistration':
      case 'taxpayerVerification':
      case 'configSync':
      case 'dayOpen':
      case 'invoiceSubmit':
      case 'creditSubmit':
      case 'debitSubmit':
      case 'signature':
      case 'dayClose':
      case 'rendering':
      case 'qr':
      case 'isolation':
        openWizard(7);
        return;
      case 'currency':
        router.push('/finance/currency');
        return;
      case 'invoiceMapping':
      case 'creditMapping':
      case 'debitMapping':
        if (selectedDevice) openWizard(3);
        else openDeviceCreate();
        return;
      case 'finalCheck':
        setProdOpen(true);
        return;
      default:
        if (href && href !== '/fiscalisation?tab=setup') router.push(href);
        else openWizard(0);
    }
  }

  async function prepareEmail() {
    await run('email', async () => {
      const res = await api('/fiscalisation/requests/email', { method: 'POST', body: JSON.stringify({ assistance: 'New fiscal-device registration', deviceId: selectedDevice?.id }) });
      setEmail(res);
      setEmailOpen(true);
    }, 'Email draft prepared');
  }

  async function saveRequest(values: any) {
    if (await run('req', () => api('/fiscalisation/requests', { method: 'POST', body: JSON.stringify({ ...values, subject: email?.subject, body: email?.body }) }), 'Request recorded')) setRequestOpen(false);
  }

  async function saveTaxMapping(values: any) {
    if (await run('tax', () => api('/fiscalisation/tax-mappings', { method: 'PUT', body: JSON.stringify(values) }), 'Tax mapping saved')) setTaxEdit(null);
  }

  const requestCols: ColumnsType<any> = [
    { title: 'Assistance', dataIndex: 'assistance', width: 180 },
    { title: 'Status', dataIndex: 'status', width: 200, render: (v) => <Tag>{v?.replace(/_/g, ' ')}</Tag> },
    { title: 'Reference', dataIndex: 'referenceNumber', width: 140, render: (v) => v || '—' },
    { title: 'Requested', dataIndex: 'requestDate', width: 120, render: (v) => (v ? fmtDate(v) : '—') },
    { title: 'Approval Ref', dataIndex: 'approvalReference', width: 140, render: (v) => v || '—' },
    { title: 'Created', dataIndex: 'createdAt', width: 150, render: (v) => fmtDateTime(v) },
  ];

  const logCols: ColumnsType<any> = [
    { title: 'When', dataIndex: 'createdAt', width: 160, render: (v) => fmtDateTime(v) },
    { title: 'Environment', dataIndex: 'environment', width: 110, render: (v) => <Tag color={ENV_META[v]?.color}>{v}</Tag> },
    { title: 'Operation', dataIndex: 'operation', width: 150 },
    { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <Tag color={v === 'OK' ? 'green' : 'red'}>{v}</Tag> },
    { title: 'Device', width: 160, render: (_v, r) => `${r.device?.name || ''} · ${r.device?.branch?.name || ''}` },
    { title: 'Error', dataIndex: 'errorMessage', render: (v) => v || '—' },
  ];

  const taxCols: ColumnsType<any> = [
    { title: 'ERP Tax', dataIndex: 'erpTaxCode', width: 130, render: (v, r) => <span className="font-medium">{v} <span className="text-[#94a3b8]">({r.erpRate}%)</span></span> },
    { title: 'ERP Treatment', dataIndex: 'erpTreatment', width: 140, render: (v) => v || '—' },
    { title: 'FDMS Tax ID', dataIndex: 'fdmsTaxId', width: 130, render: (v) => v || <Tag color="red">unmapped</Tag> },
    { title: 'FDMS Tax Name', dataIndex: 'fdmsTaxName', width: 160, render: (v) => v || '—' },
    { title: 'FDMS Rate', dataIndex: 'fdmsTaxRate', width: 100, align: 'right', render: (v) => (v != null ? `${v}%` : '—') },
    { title: '', width: 80, align: 'right', render: (_v, r) => <Button size="small" onClick={() => setTaxEdit(r)}>Map</Button> },
  ];

  const checklist = rd?.categories || [];

  return (
    <div className="space-y-5">
      {/* Environment banner */}
      <div className={`nex-card p-5 border-l-4 ${env === 'PRODUCTION' ? 'border-l-[#e11d48]' : env === 'SANDBOX' ? 'border-l-[#1d5fb5]' : 'border-l-[#94a3b8]'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[#64748b] uppercase tracking-wide">Fiscalisation Environment</span>
              <Tag color={ENV_META[env]?.color} className="!m-0">{ENV_META[env]?.label}</Tag>
            </div>
            <div className="text-[12px] text-[#94a3b8] mt-1">{ENV_META[env]?.hint}</div>
          </div>
          <div className="flex items-center gap-3">
            <Tag color={rdMeta.color} className="!m-0">{rdMeta.label}</Tag>
            <Button type="primary" icon={<RocketOutlined />} onClick={() => { setWizardStep(null); setWizardOpen(true); }}>Setup Wizard</Button>
            <Button icon={<SyncOutlined />} loading={busy === 'reconcile'} onClick={() => run('reconcile', () => api('/fiscalisation/reconcile', { method: 'POST' }), 'Fiscal statuses reconciled from accepted receipts')}>Reconcile statuses</Button>
            <Segmented
              value={env}
              onChange={(v) => switchEnv(String(v))}
              options={[
                { label: 'Mock', value: 'MOCK', icon: <ExperimentOutlined /> },
                { label: 'Sandbox', value: 'SANDBOX', icon: <CloudUploadOutlined /> },
                { label: 'Production', value: 'PRODUCTION', icon: <RocketOutlined /> },
              ]}
            />
          </div>
        </div>
      </div>

      {rd && !rd.ready && (
        <Alert
          type="warning"
          showIcon
          message={`Production setup ${rd.status === 'PRODUCTION_ACTIVE' ? 'complete' : 'incomplete'} — ${rd.summary.passed}/${rd.summary.total} requirements met`}
          description={<>Missing {rd.summary.missing} · Incomplete {rd.summary.incomplete} · Warnings {rd.summary.warnings}. {rd.summary.unresolvedReceipts > 0 && <>Unresolved receipts: {rd.summary.unresolvedReceipts}. </>}{rd.summary.openDay && <>A fiscal day is open. </>}Production activation is blocked until all critical requirements pass.</>}
          action={<Button size="small" onClick={() => setProdOpen(true)}>View Requirements</Button>}
        />
      )}

      {/* Readiness checklist */}
      <div className="nex-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] font-semibold text-[#171a2e]">Production Readiness</div>
          <Space>
            <Button size="small" icon={<QuestionCircleOutlined />} onClick={() => setHelpOpen(true)}>How to Obtain ZIMRA Details</Button>
            <Button size="small" icon={<SyncOutlined />} onClick={() => readiness.refetch()} loading={readiness.isFetching}>Recheck</Button>
          </Space>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {checklist.map((c: any) => (
            <div key={c.key} className="border border-[#eef0f6] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#171a2e]">{c.label}</span>
                <Tag color={c.legal ? 'blue' : 'default'}>{c.legal ? 'ZIMRA requirement' : 'Internal check'}</Tag>
              </div>
              <div className="space-y-1.5">
                {c.items.map((i: any) => (
                  <div key={i.key} className="flex items-start justify-between gap-2 text-[12px]">
                    <div className="flex items-start gap-2 min-w-0">
                      {i.status === 'OK' ? <CheckCircleOutlined className="text-[#16a34a] mt-0.5" /> : i.status === 'WARNING' ? <WarningOutlined className="text-[#f59e0b] mt-0.5" /> : <CloseCircleOutlined className="text-[#e11d48] mt-0.5" />}
                      <div className="min-w-0">
                        <div className="text-[#344054]">{i.label}</div>
                        {i.status !== 'OK' && i.reason && <div className="text-[#94a3b8]">{i.reason}</div>}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {i.status === 'OK' ? null : <ReadinessAction item={i} onAction={handleAction} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Taxpayer profile */}
      <div className="nex-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] font-semibold text-[#171a2e]">Company Taxpayer Profile</div>
          <Space>
            <Button size="small" icon={<FileSearchOutlined />} loading={busy === 'verify'} onClick={verifyTaxpayer}>Verify Taxpayer</Button>
            <Button size="small" onClick={() => { openProfileEdit(); setProfileOpen(true); }}>Edit</Button>
          </Space>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-[13px]">
          <Field label="Registered Name" value={profile.data?.taxpayerName} />
          <Field label="Company TIN" value={rd?.company?.tin} />
          <Field label="VAT Registered" value={profile.data?.vatRegistered ? 'Yes' : 'No'} />
          <Field label="VAT Number" value={rd?.company?.vatNumber} />
          <Field label="Taxpayer Email" value={profile.data?.taxpayerEmail} />
          <Field label="Verification" value={profile.data?.taxpayerVerified ? <Tag color="green">Verified</Tag> : <Tag color="red">Not verified</Tag>} />
          <Field label="ZIMRA Returned Name" value={profile.data?.verifiedTaxpayerName} />
          <Field label="Verified At" value={profile.data?.verifiedAt ? fmtDateTime(profile.data.verifiedAt) : '—'} />
        </div>
      </div>

      {/* Device & credentials */}
      <div className="nex-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] font-semibold text-[#171a2e]">Fiscal Device &amp; ZIMRA Credentials</div>
          <Space>
            <Button size="small" icon={<SyncOutlined />} loading={busy === 'sync'} onClick={() => { const device = requireDevice(); if (device) run('sync', () => api(`/fiscalisation/devices/${device.id}/sync-config`, { method: 'POST' }), 'Configuration synchronised'); }}>Synchronise Config</Button>
            <Button size="small" icon={<SafetyCertificateOutlined />} loading={busy === 'register'} onClick={() => { const device = requireDevice(); if (device) run('register', () => api(`/fiscalisation/devices/${device.id}/register`, { method: 'POST' }), 'Device registered'); }}>Register Device</Button>
            <Button size="small" onClick={() => (selectedDevice ? openDeviceEdit() : openDeviceCreate())}>{selectedDevice ? 'Edit' : 'Add device'}</Button>
          </Space>
        </div>
        {selectedDevice ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-[13px]">
            <Field label="Device" value={`${selectedDevice.name} · ${selectedDevice.branch?.name || ''}`} />
            <Field label="Serial Number" value={selectedDevice.serialNumber} />
            <Field label="Model / Version" value={[selectedDevice.modelName, selectedDevice.modelVersion].filter(Boolean).join(' / ') || '—'} />
            <Field label="Integrator" value={selectedDevice.integratorName || profile.data?.integratorName || '—'} />
            <Field label="ZIMRA Device ID" value={selectedDevice.zimraDeviceId || <Tag color="red">Missing</Tag>} />
            <Field label="Activation Key" value={selectedDevice.hasActivationKey ? <span className="font-mono">{selectedDevice.activationKeyMasked}</span> : <Tag color="red">Missing</Tag>} />
            <Field label="Certificate" value={selectedDevice.certificateExpiresAt ? <Tag color={new Date(selectedDevice.certificateExpiresAt) > new Date() ? 'green' : 'red'}>{fmtDate(selectedDevice.certificateExpiresAt)}</Tag> : <Tag color="red">Missing</Tag>} />
            <Field label="Status" value={<Tag>{selectedDevice.status}</Tag>} />
          </div>
        ) : <div className="text-[13px] text-[#94a3b8]">No fiscal device configured for this company. <button type="button" className="text-[#1d5fb5] hover:underline" onClick={openDeviceCreate}>Add a device</button> or use the Setup wizard.</div>}
      </div>

      {/* Tax mapping */}
      <div id="fiscal-tax-mapping" className="nex-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14px] font-semibold text-[#171a2e]">Tax Mapping (ERP → FDMS)</div>
          <Button size="small" icon={<PlusOutlined />} onClick={openTax}>Configure</Button>
        </div>
        <Table rowKey="erpTaxCode" size="small" loading={taxMappings.isLoading} dataSource={taxMappings.data || []} columns={taxCols} pagination={false} />
      </div>

      {/* Registration assistance */}
      <div className="nex-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14px] font-semibold text-[#171a2e]">ZIMRA Registration Assistance</div>
          <Space>
            <Button size="small" icon={<MailOutlined />} loading={busy === 'email'} onClick={prepareEmail}>Prepare ZIMRA Request</Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { reqForm.resetFields(); setRequestOpen(true); }}>Record Request</Button>
          </Space>
        </div>
        <Table rowKey="id" size="small" loading={requests.isLoading} dataSource={requests.data || []} columns={requestCols} pagination={{ pageSize: 8 }} />
      </div>

      {/* Product classification */}
      <div className="nex-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14px] font-semibold text-[#171a2e]">Product / Service Classification</div>
          <Button size="small" icon={<SyncOutlined />} onClick={() => classification.refetch()} loading={classification.isFetching}>Refresh</Button>
        </div>
        {classification.data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-[13px]">
              <span>Active items <b>{classification.data.total}</b></span>
              <span>Missing HS code <b className={classification.data.missingHsCode ? 'text-[#e11d48]' : 'text-[#16a34a]'}>{classification.data.missingHsCode}</b></span>
              <span>Missing tax code <b className={classification.data.missingTaxCode ? 'text-[#f59e0b]' : 'text-[#16a34a]'}>{classification.data.missingTaxCode}</b></span>
            </div>
            {classification.data.items?.length > 0 && (
              <Table rowKey="id" size="small" dataSource={classification.data.items} pagination={{ pageSize: 5 }} columns={[
                { title: 'SKU', dataIndex: 'sku', width: 130, render: (v) => <button type="button" className="text-[#1d5fb5] hover:underline" onClick={() => router.push('/inventory')}>{v}</button> },
                { title: 'Name', dataIndex: 'name', render: (v) => <button type="button" className="text-left text-[#171a2e] hover:text-[#1d5fb5] hover:underline" onClick={() => router.push('/inventory')}>{v}</button> },
                { title: 'HS Code', dataIndex: 'hsCode', width: 120, render: (v) => v || <Tag color="red">Missing</Tag> },
                { title: 'Tax Code', dataIndex: 'salesTaxCode', width: 120, render: (v) => v || <Tag color="orange">Missing</Tag> },
              ]} />
            )}
          </div>
        ) : <div className="text-[13px] text-[#94a3b8]">Loading classification…</div>}
      </div>

      {/* Integration logs */}
      <div className="nex-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14px] font-semibold text-[#171a2e]">Integration Logs</div>
          <Button size="small" icon={<SyncOutlined />} onClick={() => logs.refetch()} loading={logs.isFetching}>Refresh</Button>
        </div>
        <Table rowKey="id" size="small" loading={logs.isLoading} dataSource={logs.data || []} columns={logCols} pagination={{ pageSize: 10 }} />
      </div>

      <Modal open={companyOpen} title="Company Details" onCancel={() => setCompanyOpen(false)} onOk={() => companyForm.submit()} confirmLoading={busy === 'company'} forceRender destroyOnHidden={false}>
        <Form form={companyForm} layout="vertical" onFinish={saveCompany}>
          <Form.Item name="legalName" label="Registered Name" rules={[{ required: true, message: 'Registered name is required' }]}><Input /></Form.Item>
          <Form.Item name="tin" label="Company TIN"><Input /></Form.Item>
          <Form.Item name="vatNumber" label="VAT Number"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal open={branchOpen} title="Branch Registration" onCancel={() => setBranchOpen(false)} onOk={() => branchForm.submit()} confirmLoading={busy === 'branch'} width={680} forceRender destroyOnHidden={false}>
        <Form form={branchForm} layout="vertical" onFinish={saveBranch} className="grid grid-cols-2 gap-x-4">
          <Form.Item name="id" label="Branch" rules={[{ required: true, message: 'Select a branch' }]} className="col-span-2">
            <Select options={(branches.data || []).map((b: any) => ({ value: b.id, label: b.name }))} placeholder="Select branch" onChange={(id) => { const b = (branches.data || []).find((x: any) => x.id === id); if (b) branchForm.setFieldsValue(b); }} />
          </Form.Item>
          <Form.Item name="name" label="Branch Name"><Input /></Form.Item>
          <Form.Item name="phone" label="Phone"><Input /></Form.Item>
          <Form.Item name="email" label="Email"><Input type="email" /></Form.Item>
          <Form.Item name="houseNumber" label="House Number"><Input /></Form.Item>
          <Form.Item name="street" label="Street"><Input /></Form.Item>
          <Form.Item name="city" label="City"><Input /></Form.Item>
          <Form.Item name="province" label="Province"><Input /></Form.Item>
          <Form.Item name="zimraRegion" label="ZIMRA Region"><Input /></Form.Item>
          <Form.Item name="zimraStation" label="ZIMRA Station"><Input /></Form.Item>
          <div className="col-span-2 text-[12px] text-[#64748b]">New branches are created in <button type="button" className="text-[#1d5fb5] hover:underline" onClick={() => router.push('/administration')}>Administration</button>. This form updates the fiscal registration details for an existing branch.</div>
        </Form>
      </Modal>

      <Modal open={certOpen} title="Install Device Certificate" onCancel={() => setCertOpen(false)} onOk={() => certForm.submit()} confirmLoading={busy === 'cert'} forceRender destroyOnHidden={false}>
        <Form form={certForm} layout="vertical" onFinish={installCertificate}>
          <Form.Item name="certificatePem" label="Certificate (PEM)" rules={[{ required: true, message: 'Paste the certificate issued by ZIMRA' }]}><Input.TextArea rows={8} placeholder="-----BEGIN CERTIFICATE-----" /></Form.Item>
        </Form>
      </Modal>

      <Modal open={csrOpen} title="Certificate Signing Request" onCancel={() => setCsrOpen(false)} footer={<Button type="primary" onClick={() => { navigator.clipboard?.writeText(csr); message.success('CSR copied'); }}>Copy CSR</Button>} destroyOnHidden>
        <Input.TextArea rows={12} value={csr} readOnly />
      </Modal>

      {/* Profile edit modal */}
      <Modal open={profileOpen} title="Company Taxpayer Profile" onCancel={() => setProfileOpen(false)} onOk={() => profileForm.submit()} confirmLoading={busy === 'profile'} width={720} forceRender destroyOnHidden={false}>
        <Form form={profileForm} layout="vertical" onFinish={saveProfile} className="grid grid-cols-2 gap-x-4">
          <Form.Item name="taxpayerName" label="Registered Taxpayer Name"><Input /></Form.Item>
          <Form.Item name="taxpayerEmail" label="Taxpayer Email"><Input type="email" /></Form.Item>
          <Form.Item name="vatRegistered" label="VAT Registered" valuePropName="checked"><Switch /></Form.Item>
          <div />
          <Form.Item name="integratorName" label="Registered Integrator Name"><Input /></Form.Item>
          <Form.Item name="softwareName" label="Software Product Name"><Input disabled /></Form.Item>
          <Form.Item name="deviceModelName" label="Registered Device Model"><Input /></Form.Item>
          <Form.Item name="deviceModelVersion" label="Device Model Version"><Input /></Form.Item>
          <Form.Item name="technicalContactName" label="Technical Contact Name"><Input /></Form.Item>
          <Form.Item name="technicalContactEmail" label="Technical Contact Email"><Input type="email" /></Form.Item>
          <Form.Item name="technicalContactPhone" label="Technical Contact Phone"><Input /></Form.Item>
          <Form.Item name="testRegistrationRef" label="Test Registration Reference"><Input /></Form.Item>
          <Form.Item name="businessAddress" label="Business Address" className="col-span-2"><Input /></Form.Item>
          <Form.Item name="productionApprovalRef" label="Production Approval Reference"><Input /></Form.Item>
          <Form.Item name="productionApprovalDate" label="Approval Date"><Input placeholder="YYYY-MM-DD" /></Form.Item>
          <Form.Item name="productionApprovalEvidence" label="Approval Evidence (reference / URL)" className="col-span-2"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Device edit modal */}
      <Modal open={deviceOpen} title={creatingDevice ? 'Add Fiscal Device' : 'Fiscal Device & Credentials'} onCancel={() => { setDeviceOpen(false); setCreatingDevice(false); }} onOk={() => deviceForm.submit()} confirmLoading={busy === 'device'} width={680} forceRender destroyOnHidden={false}>
        <Form form={deviceForm} layout="vertical" onFinish={saveDevice} className="grid grid-cols-2 gap-x-4">
          <Form.Item name="id" hidden><Input /></Form.Item>
          {creatingDevice && <Form.Item name="branchId" label="Branch" rules={[{ required: true, message: 'Select a branch' }]} className="col-span-2"><Select options={(branches.data || []).map((b: any) => ({ value: b.id, label: b.name }))} placeholder="Select branch" /></Form.Item>}
          <Form.Item name="name" label="Device Name"><Input /></Form.Item>
          <Form.Item name="serialNumber" label="Serial Number" rules={[{ required: true, message: 'Serial number is required' }]}><Input /></Form.Item>
          <Form.Item name="modelName" label="Registered Model Name"><Input /></Form.Item>
          <Form.Item name="modelVersion" label="Registered Model Version"><Input /></Form.Item>
          <Form.Item name="integratorName" label="Registered Integrator"><Input /></Form.Item>
          <Form.Item name="posLocation" label="Point of Sale / Location"><Input /></Form.Item>
          <Form.Item name="zimraDeviceId" label="ZIMRA Device ID"><Input /></Form.Item>
          <Form.Item name="activationKey" label={<span>Activation Key <Tooltip title="Stored encrypted. Leave blank to keep the existing key."><QuestionCircleOutlined /></Tooltip></span>}><Input.Password placeholder={selectedDevice?.activationKeyMasked || 'Enter activation key'} autoComplete="new-password" /></Form.Item>
          <Form.Item name="environment" label="Device Environment"><Select options={[{ value: 'MOCK' }, { value: 'SANDBOX' }, { value: 'PRODUCTION' }]} /></Form.Item>
          <Form.Item name="certificateExpiresAt" label="Certificate Expiry"><Input placeholder="YYYY-MM-DD" /></Form.Item>
        </Form>
      </Modal>

      {/* Tax mapping modal */}
      <Modal open={!!taxEdit} title={`Map tax ${taxEdit?.erpTaxCode || ''}`} onCancel={() => setTaxEdit(null)} onOk={() => taxFormRef.current?.submit()} confirmLoading={busy === 'tax'} destroyOnHidden>
        <TaxMappingForm mapping={taxEdit} onFinish={saveTaxMapping} onReady={(f) => (taxFormRef.current = f)} />
      </Modal>

      {/* Environment switch confirm */}
      <Modal open={!!switchTarget} title={`Switch to ${switchTarget}`} onCancel={() => setSwitchTarget(null)} onOk={confirmSwitch} confirmLoading={busy === 'switch'} destroyOnHidden>
        {env === 'PRODUCTION' && <Alert type="warning" showIcon className="mb-3" message="Leaving production requires a reason and is blocked while unresolved receipts or an open fiscal day exist." />}
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={env === 'PRODUCTION' ? 'Reason for changing the active production connection (required)' : 'Reason (optional)'} />
      </Modal>

      {/* Production readiness drawer */}
      <Drawer open={prodOpen} title="Activate Production Fiscalisation" width={640} onClose={() => setProdOpen(false)} destroyOnHidden
        extra={<Space><Button onClick={() => setProdOpen(false)}>Cancel</Button><Button type="primary" danger disabled={!rd?.ready} loading={busy === 'activate'} onClick={activateProduction}>Activate Production</Button></Space>}>
        {rd && (
          <div className="space-y-4">
            <div className="nex-card p-4 text-[13px] space-y-1">
              <div className="flex justify-between"><span className="text-[#64748b]">Company</span><b>{rd.company.name}</b></div>
              <div className="flex justify-between"><span className="text-[#64748b]">Registered TIN</span><b>{rd.company.tin || '—'}</b></div>
              <div className="flex justify-between"><span className="text-[#64748b]">Environment</span><b>Production</b></div>
              <div className="flex justify-between"><span className="text-[#64748b]">Readiness</span><Tag color={rdMeta.color}>{rdMeta.label}</Tag></div>
            </div>
            <Alert type={rd.ready ? 'success' : 'error'} showIcon message={rd.ready ? 'All requirements satisfied' : `Production setup incomplete — ${rd.blockers.length} requirement(s) outstanding`}
              description={rd.ready ? 'Future eligible fiscal transactions will be processed using the production ZIMRA FDMS integration. Test/mock receipts are not converted into production receipts.' : 'Resolve every blocking requirement below before activating production.'} />
            <div className="space-y-2">
              {rd.blockers.map((b: any, idx: number) => (
                <div key={`${b.key}-${idx}`} className="flex items-start justify-between gap-3 border border-[#eef0f6] rounded-lg p-3">
                  <div>
                    <div className="text-[13px] font-medium text-[#171a2e]">{b.label} <Tag color={STATUS_META[b.status]?.color}>{STATUS_META[b.status]?.label}</Tag></div>
                    <div className="text-[12px] text-[#94a3b8]">{b.category} · {b.reason || b.whereToObtain || 'Requirement outstanding'}</div>
                  </div>
                  <ReadinessAction item={b} onAction={handleAction} />
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      {/* Help drawer */}
      <Drawer open={helpOpen} title="How to Obtain ZIMRA Details" width={620} onClose={() => setHelpOpen(false)} destroyOnHidden>
        <div className="space-y-4 text-[13px]">
          <Alert type="info" showIcon message="ZIMRA issues device credentials through its own registration process. NexusERP captures and validates them but cannot register devices on your behalf through an undocumented API." />
          <HelpItem title="ZIMRA Device ID" body="Obtained through the ZIMRA FDMS device registration process." link={{ label: 'Open FDMS Portal', href: 'https://fdmsops.zimra.co.zw/fdms-public/add-device' }} />
          <HelpItem title="Activation Key" body="Issued with the registered device's activation details. Store it securely — it is encrypted at rest and never shown in full again." />
          <HelpItem title="Registered Branch" body="Branch registration and verification are performed through the TaRMS / FDMS taxpayer portal." link={{ label: 'Open TaRMS', href: 'https://mytaxselfservice.zimra.co.zw' }} />
          <HelpItem title="Production Approval" body="Production onboarding requires ZIMRA approval after successful sandbox testing. Record the approval reference and evidence once received." />
          <HelpItem title="Test Environment" body="Sandbox testing uses the ZIMRA test API." link={{ label: 'Test Swagger', href: 'https://fdmsapitest.zimra.co.zw/swagger/index.html' }} />
        </div>
      </Drawer>

      {/* Email draft drawer */}
      <Drawer open={emailOpen} title="ZIMRA Request Draft" width={680} onClose={() => setEmailOpen(false)} destroyOnHidden
        extra={<Space><Button onClick={() => { navigator.clipboard?.writeText(`${email?.subject}\n\n${email?.body}`); message.success('Copied'); }}>Copy</Button><Button type="primary" onClick={() => { setRequestOpen(true); }}>Record Request</Button></Space>}>
        {email && (
          <div className="space-y-3">
            {email.missing?.length > 0 && <Alert type="warning" showIcon message={`${email.missing.length} missing detail(s)`} description={email.missing.join(', ')} />}
            <div className="text-[12px] text-[#64748b]">Subject</div>
            <Input value={email.subject} readOnly />
            <div className="text-[12px] text-[#64748b]">Body</div>
            <Input.TextArea rows={20} value={email.body} readOnly />
          </div>
        )}
      </Drawer>

      {/* Record request modal */}
      <Modal open={requestOpen} title="Record ZIMRA Request" onCancel={() => setRequestOpen(false)} onOk={() => reqForm.submit()} confirmLoading={busy === 'req'} forceRender destroyOnHidden={false}>
        <Form form={reqForm} layout="vertical" onFinish={saveRequest}>
          <Form.Item name="assistance" label="Assistance Needed" initialValue="New fiscal-device registration">
            <Select options={['New fiscal-device registration', 'Existing device activation details', 'Device registration verification', 'Virtual fiscalisation testing', 'Production onboarding', 'Certificate/registration problem', 'Fiscal-day issue', 'Other FDMS assistance'].map((v) => ({ value: v }))} />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue="DRAFT"><Select options={['DRAFT', 'READY_TO_SUBMIT', 'SUBMITTED', 'AWAITING_RESPONSE', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED'].map((v) => ({ value: v }))} /></Form.Item>
          <Form.Item name="referenceNumber" label="Reference Number"><Input /></Form.Item>
          <Form.Item name="zimraContact" label="ZIMRA Contact / Office"><Input /></Form.Item>
          <Form.Item name="responseNotes" label="Response Notes"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="approvalReference" label="Approval Reference"><Input /></Form.Item>
        </Form>
      </Modal>

      <FiscalisationWizard open={wizardOpen} initialStep={wizardStep} onClose={() => { setWizardOpen(false); setWizardStep(null); refresh(); }} />
    </div>
  );
}

function TaxMappingForm({ mapping, onFinish, onReady }: { mapping: any; onFinish: (v: any) => void; onReady: (f: any) => void }) {  const [form] = Form.useForm();
  onReady(form);
  return (
    <Form form={form} layout="vertical" onFinish={onFinish} initialValues={mapping || {}} key={mapping?.erpTaxCode}>
      <Form.Item name="erpTaxCode" label="ERP Tax Code"><Input disabled /></Form.Item>
      <Form.Item name="erpTreatment" label="ERP Treatment"><Input /></Form.Item>
      <Form.Item name="fdmsTaxId" label="FDMS Tax ID" rules={[{ required: true, message: 'FDMS tax ID is required' }]}><Input /></Form.Item>
      <Form.Item name="fdmsTaxName" label="FDMS Tax Name"><Input /></Form.Item>
      <Form.Item name="fdmsTaxRate" label="FDMS Tax Rate %"><InputNumber className="w-full" /></Form.Item>
    </Form>
  );
}

function ReadinessAction({ item, onAction }: { item: any; onAction: (item: any) => void }) {
  const label = item.action?.label || STATUS_META[item.status]?.label || 'Open';
  return <button type="button" className="text-[12px] text-[#1d5fb5] hover:underline shrink-0 text-left" onClick={() => onAction(item)}>{label}</button>;
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[11px] text-[#94a3b8] uppercase tracking-wide">{label}</div>
      <div className="text-[13px] font-medium text-[#171a2e] mt-0.5 break-words">{value === null || value === undefined || value === '' ? '—' : value}</div>
    </div>
  );
}

function HelpItem({ title, body, link }: { title: string; body: string; link?: { label: string; href: string } }) {
  return (
    <div className="border border-[#eef0f6] rounded-lg p-3">
      <div className="font-semibold text-[#171a2e]">{title}</div>
      <div className="text-[#64748b] mt-1">{body}</div>
      {link && <a href={link.href} target="_blank" rel="noreferrer" className="text-[#1d5fb5]">{link.label}</a>}
    </div>
  );
}
