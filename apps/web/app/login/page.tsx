'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Form, Input, Modal, Typography } from 'antd';
import { ApartmentOutlined, InfoCircleOutlined, LockOutlined, MailOutlined, WarningOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { ArrowRight, BadgeCheck, Building2, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import { useSearchParams, useRouter } from 'next/navigation';
import pkg from '../../package.json';

const APP_VERSION: string = pkg?.version || '1.0.0';

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
  const { user, token, status } = useAuth();

  useEffect(() => {
    if (status === 'authenticated' && token) router.replace(user?.isPlatformAdmin ? '/platform' : returnTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, token, user, router]);

  // Keep Form.useForm() inside LoginForm so it is never created while the
  // Form element is unmounted (auth bootstrap / redirect spinner).
  if (status !== 'unauthenticated') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[#f6f8fb]">
        <BrandMark size="large" />
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-[3px] border-[#0757d6] border-t-transparent" />
      </div>
    );
  }

  return <LoginForm returnTo={returnTo} expired={expired} />;
}

function LoginForm({ returnTo, expired }: { returnTo: string; expired: boolean }) {
  const router = useRouter();
  const { setSession, setStatus } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const savedEmail = typeof window !== 'undefined' ? localStorage.getItem('nex-login-email') || '' : '';
  const [remember, setRemember] = useState(!!savedEmail);
  const [caps, setCaps] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotResult, setForgotResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [form] = Form.useForm();
  const emailRef = useRef<any>(null);
  const pwRef = useRef<any>(null);

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

  const label = (t: string) => <span className="text-[13px] font-semibold text-[#344054]">{t}</span>;

  return (
    <main className="relative flex min-h-screen w-full overflow-hidden bg-[#f7f9fc]">
      <section className="relative hidden min-h-screen w-[52%] overflow-hidden bg-[#06152f] text-white lg:block">
        <Image src="/images/nexuserp-login-hero.jpg" alt="" fill priority sizes="52vw" className="object-cover object-center" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,12,31,.42)_0%,rgba(3,12,31,.02)_35%,rgba(3,12,31,.28)_68%,rgba(3,12,31,.9)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_12%,rgba(30,116,255,.2),transparent_38%)]" />

        <div className="relative z-10 flex h-full min-h-screen flex-col justify-between p-8 xl:p-12">
          <BrandHeader light />

          <div className="max-w-[590px] pb-3">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/85 backdrop-blur-md">
              <Sparkles size={14} className="text-[#72d7ff]" />
              One intelligent platform for your entire business
            </div>
            <h2 className="max-w-[560px] text-[40px] font-semibold leading-[1.08] tracking-[-0.035em] xl:text-[50px]">
              Every operation.<br />One clear view.
            </h2>
            <p className="mt-5 max-w-[520px] text-[15px] leading-7 text-white/70 xl:text-[16px]">
              Bring finance, sales, inventory and your teams together in a secure cloud workspace built for decisive growth.
            </p>
            <div className="mt-8 grid max-w-[520px] grid-cols-3 gap-3">
              {[
                ['Real-time', 'Business insight'],
                ['Connected', 'Operations'],
                ['Enterprise', 'Security'],
              ].map(([title, detail]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur-md">
                  <div className="text-[13px] font-semibold">{title}</div>
                  <div className="mt-0.5 text-[11px] text-white/55">{detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-white/45">
            <span>© 2026 NexusERP Cloud Suite</span>
            <span>Trusted business infrastructure · v{APP_VERSION}</span>
          </div>
        </div>
      </section>

      <section className="relative flex min-h-screen flex-1 flex-col">
        <div className="absolute left-5 top-5 lg:hidden">
          <BrandHeader />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-10 pt-28 sm:px-10 lg:px-12 lg:py-10">
          <div className="nex-login w-full max-w-[430px]">
            <div className="mb-9 hidden lg:flex">
              <BrandHeader />
            </div>

            <div>
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#eaf2ff] px-2.5 py-1 text-[11px] font-semibold text-[#0757d6] lg:hidden">
                <BadgeCheck size={13} /> Secure cloud workspace
              </div>
              <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-[#111827] sm:text-[34px]">Access your workspace</h1>
              <p className="mt-2 text-[14px] leading-6 text-[#667085]">Enter your credentials to continue securely.</p>
            </div>

            {error && (
              <div role="alert" className="mt-6 flex items-start gap-2 rounded-xl border border-[#fecaca] bg-[#fff5f5] px-3.5 py-3 text-[#b42318]">
                <WarningOutlined className="mt-[2px] text-[14px]" /><span className="text-[13px]">{error}</span>
              </div>
            )}
            {!error && expired && (
              <div className="mt-6 flex items-start gap-2 rounded-xl border border-[#feecc9] bg-[#fffaeb] px-3.5 py-3 text-[#b54708]">
                <InfoCircleOutlined className="mt-[2px] text-[14px]" /><span className="text-[13px]">Your session has expired. Please sign in again.</span>
              </div>
            )}

            <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} className="mt-8" initialValues={{ email: savedEmail || undefined }}>
              <Form.Item label={label('Work email')} name="email" style={{ marginBottom: 20 }}
                rules={[{ required: true, message: 'Email address is required.' }, { type: 'email', message: 'Enter a valid email address.' }]}>
                <Input ref={emailRef} placeholder="Enter email" size="large" autoComplete="username" prefix={<MailOutlined className="mr-1 text-[16px] text-[#98a2b3]" />} className="!h-[50px] !rounded-xl !border-[#d9e0ea] !bg-white !px-3.5 hover:!border-[#98a2b3] focus:!border-[#0757d6]" />
              </Form.Item>

              <Form.Item label={label('Password')} name="password" style={{ marginBottom: 5 }}
                rules={[{ required: true, message: 'Password is required.' }]}>
                <Input.Password ref={pwRef} placeholder="Enter your password" size="large" autoComplete="current-password" prefix={<LockOutlined className="mr-1 text-[16px] text-[#98a2b3]" />} className="!h-[50px] !rounded-xl !border-[#d9e0ea] !bg-white !px-3.5 hover:!border-[#98a2b3] focus:!border-[#0757d6]"
                  onKeyDown={(e) => { if (e.getModifierState) setCaps(!!e.getModifierState('CapsLock')); }}
                  onBlur={() => setCaps(false)} />
              </Form.Item>
              {caps && (
                <div className="-mt-1 mb-3 flex items-center gap-1.5 text-[12px] text-[#b54708]">
                  <WarningOutlined className="text-[13px]" /> Caps Lock is on
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span className="text-[13px] text-[#475467]">Remember me</span>
                </label>
                <Button type="link" className="!h-auto !px-0 text-[13px] !font-semibold !text-[#0757d6]" onClick={() => { setForgotEmail(form.getFieldValue('email') || ''); setForgotResult(null); setForgotOpen(true); }}>
                  Forgot password?
                </Button>
              </div>

              <Button type="primary" htmlType="submit" block loading={loading} size="large"
                className="group mt-7 !flex !h-[52px] !items-center !justify-center !gap-2 !rounded-xl !border-0 !bg-[#0757d6] !text-[14px] !font-semibold !text-white !shadow-[0_8px_20px_rgba(7,87,214,.22)] hover:!bg-[#064bb8]">
                <span>{loading ? 'Signing in…' : 'Sign in to NexusERP'}</span>
                {!loading && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />}
              </Button>
            </Form>

            <div className="mt-8 flex items-center gap-3 rounded-xl border border-[#e7ebf1] bg-white/70 px-3.5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#edf7f3] text-[#16805d]"><ShieldCheck size={17} /></span>
              <div>
                <div className="text-[12px] font-semibold text-[#344054]">Protected access</div>
                <div className="text-[11px] text-[#98a2b3]">Encrypted and securely managed by your organisation</div>
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between text-[11px] text-[#98a2b3] lg:hidden">
              <span>© 2026 NexusERP</span>
              <span>v{APP_VERSION}</span>
            </div>
          </div>
        </div>

        <div className="hidden items-center justify-between px-10 pb-6 text-[11px] text-[#98a2b3] lg:flex">
          <span>Need help? Contact your workspace administrator.</span>
          <span className="flex items-center gap-1.5"><ShieldCheck size={13} /> Secure organisation access</span>
        </div>
      </section>

      <Modal open={forgotOpen} onCancel={() => setForgotOpen(false)} title="Reset your password" okText="Send reset link" confirmLoading={forgotSending} onOk={sendForgot} destroyOnHidden>
        <Typography.Paragraph type="secondary" className="!mb-4">Enter the email address for your account and we&apos;ll send a password reset link.</Typography.Paragraph>
        <Input size="large" placeholder="name@company.com" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} autoComplete="username" className="nex-login !h-[48px] !rounded-xl" />
        {forgotResult && <div className={`mt-3 text-[13px] rounded-[8px] px-3 py-2 ${forgotResult.type === 'success' ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>{forgotResult.text}</div>}
      </Modal>
    </main>
  );
}

function BrandMark({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  return (
    <div className={`${size === 'large' ? 'h-14 w-14 text-[24px]' : 'h-10 w-10 text-[18px]'} flex items-center justify-center rounded-xl bg-[linear-gradient(135deg,#0b63df,#003366)] text-white shadow-[0_8px_22px_rgba(7,87,214,.24)]`}>
      <ApartmentOutlined />
    </div>
  );
}

function BrandHeader({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      <div className="leading-tight">
        <div className={`text-[16px] font-bold tracking-[-0.02em] ${light ? 'text-white' : 'text-[#101828]'}`}>NexusERP</div>
        <div className={`mt-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${light ? 'text-white/55' : 'text-[#98a2b3]'}`}>
          <Building2 size={10} /> Cloud Suite
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return <Suspense fallback={null}><LoginCard /></Suspense>;
}
