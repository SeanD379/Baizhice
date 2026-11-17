import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { transform } from 'lightningcss';

it('keeps standard backdrop blur in the production stylesheet after optimization', () => {
  const source = readFileSync('src/app/user-settings.css');
  const optimized = transform({ filename: 'user-settings.css', code: source, minify: true }).code.toString();
  const rule = optimized.match(/\.settings-profile-focus-shade\{[^}]*\}/)?.[0];
  expect(rule).toMatch(/(?:[;{])backdrop-filter:blur\(3px\)/);
});
