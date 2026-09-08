'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Typography } from 'antd';
import { AccountBookOutlined, ApartmentOutlined, AppstoreOutlined, InfoCircleOutlined, LockOutlined, MailOutlined, ProjectOutlined, SafetyOutlined, ShopOutlined, SolutionOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useSearchParams, useRouter } from 'next/navigation';
import pkg from '../../package.json';

const BRAND_BG = '#003366';
const APP_VERSION: string = pkg?.version || '1.0.0';

const MODULES = [
  { icon: <AccountBookOutlined />, label: 'Finance' },
  { icon: <SolutionOutlined />, label: 'Sales' },
  { icon: <ShopOutlined />, label: 'Procurement' },
  { icon: <AppstoreOutlined />, label: 'Inventory' },
  { icon: <ProjectOutlined />, label: 'Projects' },
  { icon: <TeamOutlined />, label: 'Payroll' },
];

function safeReturnTo(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return '/dashboard';
  return raw;
}

function mapAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('authentication required') || m.includes('invalid credentials') || m.includes('unauthorized') || m.includes('incorrect')) return 'Email or password is incorrect.';
  if (m.includes('disabled') || m.includes('inactive')) return 'Your account is inactive. Contact your administrator.';
  if (m.includes('no company')) return 'Your account does not have access to any company.';
  return 'Unable to sign in. Please try again.';
}

