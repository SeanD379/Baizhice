import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./content-sections.css', import.meta.url), 'utf8');

describe('notebook editor styles', () => {
  it('styles the editor after Radix portals it outside the outline view', () => {
    expect(css).toContain('.modal .notebook-editor textarea');
    expect(css).toContain('.modal .notebook-editor>div');
  });
});
