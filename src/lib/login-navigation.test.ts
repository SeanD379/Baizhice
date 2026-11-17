import { expect, it } from 'vitest';
import { loginReturnPath } from './login-navigation';

it('retains a workspace return path and its settings marker', () => {
  expect(loginReturnPath('/?course=probability&view=home&chat=c1&settings=profile')).toBe('/?course=probability&view=home&chat=c1&settings=profile');
});

it.each([null, '', 'https://elsewhere.example', '//elsewhere.example', '/\\elsewhere.example', '/login?next=/', '/login/', '/%6cogin', '/?x=\n'])('rejects an external, recursive or malformed return destination: %s', value => {
  expect(loginReturnPath(value)).toBe('/');
});
