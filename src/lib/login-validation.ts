import { z } from 'zod';

export const minimumRegistrationPasswordLength = 8;
export const maximumPasswordLength = 128;
export type LoginMode = 'login' | 'register';
export type LoginFieldName = 'nickname' | 'email' | 'password' | 'confirmPassword';
export type LoginValues = Record<LoginFieldName, string>;
export type LoginErrors = Partial<Record<LoginFieldName, string>>;
const emailSchema = z.email();

export function registrationPasswordError(password: string): string | undefined {
  const length = Array.from(password).length;
  if (!length) return '请输入密码。';
  if (length < minimumRegistrationPasswordLength) return `至少 8 位，还差 ${minimumRegistrationPasswordLength - length} 位。`;
  if (length > maximumPasswordLength) return `最多 128 位，请减少 ${length - maximumPasswordLength} 位。`;
  const classes = [['大写', /[A-Z]/], ['小写', /[a-z]/], ['数字', /[0-9]/], ['符号', /[\p{P}\p{S}]/u]] as const;
  const missing = classes.filter(([, pattern]) => !pattern.test(password)).map(([label]) => label);
  if (missing.length > 1) return `还需 ${missing.length - 1} 类：${missing.join('/')}。`;
}

export function validateLoginFields(mode: LoginMode, values: LoginValues): LoginErrors {
  const errors: LoginErrors = {};
  if (mode === 'register') {
    const length = Array.from(values.nickname.trim()).length;
    if (!length || length > 20) errors.nickname = '昵称需为 1–20 个字符。';
  }
  if (!values.email.trim()) errors.email = '请输入邮箱。';
  else if (!emailSchema.safeParse(values.email.trim()).success) errors.email = '请输入完整邮箱，如 name@example.com。';
  if (mode === 'register') errors.password = registrationPasswordError(values.password);
  else if (!values.password) errors.password = '请输入密码。';
  else if (Array.from(values.password).length > maximumPasswordLength) errors.password = '密码最多为 128 个字符。';
  if (mode === 'register') {
    if (!values.confirmPassword) errors.confirmPassword = '请再次输入密码。';
    else if (values.confirmPassword !== values.password) errors.confirmPassword = '两次输入的密码不一致。';
  }
  return errors;
}
