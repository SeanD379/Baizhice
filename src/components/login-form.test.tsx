// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoginForm } from './login-form';

let root: Root, container: HTMLDivElement;
const replace = vi.fn();
beforeEach(() => {
  window.localStorage.removeItem('lms.auth-session-change');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('location', { search: `?next=${encodeURIComponent('/?course=c1&chat=q1&settings=profile')}`, replace });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function submit() {
  await act(async () => {
    for (const [selector, value] of [['input[type=email]', 'learner@example.com'], ['input[type=password]', 'test-password']]) {
      const input = container.querySelector<HTMLInputElement>(selector)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

async function setFields(values: Record<string, string>) {
  await act(async () => {
    for (const [name, value] of Object.entries(values)) {
      const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

function button(label: string) {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent === label);
  expect(result, `missing button: ${label}`).toBeDefined();
  return result!;
}

async function registerMode() {
  await act(async () => button('注册').click());
}

async function submitForm() {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

it('disables submission and gives a clear explanation when login is unavailable', async () => {
  await act(async () => root.render(<LoginForm available={false}/>));
  expect(container.textContent).toContain('当前环境未启用登录');
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
  await submit();
  expect(fetch).not.toHaveBeenCalled();
});

it('uses the existing password endpoint and returns to settings after success', async () => {
  await act(async () => root.render(<LoginForm available/>));
  await submit();
  expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/email', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'learner@example.com', password: 'test-password', rememberMe: true }) }));
  expect(replace).toHaveBeenCalledWith('/?course=c1&chat=q1&settings=profile');
});

it.each([[401, '账号或密码不正确'], [404, '当前环境未启用登录'], [429, '登录尝试过于频繁'], [500, '登录服务暂不可用'], [503, '登录服务暂不可用']])('reports a login failure accurately: %s', async (status, message) => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: status as number }));
  await act(async () => root.render(<LoginForm available/>));
  await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(message);
  expect(replace).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
});
it('distinguishes a temporarily unavailable service from a disabled environment', async () => {
  await act(async () => root.render(<LoginForm available={false} disabledMessage="登录服务暂不可用，请稍后重试。"/>));
  expect(container.querySelector('[role=status]')?.textContent).toBe('登录服务暂不可用，请稍后重试。');
  expect(container.textContent).not.toContain('当前环境未启用登录');
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
});

it('switches between login and registration without changing the hero', async () => {
  await act(async () => root.render(<LoginForm available/>));
  const hero = container.querySelector('.login-hero');
  await registerMode();
  expect(container.querySelector('h2')?.textContent).toBe('创建账号');
  expect(container.querySelector('input[name="nickname"]')).not.toBeNull();
  expect(container.querySelector('input[name="confirmPassword"]')?.getAttribute('autocomplete')).toBe('new-password');
  expect(container.querySelector('.login-hero')).toBe(hero);
  expect(button('注册').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('登录').click());
  expect(container.querySelector('h2')?.textContent).toBe('欢迎回来');
  expect(container.querySelector('input[name="nickname"]')).toBeNull();
  expect(container.querySelector('input[name="password"]')?.getAttribute('autocomplete')).toBe('current-password');
});

it.each([
  [{ nickname: '   ' }, '昵称'],
  [{ nickname: '一'.repeat(21) }, '昵称'],
  [{ email: 'not-an-email' }, '邮箱'],
  [{ password: 'short', confirmPassword: 'short' }, '8'],
  [{ password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }, '128'],
  [{ confirmPassword: 'different-password' }, '两次'],
])('rejects invalid registration before sending a request: %j', async (invalid, message) => {
  await act(async () => root.render(<LoginForm available/>));
  await registerMode();
  await setFields({ nickname: '同学', email: 'learner@example.com', password: 'New-password-123', confirmPassword: 'New-password-123', ...invalid });
  await submitForm();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(message);
  expect(fetch).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(false);
});

it('registers a trimmed nickname and returns to the requested page', async () => {
  await act(async () => root.render(<LoginForm available/>));
  await registerMode();
  await setFields({ nickname: '  同学  ', email: 'learner@example.com', password: 'New-password-123', confirmPassword: 'New-password-123' });
  await submitForm();
  expect(fetch).toHaveBeenCalledWith('/api/auth/sign-up/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '同学', email: 'learner@example.com', password: 'New-password-123', rememberMe: true }),
  });
  expect(replace).toHaveBeenCalledWith('/?course=c1&chat=q1&settings=profile');
});

it('opens a temporary guest workspace independently of invalid account fields', async () => {
  await act(async () => root.render(<LoginForm available/>));
  await registerMode();
  await setFields({ email: 'invalid', password: 'short' });
  const guest = button('访客体验');
  expect(guest.closest('form')).toBeNull();
  expect(container.textContent).not.toContain('内容仅供临时体验，2 小时后失效');
  await act(async () => guest.click());
  expect(fetch).toHaveBeenCalledWith('/api/auth/sign-in/guest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(replace).toHaveBeenCalledWith('/?course=c1&chat=q1&settings=profile');
});

it('disables every action while a guest request is pending', async () => {
  let resolveRequest!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));
  await act(async () => root.render(<LoginForm available/>));
  await act(async () => button('访客体验').click());
  expect(Array.from(container.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')).every(control => control.disabled)).toBe(true);
  await submitForm();
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => resolveRequest(new Response('{}', { status: 503 })));
  expect(button('访客体验').disabled).toBe(false);
});

it.each([409, 422])('reports duplicate email safely and preserves registration input: %s', async status => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{"message":"internal database detail"}', { status }));
  await act(async () => root.render(<LoginForm available/>));
  await registerMode();
  await setFields({ nickname: '同学', email: 'learner@example.com', password: 'New-password-123', confirmPassword: 'New-password-123' });
  await submitForm();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('邮箱已注册');
  expect(container.textContent).not.toContain('internal database detail');
  expect(container.querySelector<HTMLInputElement>('input[name="nickname"]')?.value).toBe('同学');
  expect(container.querySelector<HTMLInputElement>('input[name="password"]')?.value).toBe('New-password-123');
  await submitForm();
  expect(replace).toHaveBeenCalledWith('/?course=c1&chat=q1&settings=profile');
});

it('shows the reserved owner account explanation returned by the server', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: '此邮箱为管理员保留，请使用其他邮箱注册。' }), { status: 403 }));
  await act(async () => root.render(<LoginForm available/>));
  await registerMode();
  await setFields({ nickname: '同学', email: 'owner@example.com', password: 'New-password-123', confirmPassword: 'New-password-123' });
  await submitForm();
  expect(container.querySelector('[role=alert]')?.textContent).toBe('此邮箱为管理员保留，请使用其他邮箱注册。');
  expect(replace).not.toHaveBeenCalled();
});

