'use client';
import { useEffect } from 'react';
import { Button, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '@/lib/api';
import { useMeta } from '@/lib/meta';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmployeeSelector } from '@/components/employee-selector';

const EMPLOYMENT_TYPES = ['PERMANENT', 'FIXED_TERM', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN'];
const PAY_FREQ = ['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL', 'HOURLY'];
const ID_TYPES = ['National ID', 'Passport', 'Driving Licence', 'Work Permit', 'Other'];

function useDepartmentsAndCalendars() {
  const meta = useMeta();
  const cals = useQuery({ queryKey: ['/hr/work-calendars'], queryFn: () => api('/hr/work-calendars') });
  return { departments: meta.data?.departments || [], calendars: cals.data || [] };
}

export function EmployeeDrawer({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: () => void; editing: any | null }) {
  const [form] = Form.useForm();
  const qc = useQueryClient();
  const bankDetails = Form.useWatch('bankDetails', open ? form : undefined);
  const { departments, calendars } = useDepartmentsAndCalendars();

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const b = editing.bankDetails || {}, t = editing.taxDetails || {}, e = editing.emergencyContact || {};
      form.setFieldsValue({
        ...editing,
        hireDate: editing.hireDate ? dayjs(editing.hireDate) : undefined,
        dateOfBirth: editing.dateOfBirth ? dayjs(editing.dateOfBirth) : undefined,
        probationEndDate: editing.probationEndDate ? dayjs(editing.probationEndDate) : undefined,
        contractEndDate: editing.contractEndDate ? dayjs(editing.contractEndDate) : undefined,
        basicSalary: editing.basicSalary ? Number(editing.basicSalary) : undefined,
        bankDetails: { bank: b.bank, accountHolder: b.accountHolder, accountNumber: b.accountNumber, accountType: b.accountType, branch: b.branch, branchCode: b.branchCode },
        taxDetails: { tin: t.tin, taxStatus: t.taxStatus },
        emergencyContact: { name: e.name, relationship: e.relationship, phone: e.phone, email: e.email },
      });
    } else form.resetFields();
  }, [open, editing]);

  async function submit() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const payload = {
      firstName: v.firstName, middleName: v.middleName, lastName: v.lastName, preferredName: v.preferredName,
      employeeNo: v.employeeNo, departmentId: v.departmentId, position: v.position, managerId: v.managerId,
      contractType: v.contractType, workCalendarId: v.workCalendarId, employmentStatus: v.employmentStatus,
      hireDate: v.hireDate?.format('YYYY-MM-DD'), dateOfBirth: v.dateOfBirth?.format('YYYY-MM-DD'),
      probationEndDate: v.probationEndDate?.format('YYYY-MM-DD'), contractEndDate: v.contractEndDate?.format('YYYY-MM-DD'),
      idType: v.idType, idNumber: v.idNumber,
      email: v.workEmail, workEmail: v.workEmail, personalEmail: v.personalEmail, phone: v.phone, mobile: v.mobile,
      addressLine1: v.addressLine1, addressLine2: v.addressLine2, city: v.city, province: v.province, postalCode: v.postalCode, country: v.country,
      basicSalary: Number(v.basicSalary || 0), currency: v.currency, payFrequency: v.payFrequency, compensationType: v.compensationType,
      bankDetails: { bank: v.bankDetails?.bank, accountHolder: v.bankDetails?.accountHolder, accountNumber: v.bankDetails?.accountNumber, accountType: v.bankDetails?.accountType, branch: v.bankDetails?.branch, branchCode: v.bankDetails?.branchCode },
      taxDetails: { tin: v.taxDetails?.tin, taxStatus: v.taxDetails?.taxStatus },
      emergencyContact: { name: v.emergencyContact?.name, relationship: v.emergencyContact?.relationship, phone: v.emergencyContact?.phone, email: v.emergencyContact?.email },
      status: v.status || 'ACTIVE', active: v.active !== false,
    };
    try {
      if (editing) await api(`/hr/employees/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/hr/employees', { method: 'POST', body: JSON.stringify(payload) });
      message.success(editing ? 'Employee updated' : 'Employee created');
      onClose();
      onSaved();
      qc.invalidateQueries({ queryKey: ['/hr/employees'] });
    } catch (e: any) { message.error(e.message); }
  }

  return (
    <Drawer open={open} onClose={onClose} width={860} title={editing ? `Edit ${editing.firstName} ${editing.lastName}` : 'New Employee'} destroyOnHidden
      extra={<Button onClick={onClose}>Cancel</Button>}
      footer={<Space className="w-full justify-end"><Button onClick={onClose}>Cancel</Button><Button type="primary" onClick={submit}>Save Employee</Button></Space>}>
      <Form form={form} layout="vertical" className="mt-2">
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Employee number" name="employeeNo"><Input placeholder="auto if blank" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Preferred name" name="preferredName"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="First name" name="firstName" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Middle name" name="middleName"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Last name" name="lastName" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Date of birth" name="dateOfBirth"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item label="Identification type" name="idType"><Select allowClear options={ID_TYPES.map((t) => ({ label: t, value: t }))} /></Form.Item></Col>
          <Col span={8}><Form.Item label="Identification number" name="idNumber"><Input /></Form.Item></Col>
        </Row>

        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Employment</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Department" name="departmentId"><Select allowClear placeholder="Select department" options={departments.map((d: any) => ({ label: d.name, value: d.id }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Job title" name="position"><Input placeholder="e.g. Finance Officer" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Manager" name="managerId"><EmployeeSelector placeholder="Select manager" /></Form.Item></Col>
          <Col span={12}><Form.Item label="Employment type" name="contractType" initialValue="PERMANENT"><Select options={EMPLOYMENT_TYPES.map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Employment status" name="employmentStatus" initialValue="ACTIVE"><Select options={['ACTIVE', 'PROBATION', 'ON_LEAVE', 'TERMINATED'].map((t) => ({ label: t.replace(/_/g, ' '), value: t }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Work calendar" name="workCalendarId"><Select allowClear options={calendars.map((c: any) => ({ label: c.name, value: c.id }))} /></Form.Item></Col>
          <Col span={8}><Form.Item label="Start date" name="hireDate" rules={[{ required: true }]}><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item label="Probation end" name="probationEndDate"><DatePicker className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item label="Contract end" name="contractEndDate"><DatePicker className="w-full" /></Form.Item></Col>
        </Row>

        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Contact</div>
        <Row gutter={16}>
          <Col span={12}><Form.Item label="Work email" name="workEmail"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Personal email" name="personalEmail"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Work phone" name="phone"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Mobile" name="mobile"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Address line 1" name="addressLine1"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Address line 2" name="addressLine2"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="City" name="city"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Province / State" name="province"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Postal code" name="postalCode"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Country" name="country"><Input /></Form.Item></Col>
        </Row>

        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Payroll & tax</div>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="Base salary / rate" name="basicSalary"><InputNumber prefix="$" className="w-full" /></Form.Item></Col>
          <Col span={8}><Form.Item label="Currency" name="currency" initialValue="USD"><Select options={['USD', 'ZAR', 'ZWG', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))} /></Form.Item></Col>
          <Col span={8}><Form.Item label="Pay frequency" name="payFrequency" initialValue="MONTHLY"><Select options={PAY_FREQ.map((f) => ({ label: f, value: f }))} /></Form.Item></Col>
          <Col span={6}><Form.Item label="Tax ID / TIN" name={['taxDetails', 'tin']}><Input /></Form.Item></Col>
          <Col span={6}><Form.Item label="Tax status" name={['taxDetails', 'taxStatus']}><Select allowClear options={['RESIDENT', 'NON_RESIDENT', 'EXEMPT'].map((t) => ({ label: t, value: t }))} /></Form.Item></Col>
        </Row>

        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Bank details</div>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="Bank" name={['bankDetails', 'bank']}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Account holder" name={['bankDetails', 'accountHolder']}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Account number" name={['bankDetails', 'accountNumber']}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Account type" name={['bankDetails', 'accountType']}><Select allowClear options={['BANK', 'SAVINGS', 'CHEQUE'].map((t) => ({ label: t, value: t }))} /></Form.Item></Col>
          <Col span={8}><Form.Item label="Branch" name={['bankDetails', 'branch']}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Branch code" name={['bankDetails', 'branchCode']}><Input /></Form.Item></Col>
        </Row>
        {bankDetails?.accountNumber && <div className="text-[12px] text-[#8a90ad] mb-2">Account will be masked as •••• {String(bankDetails.accountNumber).slice(-4)}</div>}

        <div className="text-[12px] uppercase tracking-wide text-[#8a90ad] mt-2 mb-2 font-semibold">Emergency contact</div>
        <Row gutter={16}>
          <Col span={8}><Form.Item label="Name" name={['emergencyContact', 'name']}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Relationship" name={['emergencyContact', 'relationship']}><Input /></Form.Item></Col>
          <Col span={8}><Form.Item label="Phone" name={['emergencyContact', 'phone']}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item label="Email" name={['emergencyContact', 'email']}><Input /></Form.Item></Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}><Form.Item label="Status" name="status" initialValue="ACTIVE"><Select options={['ACTIVE', 'ON_LEAVE', 'TERMINATED'].map((t) => ({ label: t, value: t }))} /></Form.Item></Col>
          <Col span={12}><Form.Item label="Active" name="active" valuePropName="checked" initialValue={true}><Checkbox>Active employee</Checkbox></Form.Item></Col>
        </Row>
      </Form>
    </Drawer>
  );
}
