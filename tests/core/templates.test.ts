import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/extension/core/templates';

describe('renderTemplate', () => {
  it('renders an indicator with the title and date', () => {
    const t = renderTemplate('indicator', { title: 'My Indicator', date: '2026-09-07' });
    expect(t.startsWith('//@version=6\n')).toBe(true);
    expect(t).toContain('indicator("My Indicator"');
    expect(t).toContain('2026-09-07');
    expect(t).toContain('plot(');
  });

  it('renders a strategy with entries and exits', () => {
    const t = renderTemplate('strategy', { title: 'S', date: '2026-09-07' });
    expect(t).toContain('strategy("S"');
    expect(t).toContain('strategy.entry(');
    expect(t).toContain('strategy.close(');
  });

  it('renders a library with an exported function and docs', () => {
    const t = renderTemplate('library', { title: 'Lib', date: '2026-09-07' });
    expect(t).toContain('library("Lib")');
    expect(t).toContain('//@function');
    expect(t).toContain('export ');
  });
});