it('localizes network errors and allows a guest retry after a login failure', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async () => root.render(<LoginForm available/>));
  await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toContain('网络暂不可用');
  expect(container.textContent).not.toContain('Failed to fetch');
  expect(container.querySelector<HTMLInputElement>('input[name="email"]')?.value).toBe('learner@example.com');
  await act(async () => button('访客体验').click());
  expect(replace).toHaveBeenCalledWith('/?course=c1&chat=q1&settings=profile');
  expect(container.querySelector('[role=alert]')).toBeNull();
});

it.each([[429, '操作过于频繁'], [503, '服务暂不可用']])('reports guest errors and re-enables the guest action: %s', async (status, message) => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: status as number }));
  await act(async () => root.render(<LoginForm available/>));
  await act(async () => button('访客体验').click());
  expect(container.querySelector('[role=alert]')?.textContent).toContain(message);
  expect(button('访客体验').disabled).toBe(false);
  expect(replace).not.toHaveBeenCalled();
});

it.each(['login', 'register', 'guest'])('notifies other tabs before navigating after %s succeeds', async action => {
  let notifiedBeforeNavigation = false;
  replace.mockImplementationOnce(() => {
    const message = JSON.parse(window.localStorage.getItem('lms.auth-session-change') || 'null');
    notifiedBeforeNavigation = typeof message?.id === 'string' && typeof message?.source === 'string';
  });
  await act(async () => root.render(<LoginForm available/>));
  if (action === 'guest') await act(async () => button('访客体验').click());
  else if (action === 'register') {
    await registerMode();
    await setFields({ nickname: '同学', email: 'learner@example.com', password: 'New-password-123', confirmPassword: 'New-password-123' });
    await submitForm();
  } else await submit();
  expect(notifiedBeforeNavigation).toBe(true);
});

