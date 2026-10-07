'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Form, Input, Select, Space, Steps, Switch, Table, Tag } from 'antd';
import { api } from '@/lib/api';

const STEP_TITLES = [
  'Company Details', 'Taxpayer Registration', 'Branch Registration', 'Fiscal Device Details', 'ZIMRA Credentials',
  'Device Registration & Certificate', 'Tax Mapping', 'Connection Testing', 'Production Readiness', 'Activate Fiscalisation',
];

const STATUS_COLOR: Record<string, string> = { OK: 'green', MISSING: 'red', INCOMPLETE: 'orange', WARNING: 'gold' };

export function FiscalisationWizard({ open, onClose, initialStep }: { open: boolean; onClose: () => void; initialStep?: number | null }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [csr, setCsr] = useState<string>('');
  const [companyForm] = Form.useForm();
  const [profileForm] = Form.useForm();
  const [branchForm] = Form.useForm();
  const [deviceForm] = Form.useForm();
  const [credForm] = Form.useForm();

  const profile = useQuery({ queryKey: ['fiscal-profile'], queryFn: () => api('/fiscalisation/profile'), enabled: open });
  const readiness = useQuery({ queryKey: ['fiscal-readiness'], queryFn: () => api('/fiscalisation/readiness?target=PRODUCTION'), enabled: open });
  const devices = useQuery({ queryKey: ['fiscal-devices'], queryFn: () => api('/fiscalisation/devices'), enabled: open });
  const branches = useQuery({ queryKey: ['fiscal-branches'], queryFn: () => api('/fiscalisation/branches'), enabled: open });
  const taxMappings = useQuery({ queryKey: ['fiscal-tax-mappings'], queryFn: () => api('/fiscalisation/tax-mappings'), enabled: open });
  const logs = useQuery({ queryKey: ['fiscal-logs'], queryFn: () => api('/fiscalisation/integration-logs'), enabled: open });

  const device = devices.data?.[0];
  const company = readiness.data?.company;

  useEffect(() => {
    if (!open) return;
    if (initialStep != null) setStep(initialStep);
    else if (profile.data?.setupStep != null) setStep(profile.data.setupStep);
  }, [open, initialStep, profile.data?.setupStep]);

  useEffect(() => {
    if (!open || step !== 0) return;
    companyForm.setFieldsValue({ legalName: company?.name, tin: company?.tin, vatNumber: company?.vatNumber });
  }, [open, step, company?.name, company?.tin, company?.vatNumber, companyForm]);

  const refresh = () => ['fiscal-profile', 'fiscal-readiness', 'fiscal-devices', 'fiscal-branches', 'fiscal-tax-mappings'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  async function run(fn: () => Promise<any>, okMsg: string) {
    setBusy(true);
    try { await fn(); message.success(okMsg); refresh(); }
    catch (e: any) { message.error(e.message || 'Operation failed'); }
    finally { setBusy(false); }
  }

  async function saveDraft(nextStep: number) {
    await api('/fiscalisation/profile', { method: 'PUT', body: JSON.stringify({ setupStep: nextStep }) }).catch(() => {});
  }

  async function go(next: number) {
    if (next > step) {
      const ok = await validateStep(step);
      if (!ok) return;
    }
    setStep(next);
    saveDraft(next);
  }

  async function validateStep(current: number): Promise<boolean> {
    try {
      if (current === 1) await profileForm.validateFields();
      if (current === 2) await branchForm.validateFields();
      if (current === 3) await deviceForm.validateFields();
      if (current === 4) await credForm.validateFields();
      return true;
    } catch {
      message.warning('Please complete the required fields before continuing.');
      return false;
    }
  }

  async function saveProfile(values: any) { await run(() => api('/fiscalisation/profile', { method: 'PUT', body: JSON.stringify(values) }), 'Saved'); }
  async function verifyTaxpayer() { await run(() => api('/fiscalisation/taxpayer/verify', { method: 'POST', body: JSON.stringify({ environment: profile.data?.environment || 'MOCK' }) }), 'Taxpayer verification complete'); }
  async function saveBranch(values: any) { await run(() => api(`/fiscalisation/branches/${values.id}`, { method: 'PUT', body: JSON.stringify(values) }), 'Branch saved'); }
  async function saveDevice(values: any) {
    if (values.id) {
      const payload = { ...values }; delete payload.id;
      await run(() => api(`/fiscalisation/devices/${values.id}`, { method: 'PUT', body: JSON.stringify(payload) }), 'Device saved');
    } else {
      await run(() => api('/fiscalisation/devices', { method: 'POST', body: JSON.stringify(values) }), 'Device created');
    }
  }
  async function saveCredentials(values: any) { if (!device) return message.warning('Save a fiscal device on the previous step first.'); await run(() => api(`/fiscalisation/devices/${device.id}`, { method: 'PUT', body: JSON.stringify(values) }), 'Credentials saved'); }
  async function generateCsr() { if (!device) return message.warning('Save a fiscal device first.'); await run(async () => { const r = await api(`/fiscalisation/devices/${device.id}/generate-csr`, { method: 'POST' }); setCsr(r.csrPem); }, 'CSR generated'); }
  async function installCert() { if (!device) return message.warning('Save a fiscal device first.'); const pem = credForm.getFieldValue('certificatePem'); if (!pem) return message.warning('Paste the certificate issued by ZIMRA.'); await run(() => api(`/fiscalisation/devices/${device.id}/certificate`, { method: 'POST', body: JSON.stringify({ certificatePem: pem }) }), 'Certificate installed'); }
  async function registerDevice() { if (!device) return message.warning('Save a fiscal device first.'); await run(() => api(`/fiscalisation/devices/${device.id}/register`, { method: 'POST' }), 'Device registration submitted'); }
  async function syncConfig() { if (!device) return message.warning('Save a fiscal device first.'); await run(() => api(`/fiscalisation/devices/${device.id}/sync-config`, { method: 'POST' }), 'Configuration synchronised'); }
  async function saveTax(values: any) { await run(() => api('/fiscalisation/tax-mappings', { method: 'PUT', body: JSON.stringify(values) }), 'Tax mapping saved'); }
  async function activate() { await run(() => api('/fiscalisation/production/activate', { method: 'POST', body: JSON.stringify({ confirm: true, reason: 'Setup wizard' }) }), 'Production activated'); onClose(); }

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-3 text-[13px]">
            <Alert type="info" showIcon message="These details are the company master used for ZIMRA." />
            <Form form={companyForm} layout="vertical" onFinish={(values) => run(() => api('/fiscalisation/company', { method: 'PUT', body: JSON.stringify(values) }), 'Company details saved')}>
              <Form.Item name="legalName" label="Registered Name" rules={[{ required: true, message: 'Registered name is required' }]}><Input /></Form.Item>
              <Form.Item name="tin" label="TIN"><Input /></Form.Item>
              <Form.Item name="vatNumber" label="VAT Number"><Input /></Form.Item>
              <div className="text-[12px] text-[#64748b] mb-3">Base currency: {company?.baseCurrency || '—'}</div>
              <Button onClick={() => companyForm.submit()} loading={busy}>Save company details</Button>
            </Form>
          </div>
        );
      case 1:
        return (
          <Form form={profileForm} layout="vertical" initialValues={profile.data} onFinish={saveProfile} className="grid grid-cols-2 gap-x-4">
            <Form.Item name="taxpayerName" label="Registered Taxpayer Name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="taxpayerEmail" label="Taxpayer Email"><Input type="email" /></Form.Item>
            <Form.Item name="vatRegistered" label="VAT Registered" valuePropName="checked"><Switch /></Form.Item>
            <div className="col-span-2"><Space><Button onClick={() => profileForm.submit()}>Save</Button><Button icon={<span />} onClick={verifyTaxpayer} loading={busy}>Verify Taxpayer</Button></Space></div>
            {profile.data?.verifiedTaxpayerName && <Alert className="col-span-2" type={profile.data?.taxpayerVerified ? 'success' : 'warning'} showIcon message={`ZIMRA returned: ${profile.data.verifiedTaxpayerName}`} />}
          </Form>
        );
      case 2: {
        return (
          <Form form={branchForm} layout="vertical" initialValues={branches.data?.[0] || {}} onFinish={saveBranch} className="grid grid-cols-2 gap-x-4">
            <Form.Item name="id" label="Branch" rules={[{ required: true }]}>
              <Select options={(branches.data || []).map((b: any) => ({ value: b.id, label: b.name }))} onChange={(id) => { const b = branches.data.find((x: any) => x.id === id); branchForm.setFieldsValue(b); }} />
            </Form.Item>
            <Form.Item name="name" label="Trade / Branch Name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="phone" label="Branch Phone"><Input /></Form.Item>
            <Form.Item name="email" label="Branch Email"><Input type="email" /></Form.Item>
            <Form.Item name="houseNumber" label="House Number"><Input /></Form.Item>
            <Form.Item name="street" label="Street & Suburb"><Input /></Form.Item>
            <Form.Item name="suburb" label="Suburb"><Input /></Form.Item>
            <Form.Item name="city" label="City / Town"><Input /></Form.Item>
            <Form.Item name="province" label="Province"><Input /></Form.Item>
            <Form.Item name="zimraRegion" label="ZIMRA Region"><Input placeholder="As advised by ZIMRA" /></Form.Item>
            <Form.Item name="zimraStation" label="ZIMRA Station"><Input placeholder="As advised by ZIMRA" /></Form.Item>
            <div className="col-span-2"><Alert type="info" showIcon message="Branch registration is completed through the ZIMRA TaRMS/FDMS portal. Record the region/station once confirmed." action={<a href="https://mytaxselfservice.zimra.co.zw" target="_blank" rel="noreferrer">Open TaRMS</a>} /></div>
            <div className="col-span-2"><Button onClick={() => branchForm.submit()}>Save Branch</Button></div>
          </Form>
        );
      }
      case 3:
        return (
          <Form form={deviceForm} layout="vertical" initialValues={device || {}} onFinish={saveDevice} className="grid grid-cols-2 gap-x-4">
            <Form.Item name="id" hidden><Input /></Form.Item>
            <Form.Item name="branchId" label="Branch" rules={[{ required: true }]}><Select options={(branches.data || []).map((b: any) => ({ value: b.id, label: b.name }))} /></Form.Item>
            <Form.Item name="name" label="Device Name"><Input /></Form.Item>
            <Form.Item name="serialNumber" label="Device Serial Number" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="modelName" label="Registered Model Name"><Input /></Form.Item>
            <Form.Item name="modelVersion" label="Registered Model Version"><Input /></Form.Item>
            <Form.Item name="integratorName" label="Registered Integrator"><Input /></Form.Item>
            <Form.Item name="posLocation" label="Point of Sale / Location"><Input /></Form.Item>
            <div className="col-span-2"><Alert type="info" showIcon message="Use the device model, version and integrator exactly as registered with ZIMRA. Do not enter arbitrary values." /></div>
            <div className="col-span-2"><Button onClick={() => deviceForm.submit()}>Save Device</Button></div>
          </Form>
        );
      case 4:
        return (
          <Form form={credForm} layout="vertical" initialValues={{ zimraDeviceId: device?.zimraDeviceId }} onFinish={saveCredentials} className="grid grid-cols-2 gap-x-4">
            <Form.Item name="zimraDeviceId" label="ZIMRA Device ID" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="activationKey" label="Activation Key"><Input.Password placeholder={device?.activationKeyMasked || 'Enter activation key'} autoComplete="new-password" /></Form.Item>
            <div className="col-span-2"><Alert type="warning" showIcon message="The activation key is encrypted at rest and never shown again in full." action={<a href="https://fdmsops.zimra.co.zw/fdms-public/add-device" target="_blank" rel="noreferrer">Open FDMS Portal</a>} /></div>
            <div className="col-span-2"><Button onClick={() => credForm.submit()}>Save Credentials</Button></div>
          </Form>
        );
      case 5:
        return (
          <div className="space-y-4">
            <Alert type="info" showIcon message="Generate a private key and CSR, submit the CSR to ZIMRA, then paste the issued device certificate." />
            <Space wrap>
              <Button onClick={generateCsr} loading={busy}>Generate CSR</Button>
              <Button onClick={registerDevice} loading={busy} disabled={!device}>Register Device</Button>
            </Space>
            {csr && <Input.TextArea rows={8} value={csr} readOnly />}
            <Form form={credForm} layout="vertical">
              <Form.Item name="certificatePem" label="Issued Device Certificate (PEM)"><Input.TextArea rows={8} placeholder="-----BEGIN CERTIFICATE-----" /></Form.Item>
              <Button onClick={installCert} loading={busy} disabled={!device}>Install Certificate</Button>
            </Form>
            {device?.certificateThumbprint && <Alert type="success" showIcon message={`Certificate installed · thumbprint ${device.certificateThumbprint.slice(0, 24)}…`} />}
          </div>
        );
      case 6:
        return (
          <div className="space-y-3">
            <Alert type="info" showIcon message="Map every active ERP tax to the corresponding FDMS tax. Submissions to ZIMRA are blocked while any applied tax rate is unmapped." />
            <Table rowKey="erpTaxCode" size="small" dataSource={taxMappings.data || []} pagination={false} columns={[
              { title: 'ERP Tax', dataIndex: 'erpTaxCode', width: 120 },
              { title: 'Rate', dataIndex: 'erpRate', width: 80, render: (v) => `${v}%` },
              { title: 'FDMS Tax ID', dataIndex: 'fdmsTaxId', render: (v, r: any) => <Input size="small" defaultValue={v || ''} onBlur={(e) => saveTax({ erpTaxCode: r.erpTaxCode, erpTreatment: r.erpTreatment, fdmsTaxId: e.target.value, fdmsTaxName: r.fdmsTaxName, fdmsTaxRate: r.fdmsTaxRate })} /> },
              { title: 'FDMS Tax Name', dataIndex: 'fdmsTaxName', render: (v, r: any) => <Input size="small" defaultValue={v || ''} onBlur={(e) => saveTax({ erpTaxCode: r.erpTaxCode, erpTreatment: r.erpTreatment, fdmsTaxId: r.fdmsTaxId, fdmsTaxName: e.target.value, fdmsTaxRate: r.fdmsTaxRate })} /> },
              { title: 'FDMS Rate', dataIndex: 'fdmsTaxRate', width: 100, render: (v, r: any) => <Input size="small" defaultValue={v ?? ''} onBlur={(e) => saveTax({ erpTaxCode: r.erpTaxCode, erpTreatment: r.erpTreatment, fdmsTaxId: r.fdmsTaxId, fdmsTaxName: r.fdmsTaxName, fdmsTaxRate: e.target.value })} /> },
              { title: '', dataIndex: 'mapped', width: 90, render: (v) => v ? <Tag color="green">Mapped</Tag> : <Tag color="red">Unmapped</Tag> },
            ]} />
          </div>
        );
      case 7:
        return (
          <div className="space-y-3">
            <Alert type="info" showIcon message="Run the sandbox tests against the ZIMRA test environment. Tests are only marked complete when genuine responses are recorded." />
            <Space wrap>
              <Button onClick={verifyTaxpayer} loading={busy}>Verify Taxpayer</Button>
              <Button onClick={syncConfig} loading={busy} disabled={!device}>Synchronise Configuration</Button>
              <Button onClick={registerDevice} loading={busy} disabled={!device}>Test Device Registration</Button>
            </Space>
            <div className="text-[12px] text-[#64748b]">Latest integration activity</div>
            <div className="space-y-1">
              {(logs.data || []).slice(0, 8).map((l: any) => (
                <div key={l.id} className="flex items-center justify-between text-[12px] py-0.5 border-b border-[#f0f1f6] last:border-0">
                  <span className="text-[#344054]">{l.operation}</span>
                  <Tag color={l.environment === 'SANDBOX' ? 'blue' : l.environment === 'PRODUCTION' ? 'red' : 'default'}>{l.environment}</Tag>
                  <Tag color={l.status === 'OK' ? 'green' : 'red'}>{l.status}</Tag>
                </div>
              ))}
              {!(logs.data || []).length && <div className="text-[12px] text-[#94a3b8]">No integration activity recorded yet.</div>}
            </div>
          </div>
        );
      case 8:
      case 9: {
        const rd = readiness.data;
        return (
          <div className="space-y-3">
            <Alert type={rd?.ready ? 'success' : 'error'} showIcon message={rd?.ready ? 'Ready for production activation' : `Production setup incomplete — ${rd?.blockers?.length || 0} requirement(s) outstanding`} description={step === 9 ? 'Activating production routes future eligible transactions to the live ZIMRA FDMS. Test/mock receipts are never converted.' : 'Resolve all blocking requirements below.'} />
            <div className="space-y-2 max-h-[45vh] overflow-auto">
              {(rd?.categories || []).map((c: any) => (
                <div key={c.key} className="border border-[#eef0f6] rounded-lg p-3">
                  <div className="text-[13px] font-semibold mb-1">{c.label}</div>
                  {c.items.filter((i: any) => i.status !== 'OK').length === 0 ? <div className="text-[12px] text-[#16a34a]">All requirements met</div> :
                    c.items.filter((i: any) => i.status !== 'OK').map((i: any) => (
                      <div key={i.key} className="flex items-center justify-between text-[12px] py-0.5">
                        <span className="text-[#344054]">{i.label}{i.reason ? <span className="text-[#94a3b8]"> · {i.reason}</span> : ''}</span>
                        <Tag color={STATUS_COLOR[i.status]}>{i.status}</Tag>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            {step === 9 && <Button danger type="primary" onClick={activate} loading={busy} disabled={!rd?.ready}>Activate Production</Button>}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <Drawer open={open} onClose={onClose} width={880} title="Fiscalisation Setup Wizard" destroyOnHidden
      extra={<Space><Button onClick={() => go(step - 1)} disabled={step === 0}>Back</Button>{step < 9 ? <Button type="primary" onClick={() => go(step + 1)} loading={busy}>Continue</Button> : <Button onClick={onClose}>Finish</Button>}</Space>}>
      <Steps size="small" current={step} onChange={(s) => go(s)} items={STEP_TITLES.map((t) => ({ title: t }))} className="mb-5" />
      <div className="min-h-[320px]">{stepContent()}</div>
    </Drawer>
  );
}

function ReadRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between border-b border-[#f0f1f6] py-1.5">
      <span className="text-[#64748b]">{label}</span>
      <span className="font-medium text-[#171a2e]">{value || '—'}</span>
    </div>
  );
}
