'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Drawer, Form, Input, InputNumber, Modal, Radio, Select, Space, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { subtypeLabel, TYPE_TONE } from '@/components/finance/account-meta';
import { CreatableSelect } from '@/components/finance/creatable-select';
import { fmtMoney } from '@/lib/format';

const CANONICAL_OPTIONS = [
  { value: 'ASSET', label: 'Asset' }, { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' }, { value: 'REVENUE', label: 'Income' }, { value: 'EXPENSE', label: 'Expense' },
];

function normalOf(type?: string) { return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT'; }
function descendantsOf(id: string | undefined, accounts: any[]) {
  const set = new Set<string>(); if (!id) return set;
  const stack = [id];
  while (stack.length) { const cur = stack.pop()!; accounts.forEach((a) => { if (a.parentId === cur && !set.has(a.id)) { set.add(a.id); stack.push(a.id); } }); }
  return set;
}

export function AccountFormDrawer({ open, account, onClose, onSaved }: { open: boolean; account: any | null; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const { permissions } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const type = Form.useWatch('type', open ? form : undefined);
  const openingBalance = Form.useWatch('openingBalance', open ? form : undefined);
  const editing = !!account?.id;

  const [typeSel, setTypeSel] = useState<string>('ASSET');
  const [modal, setModal] = useState<null | 'type' | 'subtype' | 'parent'>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [typeForm] = Form.useForm();
  const [subForm] = Form.useForm();
  const [parentForm] = Form.useForm();
  const typeCanonical = Form.useWatch('canonicalClass', modal === 'type' ? typeForm : undefined);
  const subtypeVal = Form.useWatch('subtype', open ? form : undefined);
  const parentIdVal = Form.useWatch('parentId', open ? form : undefined);

  const canManageTypes = permissions?.includes('finance.account_types.manage');
  const canCreatePage = permissions?.includes('finance.accounts.manage');

  const typeQuery = useQuery({ queryKey: ['finance', 'account-types'], queryFn: () => api('/finance/account-types'), enabled: open });
  const subQuery = useQuery({ queryKey: ['finance', 'account-subtypes', type], queryFn: () => api(`/finance/account-subtypes?forType=${type}`), enabled: open && !!type });
  const accountsQuery = useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => api('/finance/accounts'), enabled: open });

  const typeOptions = typeQuery.data || [];
  const subOptions = subQuery.data || [];
  const accounts = accountsQuery.data || [];

  useEffect(() => {
    if (!open) return;
    if (account) {
      const typeVal = account.customTypeName ? (typeOptions.find((t: any) => !t.system && t.customTypeName === account.customTypeName && t.canonicalClass === account.type)?.value ?? account.type) : account.type;
      form.setFieldsValue({
        code: account.code, name: account.name, type: account.type, customTypeName: account.customTypeName,
        subtype: account.subtype || undefined, parentId: account.parentId || undefined, active: account.active,
        description: account.description, taxCode: account.taxCode,
        openingBalance: Number(account.openingBalance ?? 0),
        openingDate: account.openingJournal?.date ? dayjs(account.openingJournal.date) : undefined,
        openingOffsetAccountId: account.openingOffsetAccountId,
      });
      setTypeSel(typeVal);
    } else {
      form.resetFields();
      form.setFieldsValue({ active: true, type: 'ASSET', openingBalance: 0 });
      setTypeSel('ASSET');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account, typeQuery.data]);

  // Always expose the saved Parent as a resolvable option (fixes the race where
  // options load after the value is set and the Select renders blank).
  const parentOptions = useMemo(() => {
    const exclude = new Set(descendantsOf(account?.id, accounts)); exclude.add(account?.id || '');
    const valid = accounts.filter((a: any) => a.active !== false && a.type === type && !exclude.has(a.id));
    const byId: Record<string, any> = {};
    valid.forEach((a: any) => { byId[a.id] = { ...a, children: [] as any[], depth: 0 }; });
    const roots: any[] = [];
    valid.forEach((a: any) => { const n = byId[a.id]; if (a.parentId && byId[a.parentId]) byId[a.parentId].children.push(n); else roots.push(n); });
    const flat: any[] = [];
    const walk = (list: any[], depth: number) => list.forEach((n) => { n.depth = depth; flat.push(n); walk(n.children, depth + 1); });
    walk(roots, 0);
    const opts = flat.map((a: any) => ({ value: a.id, searchText: `${a.code} ${a.name}`, label: (
      <span className="inline-flex items-center gap-2" style={{ paddingLeft: (a.depth || 0) * 16 }}>
        <span className="font-mono text-[12px] text-[#003366]">{a.code}</span>
        <span>{a.name}</span>
        <Tag className="!mr-0" style={{ borderRadius: 6, fontSize: 10, lineHeight: '16px' }} color={TYPE_TONE[a.type] || 'default'}>{subtypeLabel(a.subtype)}</Tag>
      </span>
    ) }));
    // Inject the currently-saved parent so the saved value is always visible/resolvable.
    const p = account?.parent;
    if (p && !opts.some((o: any) => o.value === p.id)) opts.unshift({ value: p.id, searchText: `${p.code} ${p.name}`, label: <span className="inline-flex items-center gap-2"><span className="font-mono text-[12px] text-[#003366]">{p.code}</span><span>{p.name}</span></span> });
    return opts;
  }, [accounts, type, account?.id, account?.parent]);

  const detailBalance = account?.balance;

  const subtypeOptions = subOptions.map((s: any) => ({ value: s.system ? s.value : s.label, searchText: s.label, label: s.label, __custom: !s.system }));

  function onTypeChange(v?: string) {
    const val = v || 'ASSET';
    setTypeSel(val);
    const opt = typeOptions.find((t: any) => t.value === val);
    const cls = opt?.canonicalClass || val;
    const custom = opt && !opt.system ? opt.customTypeName : undefined;
    form.setFieldsValue({ type: cls, customTypeName: custom, subtype: undefined });
    // Clear cross-type parent.
    const pid = form.getFieldValue('parentId');
    if (pid) { const p = accounts.find((a: any) => a.id === pid); if (p && p.type !== cls) form.setFieldsValue({ parentId: undefined }); }
  }

  async function submit() {
    const v = await form.validateFields();
    // parentId / subtype are managed via useWatch + setFieldsValue and have NO
    // Form.Item `name`, so validateFields() does not include them. Read them
    // straight from the store to guarantee the selected Parent is persisted.
    const parentId = form.getFieldValue('parentId') || null;
    const subtype = form.getFieldValue('subtype');
    try {
      setLoading(true);
      const payload = { code: v.code, name: v.name, type: v.type, customTypeName: v.customTypeName, subtype, parentId, active: v.active, description: v.description, taxCode: v.taxCode, openingBalance: Number(v.openingBalance || 0), openingDate: v.openingDate?.format('YYYY-MM-DD'), openingOffsetAccountId: v.openingOffsetAccountId };
      if (editing) await api(`/finance/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/finance/accounts', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Account updated' : 'Account created' + (Number(v.openingBalance || 0) !== 0 ? ' (opening journal posted)' : ''));
      onSaved(); onClose();
    } catch (e: any) { message.error(e.message); } finally { setLoading(false); }
  }

  async function createType() {
    const v = await typeForm.validateFields();
    setCreateLoading(true);
    try {
      const r = await api('/finance/account-types', { method: 'POST', body: JSON.stringify(v) });
      message.success(`Account type "${r.name}" added`);
      setModal(null); typeForm.resetFields();
      await qc.invalidateQueries({ queryKey: ['finance', 'account-types'] });
      onTypeChange(`custom:${r.id}`);
    } catch (e: any) { message.error(e.message); } finally { setCreateLoading(false); }
  }

  async function createSubtype() {
    const v = await subForm.validateFields();
    setCreateLoading(true);
    try {
      const r = await api('/finance/account-subtypes', { method: 'POST', body: JSON.stringify({ name: v.name, canonicalClass: type, reportingGroup: v.reportingGroup, description: v.description, active: v.active }) });
      message.success(`Sub-type "${r.name}" added`);
      setModal(null); subForm.resetFields();
      await qc.invalidateQueries({ queryKey: ['finance', 'account-subtypes'] });
      form.setFieldsValue({ subtype: r.name });
    } catch (e: any) { message.error(e.message); } finally { setCreateLoading(false); }
  }

  async function createParent() {
    const v = await parentForm.validateFields();
    setCreateLoading(true);
    try {
      const r = await api('/finance/accounts', { method: 'POST', body: JSON.stringify({ code: v.code, name: v.name, type: v.type, subtype: v.subtype, isGroup: v.role === 'group', description: v.description }) });
      message.success(`Parent account "${r.code} ${r.name}" added`);
      setModal(null); parentForm.resetFields();
      await qc.invalidateQueries({ queryKey: ['finance', 'accounts'] });
      form.setFieldsValue({ parentId: r.id });
    } catch (e: any) { message.error(e.message); } finally { setCreateLoading(false); }
  }

  const normal = normalOf(type);

  return (
    <Drawer open={open} onClose={onClose} title={editing ? 'Edit Account' : 'New Account'} width={620} destroyOnHidden
      extra={<Button type="text" onClick={onClose}><span className="text-[16px]">&times;</span></Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit} loading={loading}>{editing ? 'Save' : 'Create Account'}</Button></Space>}>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Account Type *" name="type" rules={[{ required: true, message: 'Account type is required' }]} style={{ display: 'none' }}>
            <Input />
          </Form.Item>
          <Form.Item label={<span className="text-[13px] font-medium" style={{ color: '#344054' }}>Account Type *</span>}>
            <CreatableSelect
              options={typeOptions.map((t: any) => ({ value: t.value, label: t.label, searchText: `${t.label} ${t.canonicalClass}` }))}
              value={typeSel} onChange={onTypeChange} placeholder="Select type"
              createLabel={canManageTypes ? 'Add Account Type' : ''} onCreate={() => { typeForm.resetFields(); setModal('type'); }} canCreate={canManageTypes}
              emptyText="No account types configured." optionRender={(o: any) => <span>{o.label}</span>}
            />
          </Form.Item>
          <Form.Item label="Sub-Type">
            <CreatableSelect
              options={subtypeOptions} value={subtypeVal} onChange={(v) => form.setFieldsValue({ subtype: v })}
              placeholder="Select sub-type" disabled={!type}
              createLabel={canManageTypes ? 'Add Sub-Type' : ''} onCreate={() => { subForm.resetFields(); subForm.setFieldsValue({ canonicalClass: type }); setModal('subtype'); }} canCreate={canManageTypes}
              emptyText="No sub-types available." optionRender={(o: any) => <span>{o.label}</span>}
            />
          </Form.Item>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label="Account #" name="code" rules={[{ required: editing }]}><Input placeholder="e.g. 1110, or leave blank to auto" /></Form.Item>
          <Form.Item label="Status" name="active" initialValue={true}><Select options={[{ label: 'ACTIVE', value: true }, { label: 'INACTIVE', value: false }]} /></Form.Item>
        </div>
        <Form.Item label="Account Name *" name="name" rules={[{ required: true, message: 'Account name is required' }]}><Input /></Form.Item>
        {editing && detailBalance != null && (
          <Form.Item label="Current Balance" tooltip="Read-only. Account balances change only through journal entries, opening-balance journals and source documents.">
            <div className="rounded-lg bg-[#f8f9ff] px-3 py-2 text-[14px] font-semibold" style={{ color: Number(detailBalance) < 0 ? '#d64545' : '#1f2937' }}>{fmtMoney(detailBalance)}</div>
          </Form.Item>
        )}
        <Form.Item label="Normal Balance" tooltip="Derived automatically from the canonical accounting class.">
          <div className="rounded-lg bg-[#f8f9ff] px-3 py-2 text-[13px]" style={{ color: '#475467' }}>Auto · {normal === 'DEBIT' ? 'Debit' : 'Credit'}</div>
        </Form.Item>
        <Form.Item label="Tax Line" name="taxCode"><Select allowClear placeholder="Optional tax line" options={[]} /></Form.Item>
        <Form.Item label="Parent Account">
          <CreatableSelect
            options={parentOptions} value={parentIdVal} onChange={(v) => form.setFieldsValue({ parentId: v })}
            placeholder="None (top level)" allowClear
            createLabel={canCreatePage ? 'Add Parent Account' : ''} onCreate={() => { parentForm.resetFields(); parentForm.setFieldsValue({ type: type || 'ASSET', role: 'group' }); setModal('parent'); }} canCreate={canCreatePage}
            emptyText="No parent accounts available." optionRender={(o: any) => o.label}
            className="w-full"
          />
        </Form.Item>
        <Form.Item label="Description" name="description"><Input.TextArea rows={2} placeholder="Optional description" /></Form.Item>

        <div className="rounded-xl border border-[#f2f3f9] p-4 mb-4">
          <div className="text-[13px] font-semibold" style={{ color: '#171a2e' }}>Opening Balance <span className="font-normal" style={{ color: '#98A2B3' }}>{editing ? '(read-only — managed via opening journal)' : '(optional)'}</span></div>
          {!editing && <div className="text-[12px]" style={{ color: '#98A2B3' }}>Opening balances create an auditable opening journal — we never edit an account balance directly.</div>}
          <div className="grid grid-cols-2 gap-4 mt-3">
            <Form.Item label="Opening Balance" name="openingBalance"><InputNumber prefix="$" className="w-full" min={0} disabled={editing} /></Form.Item>
            <Form.Item label="Opening Balance Date" name="openingDate"><DatePicker className="w-full" disabled={editing || !Number(openingBalance)} /></Form.Item>
          </div>
          <Form.Item label="Offset Account (default: Opening Balance Equity)" name="openingOffsetAccountId">
            <Select allowClear showSearch optionFilterProp="label" placeholder="Auto → Opening Balance Equity" options={accounts.filter((a: any) => a.type === 'EQUITY').map((a: any) => ({ label: `${a.code} — ${a.name}`, value: a.id }))} disabled={editing || !Number(openingBalance)} />
          </Form.Item>
        </div>
      </Form>

      {/* ---- Add Account Type ---- */}
      <Modal open={modal === 'type'} title="New Account Type" okText="Add Type" onCancel={() => setModal(null)} onOk={createType} confirmLoading={createLoading} destroyOnHidden>
        <Form form={typeForm} layout="vertical">
          <Form.Item label="Name *" name="name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="e.g. Current Asset" /></Form.Item>
          <Form.Item label="Canonical Accounting Class *" name="canonicalClass" rules={[{ required: true, message: 'Canonical class is required' }]} initialValue="ASSET">
            <Select onChange={(c) => typeForm.setFieldsValue({ norm: normalOf(c) })} options={CANONICAL_OPTIONS} />
          </Form.Item>
          <Form.Item label="Default Normal Balance">
            <div className="rounded-lg bg-[#f8f9ff] px-3 py-2 text-[13px]" style={{ color: '#475467' }}>Auto · {normalOf(typeCanonical) === 'DEBIT' ? 'Debit' : 'Credit'}</div>
          </Form.Item>
          <Form.Item label="Description" name="description"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item label="Active" name="active" initialValue={true}><Radio.Group><Radio value={true}>Active</Radio><Radio value={false}>Inactive</Radio></Radio.Group></Form.Item>
        </Form>
      </Modal>

      {/* ---- Add Sub-Type ---- */}
      <Modal open={modal === 'subtype'} title="New Account Sub-Type" okText="Add Sub-Type" onCancel={() => setModal(null)} onOk={createSubtype} confirmLoading={createLoading} destroyOnHidden>
        <Form form={subForm} layout="vertical">
          <Form.Item label="Name *" name="name" rules={[{ required: true, message: 'Name is required' }]}><Input placeholder="e.g. Investment Account" /></Form.Item>
          <Form.Item label="Parent Account Type">
            <Input value={CANONICAL_OPTIONS.find((c) => c.value === type)?.label || type} disabled />
          </Form.Item>
          <Form.Item label="Reporting Group" name="reportingGroup"><Input placeholder="Optional reporting group" /></Form.Item>
          <Form.Item label="Description" name="description"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* ---- Add Parent Account (reuses Account model) ---- */}
      <Modal open={modal === 'parent'} title="New Parent Account" okText="Add Parent" onCancel={() => setModal(null)} onOk={createParent} confirmLoading={createLoading} destroyOnHidden>
        <Form form={parentForm} layout="vertical">
          <div className="grid grid-cols-2 gap-4">
            <Form.Item label="Account Type *" name="type" rules={[{ required: true }]}><Select options={CANONICAL_OPTIONS} /></Form.Item>
            <Form.Item label="Account #" name="code"><Input placeholder="e.g. 1110, or blank to auto" /></Form.Item>
          </div>
          <Form.Item label="Account Name *" name="name" rules={[{ required: true, message: 'Name is required' }]}><Input /></Form.Item>
          <Form.Item label="Sub-Type" name="subtype"><Select allowClear options={(subOptions as any[]).map((s: any) => ({ label: s.label, value: s.system ? s.value : s.label }))} /></Form.Item>
          <Form.Item label="Account Role" name="role" initialValue="group"><Radio.Group><Radio value="group">Group / Parent Account (non-posting)</Radio><Radio value="posting">Posting Account</Radio></Radio.Group></Form.Item>
          <Form.Item label="Description" name="description"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
}