it('reveals and masks passwords without replacing the input or submitting the form', async () => {
  await act(async () => root.render(<LoginForm available/>));
  await setFields({ password: 'existing-secret' });
  const input = container.querySelector<HTMLInputElement>('#login-password')!;
  await act(async () => { input.focus(); input.setSelectionRange(2, 5); });
  const reveal = container.querySelector<HTMLButtonElement>('[aria-label="显示密码"]');
  expect(reveal).not.toBeNull();
  await act(async () => reveal!.click());
  expect(container.querySelector('#login-password')).toBe(input);
  expect(input.type).toBe('text'); expect(input.value).toBe('existing-secret');
  expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="隐藏密码"]')!.click());
  expect(input.type).toBe('password'); expect(fetch).not.toHaveBeenCalled();
});
it('provides independent confirmation visibility and masks it again when switching modes', async () => {
  await act(async () => root.render(<LoginForm available/>)); await registerMode();
  await setFields({ password: 'New-password-123', confirmPassword: 'New-password-123' });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="显示确认密码"]')!.click());
  expect(container.querySelector<HTMLInputElement>('#login-confirm-password')!.type).toBe('text');
  expect(container.querySelector<HTMLInputElement>('#login-password')!.type).toBe('password');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!.click());
  await act(async () => button('登录').click());
  expect(container.querySelector<HTMLInputElement>('#login-password')!.type).toBe('password');
});
it.each(['learner@example', 'learner@example.', 'learner@example.c', 'learner@.com'])('shows an associated email error and clears it immediately when corrected: %s', async email => {
  await act(async () => root.render(<LoginForm available/>)); await setFields({ email });
  const input = container.querySelector<HTMLInputElement>('#login-email')!;
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(input.getAttribute('aria-invalid')).toBe('true');
  const message = document.getElementById(input.getAttribute('aria-describedby')!);
  expect(message?.textContent).toContain('邮箱');
  expect(message?.closest('.login-field')?.contains(input)).toBe(true);
  await setFields({ email: 'learner+notes@example.com.cn' });
  expect(input.getAttribute('aria-invalid')).toBe('false');
  expect(container.querySelector('.login-field-error')).toBeNull();
});
it('validates every empty login field inline without using native browser popups', async () => {
  await act(async () => root.render(<LoginForm available/>)); await submitForm();
  expect(container.querySelector('form')?.noValidate).toBe(true);
  expect(container.querySelector('#login-email')?.getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector('#login-password')?.getAttribute('aria-invalid')).toBe('true');
  expect(fetch).not.toHaveBeenCalled();
});
it('explains missing password classes inline and clears the error after a valid eight-character correction', async () => {
  await act(async () => root.render(<LoginForm available/>)); await registerMode();
  await setFields({ nickname: '同学', email: 'learner@example.com', password: 'abcde123', confirmPassword: 'abcde123' });
  await submitForm(); expect(fetch).not.toHaveBeenCalled();
  expect(container.querySelector('#login-password')?.getAttribute('aria-invalid')).toBe('true');
  expect(container.querySelector('#login-password-error')?.textContent).toBe('还需 1 类：大写/符号。');
  await setFields({ password: 'Abcdef12', confirmPassword: 'Abcdef12' });
  expect(container.querySelector('#login-password')?.getAttribute('aria-invalid')).toBe('false');
  expect(container.querySelector('#login-password-error')).toBeNull();
  await submitForm(); expect(fetch).toHaveBeenCalledOnce();
});
it('revalidates confirmation when the password changes after matching', async () => {
  await act(async () => root.render(<LoginForm available/>)); await registerMode();
  await setFields({ password: 'New-password-123', confirmPassword: 'New-password-123' });
  const confirmation = container.querySelector<HTMLInputElement>('#login-confirm-password')!;
  await act(async () => confirmation.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  await setFields({ password: 'another-new-password' });
  expect(confirmation.getAttribute('aria-invalid')).toBe('true');
  await setFields({ confirmPassword: 'another-new-password' });
  expect(confirmation.getAttribute('aria-invalid')).toBe('false');
});
it('does not submit during Chinese composition', async () => {
  await act(async () => root.render(<LoginForm available/>)); await registerMode();
  await setFields({ nickname: '同学', email: 'learner@example.com', password: 'New-password-123', confirmPassword: 'New-password-123' });
  const input = container.querySelector<HTMLInputElement>('#login-nickname')!;
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await submitForm(); expect(fetch).not.toHaveBeenCalled();
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await submitForm(); expect(fetch).toHaveBeenCalledOnce();
});

