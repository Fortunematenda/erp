'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page';
import { Alert, Button, Card, Descriptions, Input, Space, Tag, message } from 'antd';
import { LockOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';

export default function Security() {
  const status = useQuery({ queryKey: ['/auth/mfa/status'], queryFn: () => api('/auth/mfa/status') });
  const [secret, setSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [mfa, setMfa] = useState(false);

  async function setup() {
    try { const r = await api('/auth/mfa/setup', { method: 'POST' }); setSecret(r.secret); setOtpauth(r.otpauthUrl); message.success('Scan the QR / enter the secret in your authenticator'); } catch (e: any) { message.error(e.message); }
  }
  async function verify() {
    try { await api('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) }); message.success('MFA enabled'); setMfa(true); status.refetch(); } catch (e: any) { message.error(e.message); }
  }
  async function disable() {
    try { await api('/auth/mfa/disable', { method: 'POST' }); message.success('MFA disabled'); setMfa(false); setSecret(''); setOtpauth(''); status.refetch(); } catch (e: any) { message.error(e.message); }
  }
  const enabled = status.data === true || mfa;

  return (
    <>
      <PageHeader title="Security & Authentication" subtitle="Multi-factor authentication, password reset, email verification and session (refresh-token) security." />
      <Alert className="mb-4" type="info" showIcon message="TOTP is RFC 6238 (30s, 6 digits) with the OTP secret stored encrypted. Refresh tokens rotate on every use and are revoked on logout." />
      <div className="space-y-4">
        <Card title="Multi-factor authentication (TOTP)" className="nex-card">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Status"><Tag color={enabled ? 'green' : 'default'}>{enabled ? 'ENABLED' : 'DISABLED'}</Tag></Descriptions.Item>
          </Descriptions>
          <Space wrap className="mt-4">
            {!enabled && <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={setup}>Enable MFA</Button>}
            {enabled && <Button danger icon={<LockOutlined />} onClick={disable}>Disable MFA</Button>}
          </Space>
          {secret && (
            <div className="mt-4 p-4 rounded bg-slate-50">
              <p className="text-[12px] text-slate-500">Add to your authenticator (secret):</p>
              <code className="text-[13px] break-all">{secret}</code>
              {otpauth && <p className="mt-2 text-[12px]">{'[QR/otpauth] '}<span className="text-slate-400 break-all">{otpauth}</span></p>}
              <Space.Compact className="mt-3 w-full max-w-xs"><Input placeholder="Enter 6-digit code" value={code} onChange={(e) => setCode(e.target.value)} /><Button type="primary" onClick={verify}>Verify</Button></Space.Compact>
            </div>
          )}
        </Card>

        <Card title="Session security" className="nex-card" styles={{ body: { padding: 16 } }}>
          <ul className="space-y-2 text-[13px] text-slate-600">
            <li>• Passwords are hashed with bcrypt (cost 12) and never returned by the API.</li>
            <li>• Access tokens expire (JWT); long-lived sessions use <code>POST /auth/refresh</code> which rotates and invalidates the previous token (single-use).</li>
            <li>• <code>POST /auth/logout</code> revokes the refresh token server-side.</li>
            <li>• Password reset (<code>/auth/forgot-password</code> + <code>/auth/reset-password</code>) is token-based, single-use and expires in 30 minutes; resets revoke all sessions.</li>
            <li>• Email verification (<code>/auth/verify-email</code>) is token-based; <code>emailVerifiedAt</code> tracks the verified state.</li>
          </ul>
          <Button className="mt-3" icon={<ReloadOutlined />} onClick={() => { setMfa(false); status.refetch(); }}>Refresh status</Button>
        </Card>
      </div>
    </>
  );
}

