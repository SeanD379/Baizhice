import { expect, it } from 'vitest';
import { registrationPasswordError, validateLoginFields } from './login-validation';

it.each(['Abcdef12', 'Abcdef!@', 'abcdef1!', 'ABCDEF1!'])('accepts eight characters with any three of the four character classes: %s', password => {
  expect(registrationPasswordError(password)).toBeUndefined();
});

it.each(['abcdefgh', 'ABCDEFGH', '12345678', '!@#$%^&*', 'Abcdefgh', 'abcde123', 'abcde!@#', 'ABCDEF12', '12345!@#', 'abc123  '])('rejects fewer than three character classes: %s', password => {
  expect(registrationPasswordError(password)).toContain('类');
});

it('explains the remaining length before character composition', () => {
  expect(registrationPasswordError('Aa1!abc')).toContain('还差 1 位');
  expect(registrationPasswordError('Aa1!' + 'a'.repeat(125))).toContain('减少 1 位');
});

it('suggests only missing classes and how many are needed', () => {
  expect(registrationPasswordError('abcde123')).toBe('还需 1 类：大写/符号。');
  expect(registrationPasswordError('12345678')).toBe('还需 2 类：大写/小写/符号。');
});

it('counts Unicode characters toward the length and symbols toward composition', () => {
  expect(registrationPasswordError('Abcdefg🙂')).toBeUndefined();
  expect(registrationPasswordError('Aa1!' + '🙂'.repeat(124))).toBeUndefined();
  expect(registrationPasswordError('Aa1!' + '🙂'.repeat(125))).toContain('减少 1 位');
});

it('keeps existing login passwords independent of the registration composition rule', () => {
  const values = { nickname: '同学', email: 'learner@example.com', password: 'legacy-password', confirmPassword: 'legacy-password' };
  expect(validateLoginFields('login', values).password).toBeUndefined();
  expect(validateLoginFields('register', values).password).toContain('类');
});
