'use client';
import { useState } from 'react';
import { Button } from './ui/button';
export function LoginForm() {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <main className="private-login"><div><img className="brand-logo" src="/brand/baizhice-symbol-blue.png" alt="" width={64} height={64}/><h1>百知册</h1><p>把零散资料，学成完整知识。</p><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, rememberMe: true }) });
      if (!response.ok) throw new Error(response.status === 503 ? '登录服务尚未配置。' : '账号或密码不正确，请重新输入。');
      const next = new URLSearchParams(location.search).get('next'); location.href = next?.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (reason) { setError(reason instanceof Error ? reason.message : '网络暂不可用'); setBusy(false); }
  }}><label className="notebook-form-label">私人账号<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)}/></label><label className="notebook-form-label">密码<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <p role="alert">{error}</p>}<Button variant="primary" disabled={busy} type="submit">{busy ? '正在登录…' : '登录百知册'}</Button></form></div></main>;
}
