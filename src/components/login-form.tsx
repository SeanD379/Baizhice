'use client';
import { withBasePath } from '@/lib/base-path';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { loginReturnPath } from '@/lib/login-navigation';
import { notifyAuthChanged } from '@/lib/workspace-storage';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { LoginArtwork } from './login-artwork';
import { useAppReducedMotion } from './user-preferences';
import { validateLoginFields, type LoginErrors, type LoginFieldName, type LoginMode, type LoginValues } from '@/lib/login-validation';
import '@/app/login/login.css';

type LoginFieldProps = {
  name: LoginFieldName; label: string; type: 'text' | 'email' | 'password'; autoComplete: string; placeholder: string; hint?: string;
  value: string; error?: string; disabled: boolean; attempt: number; mode: LoginMode; reducedMotion: boolean;
  onChange: (value: string) => void; onBlur: () => void; onComposition: (active: boolean, value: string) => void;
};
function LoginField({ name, label, type, autoComplete, placeholder, hint, value, error, disabled, attempt, mode, reducedMotion, onChange, onBlur, onComposition }: LoginFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const input = useRef<HTMLInputElement>(null), frame = useRef<HTMLDivElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const invalid = !!error, id = `login-${name === 'confirmPassword' ? 'confirm-password' : name}`;
  const messageId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  useLayoutEffect(() => { setRevealed(false); selection.current = null; }, [mode, disabled]);
  useLayoutEffect(() => {
    if (selection.current && input.current === document.activeElement) input.current?.setSelectionRange(selection.current.start, selection.current.end);
    selection.current = null;
  }, [revealed]);
  useEffect(() => {
    if (!invalid || !frame.current?.animate) return;
    const animation = reducedMotion
      ? frame.current.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 120 })
      : frame.current.animate([0, -4, 4, -3, 3, 0].map(x => ({ transform: `translateX(${x}px)` })), { duration: 280, easing: 'ease-in-out' });
    return () => animation.cancel();
  }, [invalid, attempt, reducedMotion]);
  return <div className="login-field" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlur(); }}>
    <label className="login-label" htmlFor={id}>{label}</label>
    <div ref={frame} className="login-input-shell" data-invalid={invalid}>
      <input ref={input} id={id} name={name} type={type === 'password' && revealed ? 'text' : type} autoComplete={autoComplete} placeholder={placeholder} required disabled={disabled} value={value}
        className={type === 'password' ? 'login-password-input' : undefined} aria-invalid={invalid} aria-describedby={messageId} spellCheck={false} autoCapitalize="none"
        onChange={event => onChange(event.target.value)} onCompositionStart={event => onComposition(true, event.currentTarget.value)} onCompositionEnd={event => onComposition(false, event.currentTarget.value)}/>
      {type === 'password' && <button type="button" className="login-password-toggle" aria-label={`${revealed ? '隐藏' : '显示'}${label}`} aria-pressed={revealed} title={`${revealed ? '隐藏' : '显示'}${label}`} disabled={disabled}
        onPointerDown={event => event.preventDefault()} onClick={() => {
          const node = input.current;
          selection.current = node && document.activeElement === node && node.selectionStart !== null ? { start: node.selectionStart, end: node.selectionEnd ?? node.selectionStart } : null;
          setRevealed(current => !current);
        }}>{revealed ? <EyeOff size={19} aria-hidden="true"/> : <Eye size={19} aria-hidden="true"/>}</button>}
    </div>
    {(error || hint) && <p id={messageId} className={error ? 'login-field-message login-field-error' : 'login-field-message login-field-hint'} role={error ? 'alert' : undefined}>{error || hint}</p>}
  </div>;
}
export function LoginForm({ available, disabledMessage = '当前环境未启用登录' }: { available: boolean; disabledMessage?: string }) {
  const [mode, setMode] = useState<LoginMode>('login');
  const [values, setValues] = useState<LoginValues>({ email: '', password: '', nickname: '', confirmPassword: '' });
  const [touched, setTouched] = useState<Partial<Record<LoginFieldName, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<LoginErrors>({}), [attempt, setAttempt] = useState(0);
  const [composing, setComposing] = useState<LoginFieldName | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const reducedMotion = useAppReducedMotion();
  const [pending, setPending] = useState<'login' | 'register' | 'guest' | null>(null), [error, setError] = useState('');
  const busy = pending !== null;
  const validation = validateLoginFields(mode, values);
  useEffect(() => {
    const timer = window.setTimeout(() => setTouched(previous => {
      const next = { ...previous };
      for (const name of Object.keys(values) as LoginFieldName[]) if (values[name] && composing !== name) next[name] = true;
      return next;
    }), 400);
    return () => window.clearTimeout(timer);
  }, [values, composing, mode]);
  const field = (name: LoginFieldName, label: string, type: LoginFieldProps['type'], autoComplete: string, placeholder: string, hint?: string) => <LoginField key={name}
    name={name} label={label} type={type} autoComplete={autoComplete} placeholder={placeholder} hint={hint} value={values[name]} error={touched[name] && composing !== name ? validation[name] || serverErrors[name] : undefined}
    disabled={!available || busy} attempt={attempt} mode={mode} reducedMotion={reducedMotion}
    onChange={value => { setValues(previous => ({ ...previous, [name]: value })); setServerErrors(previous => ({ ...previous, [name]: undefined })); }}
    onBlur={() => { if (!composing) setTouched(previous => ({ ...previous, [name]: true })); }}
    onComposition={(active, value) => { setComposing(active ? name : null); if (!active) setValues(previous => ({ ...previous, [name]: value })); }}/>;

  async function authenticate(action: 'login' | 'register' | 'guest') {
    if (!available || busy) return;
    setPending(action); setError('');
    try {
      const endpoint = action === 'guest' ? 'sign-in/guest' : action === 'register' ? 'sign-up/email' : 'sign-in/email';
      const email = values.email.trim(), password = values.password;
      const body = action === 'guest' ? {} : action === 'register' ? { name: values.nickname.trim(), email, password, rememberMe: true } : { email, password, rememberMe: true };
      const response = await fetch(withBasePath(`/api/auth/${endpoint}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) {
        let message = '登录服务暂不可用，请稍后重试。';
        if (response.status === 404) message = '当前环境未启用登录';
        else if (response.status === 429) message = action === 'login' ? '登录尝试过于频繁，请稍后重试。' : '操作过于频繁，请稍后重试。';
        else if (action === 'register' && [409, 422].includes(response.status)) message = '该邮箱已注册，请直接登录或使用其他邮箱。';
        else if (action === 'register' && response.status === 403) {
          const data = await response.json().catch(() => null);
          message = typeof data?.message === 'string' ? data.message : typeof data?.error?.message === 'string' ? data.error.message : '此邮箱暂不可用于注册，请使用其他邮箱。';
        } else if (action === 'login' && [400, 401, 403].includes(response.status)) message = '账号或密码不正确，请重新输入。';
        else if (action === 'register' && response.status === 400) {
          const data = await response.json().catch(() => null);
          if (typeof data?.fields?.password === 'string') { setServerErrors({ password: data.fields.password }); setPending(null); return; }
          message = '注册信息有误，请检查后重试。';
        }
        setError(message); setPending(null); return;
      }
      notifyAuthChanged();
      location.replace(loginReturnPath(new URLSearchParams(location.search).get('next')));
    } catch { setError('网络暂不可用，请检查连接后重试。'); setPending(null); }
  }
  return <main className="private-login"><div className="login-layout">
    <section className="login-hero" aria-label="百知册">
      <div className="login-brand"><img className="brand-logo" src={withBasePath("/brand/baizhice-symbol-blue.png")} alt="" width={42} height={42}/><span>百知册</span></div>
      <h1 className="login-headline">把零散资料，<br/><strong>学成完整知识。</strong></h1>
      <div className="login-orbit login-orbit-one" aria-hidden="true"/><div className="login-orbit login-orbit-two" aria-hidden="true"/>
      <div className="login-artwork-stage"><LoginArtwork/></div>
      <span className="login-accent-dot" aria-hidden="true"/>
    </section>
    <section className="login-form-panel" aria-labelledby="login-title"><div className="login-form-content" data-mode={mode}>
      <h2 id="login-title">{mode === 'register' ? '创建账号' : '欢迎回来'}</h2>
      <div className="login-modes" role="group" aria-label="账号操作">
        {(['login', 'register'] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} disabled={!available || busy} onClick={() => { setMode(item); setTouched({}); setServerErrors({}); setError(''); }}>{item === 'login' ? '登录' : '注册'}</button>)}
      </div>
      {!available && <p className="login-status" role="status">{disabledMessage}</p>}
      <form ref={form} aria-busy={busy} noValidate onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) { event.preventDefault(); event.stopPropagation(); } }} onSubmit={async event => {
        event.preventDefault(); if (!available || busy || composing) return;
        setTouched({ nickname: true, email: true, password: true, confirmPassword: true }); setAttempt(current => current + 1); setError(''); setServerErrors({});
        const invalid = (Object.keys(validation) as LoginFieldName[]).find(name => !!validation[name]);
        if (invalid) { form.current?.querySelector<HTMLInputElement>(`input[name="${invalid}"]`)?.focus(); return; }
        await authenticate(mode);
      }}>
        {mode === 'register' && field('nickname', '昵称', 'text', 'nickname', '1–20 个字符')}
        {field('email', '邮箱', 'email', mode === 'register' ? 'email' : 'username', '请输入邮箱')}
        {field('password', '密码', 'password', mode === 'register' ? 'new-password' : 'current-password', mode === 'register' ? '至少 8 位，包含至少 3 类字符' : '请输入密码', mode === 'register' ? '8–128 位，大写/小写/数字/特殊符号至少 3 类' : undefined)}
        {mode === 'register' && field('confirmPassword', '确认密码', 'password', 'new-password', '请再次输入密码')}
        {error && <p className="login-error" role="alert">{error}</p>}
        <Button className="login-submit" variant="primary" disabled={!available || busy} type="submit"><span>{pending === mode ? mode === 'register' ? '正在创建…' : '正在登录…' : mode === 'register' ? '创建账号' : '登录百知册'}</span><ArrowRight size={18} aria-hidden="true"/></Button>
      </form>
      <div className="login-guest-entry">
        <Button className="login-guest" type="button" disabled={!available || busy} onClick={() => authenticate('guest')}>{pending === 'guest' ? '正在进入…' : '访客体验'}</Button>
      </div>
    </div></section>
  </div></main>;
}