function LoginCard() {
  const router = useRouter();
  const sp = useSearchParams();
  const returnTo = safeReturnTo(sp.get('returnTo'));
  const expired = sp.get('expired') === '1';
  const { user, token, status, setSession, setStatus } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const [caps, setCaps] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form] = Form.useForm();
  const emailRef = useRef<any>(null);
  const pwRef = useRef<any>(null);

  useEffect(() => {
    if (status === 'authenticated' && token) router.replace(user?.isPlatformAdmin ? '/platform' : returnTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token, user, router]);

  // Only touch the form once it is actually mounted (status becomes
  // 'unauthenticated' and the <Form> renders). Calling form methods earlier
  // triggers the "not connected to any Form element" warning.
  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const saved = localStorage.getItem('nex-login-email');
    if (saved) { form.setFieldsValue({ email: saved }); setRemember(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== 'unauthenticated') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5" style={{ background: '#f6f7f9' }}>
        <div className="w-14 h-14 rounded-2xl brand-gradient flex items-center justify-center text-white text-2xl" style={{ boxShadow: '0 6px 16px rgba(0,51,102,0.26)' }}><ApartmentOutlined /></div>
        <span className="inline-block w-6 h-6 rounded-full border-[3px] border-[#003366] border-t-transparent animate-spin" />
      </div>
    );
  }

  async function submit(v: any) {
    if (loading) return;
    setError('');
    try {
      setLoading(true);
      // Read the credentials from the actual input elements (authoritative),
      // so browser autofill / React state can never diverge from what is shown.
      // Email is normalized (trim + lowercase) because the backend lookup is
      // case-sensitive. The password is submitted EXACTLY as typed.
      const rawEmail = emailRef.current?.input?.value ?? emailRef.current?.value ?? v?.email ?? '';
      const rawPassword = pwRef.current?.input?.value ?? pwRef.current?.value ?? v?.password ?? '';
      const email = String(rawEmail).trim().toLowerCase();
      const password = String(rawPassword);
      const r: any = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (r.requiresMfa) { setError('Two-factor authentication is required.'); return; }
      const activeId = r.activeCompany?.id || r.companies?.[0]?.id || null;
      setSession({ token: r.token, user: r.user, companies: r.companies || [], activeCompanyId: activeId, lastCompanyId: activeId, permissions: r.permissions || [], roles: r.roles || [] });
      setStatus('authenticated');
      router.replace(r.user.isPlatformAdmin ? '/platform' : returnTo);
      if (remember && email) localStorage.setItem('nex-login-email', email);
      else localStorage.removeItem('nex-login-email');
    } catch (e: any) {
      // Never surface raw backend / network text to the user.
      if (process.env.NODE_ENV !== 'production') console.error('Login failed:', e);
      setError(mapAuthError(e?.message || ''));
    }
    finally { setLoading(false); }
  }

  async function sendForgot() {
    if (!forgotEmail) return;
    setForgotSending(true); setForgotResult(null);
    try {
      const r: any = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: forgotEmail }) });
      setForgotResult({ type: 'success', text: r?.message || 'Reset token issued. Check your email.' });
    } catch (e: any) {
      setForgotResult({ type: 'error', text: e?.message?.toLowerCase().includes('invalid') ? 'No account found for that email.' : 'Unable to send reset link. Please try again.' });
    } finally { setForgotSending(false); }
  }

  const label = (t: string) => <span className="text-[13px] font-medium" style={{ color: '#344054' }}>{t}</span>;

  return (
    <main className="min-h-screen w-full flex" style={{ background: '#f6f7f9' }}>
      {/* ---- Brand panel (desktop) ---- */}
      <section className="hidden lg:flex w-[46%] flex-col justify-between text-white p-10 xl:p-14" style={{ background: BRAND_BG }}>
        <BrandHeader />
        <div>
          <BrandCopy />
          <ModuleVisual />
        </div>
        <div className="flex items-center justify-between text-[12px] text-white/55">
          <span>© 2026 NexusERP Cloud Suite</span>
          <span>v{APP_VERSION}</span>
        </div>
      </section>

      {/* ---- Login panel ---- */}
      <section className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="nex-login w-full" style={{ maxWidth: 480 }}>
          <div className="bg-white border border-[#E7EBF0] rounded-[16px] w-full p-[28px_30px_26px] sm:p-[32px_36px_30px]" style={{ boxShadow: '0 8px 30px rgba(16,24,40,0.06)' }}>
            {/* Compact brand header */}
            <div className="flex flex-col items-center text-center">
              <div className="w-11 h-11 rounded-2xl brand-gradient flex items-center justify-center text-white text-[22px]" style={{ boxShadow: '0 6px 16px rgba(0,51,102,0.26)' }}>
                <ApartmentOutlined />
              </div>
              <div className="mt-2.5 font-bold text-[17px] tracking-tight" style={{ color: '#101828' }}>NexusERP</div>
              <div className="text-[11px] font-medium mt-0.5" style={{ color: '#667085' }}>Cloud Suite</div>
            </div>

            {/* Intro */}
            <div className="text-center mt-4">
              <h1 className="text-[19px] font-semibold leading-tight" style={{ color: '#101828' }}>Sign in to your workspace</h1>
              <p className="text-[13px] mt-1" style={{ color: '#667085' }}>Use your organisation account to continue.</p>
            </div>

            {/* Alerts */}
            {error && (
              <div role="alert" className="flex items-start gap-2 mt-5 mb-1 rounded-[8px] px-3 py-2.5" style={{ background: '#FFF5F5', border: '1px solid #FED7D7', color: '#B42318' }}>
                <WarningOutlined className="mt-[2px] text-[14px]" /><span className="text-[13px]">{error}</span>
              </div>
            )}
            {!error && expired && (
              <div className="flex items-start gap-2 mt-5 mb-1 rounded-[8px] px-3 py-2.5" style={{ background: '#FFFAEB', border: '1px solid #FEECC9', color: '#B54708' }}>
                <InfoCircleOutlined className="mt-[2px] text-[14px]" /><span className="text-[13px]">Your session has expired. Please sign in again.</span>
              </div>
            )}

            <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} className="mt-4">
              <Form.Item label={label('Email address')} name="email" style={{ marginBottom: 18 }}
                rules={[{ required: true, message: 'Email address is required.' }, { type: 'email', message: 'Enter a valid email address.' }]}>
                <Input ref={emailRef} placeholder="name@company.com" size="large" autoComplete="username" prefix={<MailOutlined style={{ color: '#667085', fontSize: 16 }} />} className="!h-[48px] !rounded-[10px]" />
              </Form.Item>

              <Form.Item label={label('Password')} name="password" style={{ marginBottom: 4 }}
                rules={[{ required: true, message: 'Password is required.' }]}>
                <Input.Password ref={pwRef} placeholder="Enter your password" size="large" autoComplete="current-password" prefix={<LockOutlined style={{ color: '#667085', fontSize: 16 }} />} className="!h-[48px] !rounded-[10px]"
                  onKeyDown={(e) => { if (e.getModifierState) setCaps(!!e.getModifierState('CapsLock')); }}
                  onBlur={() => setCaps(false)} />
              </Form.Item>
              {caps && (
                <div className="flex items-center gap-1.5 -mt-1 mb-3 text-[12px]" style={{ color: '#B54708' }}>
                  <WarningOutlined className="text-[13px]" /> Caps Lock is on
                </div>
              )}

              <div className="flex items-center justify-between mt-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="text-[13px]" style={{ color: '#344054' }}>Keep me signed in</span>
                </label>
                <Button type="link" className="!px-0 !h-auto text-[13px] font-medium" style={{ color: '#175CD3' }} onClick={() => { setForgotEmail(form.getFieldValue('email') || ''); setForgotResult(null); setForgotOpen(true); }}>
                  Forgot password?
                </Button>
              </div>

              <Button type="primary" htmlType="submit" block loading={loading} size="large"
                className="!h-[48px] !rounded-[10px] !text-[14px] !font-semibold mt-[22px] !text-white hover:!bg-[#0b4a8f]"
                style={{ background: '#003366' }}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </Form>

            {/* Security footer */}
            <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-[#EEF0F3]">
              <SafetyOutlined className="text-[13px]" style={{ color: '#98A2B3' }} />
              <span className="text-[12px]" style={{ color: '#98A2B3' }}>Secure organisation access</span>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 px-2 text-[12px]" style={{ color: '#98A2B3' }}>
            <span>© 2026 NexusERP Cloud Suite</span>
            <span>v{APP_VERSION}</span>
          </div>
        </div>
      </section>

      <Modal open={forgotOpen} onCancel={() => setForgotOpen(false)} title="Reset your password" okText="Send reset link" confirmLoading={forgotSending} onOk={sendForgot} destroyOnHidden>
        <Typography.Paragraph type="secondary" className="!mb-4">Enter the email address for your account and we&apos;ll send a password reset link.</Typography.Paragraph>
        <Input size="large" placeholder="name@company.com" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} autoComplete="username" className="nex-login !h-[48px] !rounded-[10px]" />
        {forgotResult && <div className={`mt-3 text-[13px] rounded-[8px] px-3 py-2 ${forgotResult.type === 'success' ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>{forgotResult.text}</div>}
      </Modal>
    </main>
  );
}

function BrandHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-2xl brand-gradient flex items-center justify-center text-white text-lg" style={{ boxShadow: '0 6px 16px rgba(0,51,102,0.26)' }}>
        <ApartmentOutlined />
      </div>
      <div className="leading-tight">
        <div className="font-bold text-[15.5px] tracking-tight">NexusERP</div>
        <div className="text-[11px] font-medium mt-0.5 text-white/70">Cloud Suite</div>
      </div>
    </div>
  );
}
function BrandCopy() {
  return (
    <div className="max-w-md">
      <h2 className="text-[34px] leading-[1.18] font-semibold tracking-tight">Run your business<br />with clarity.</h2>
      <p className="mt-5 text-[15px] leading-relaxed text-white/75">Finance, sales, procurement, inventory, projects and operations — connected in one platform.</p>
    </div>
  );
}
function ModuleVisual() {
  return (
    <div className="mt-10 max-w-md rounded-2xl border border-white/15 bg-white/[0.06] p-5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/55 mb-4">Everything, connected</div>
      <div className="grid grid-cols-2 gap-3">
        {MODULES.map((m) => (
          <div key={m.label} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] text-white/85">
            <span className="text-[15px]">{m.icon}</span> {m.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Login() {
  return <Suspense fallback={null}><LoginCard /></Suspense>;
}
