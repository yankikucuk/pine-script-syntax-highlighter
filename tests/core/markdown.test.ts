import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/extension/core/document-model';
import {
  entryDetail,
  entryMarkdown,
  functionMarkdown,
  functionSignatureLabel,
} from '../../src/extension/core/markdown';
import { loadReference } from '../../src/extension/core/reference';

describe('markdown', () => {
  const ref = loadReference();

  it('renders a built-in function', () => {
    const md = entryMarkdown(ref.get('ta.sma')!, ref);
    expect(md).toContain('```pine\nta.sma(source, length) → series float\n```');
    expect(md).toContain('**Parameters**');
    expect(md).toContain('`source`');
    expect(md).toContain('**Returns**');
    expect(md).toContain('[Reference](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sma)');
  });

  it('renders a variable with its type', () => {
    const md = entryMarkdown(ref.get('close')!, ref);
    expect(md).toContain('```pine\n(variable) close: series float\n```');
    expect(entryDetail(ref.get('close')!)).toBe('series float');
  });

  it('renders user functions from the document model', () => {
    const m = buildModel('//@function Adds.\n//@param a Left.\n//@returns Sum.\nadd(float a, b = 1) =>\n    a + b\n');
    const fn = m.functions[0]!;
    expect(functionSignatureLabel(fn)).toBe('add(float a, b = 1)');
    const md = functionMarkdown(fn);
    expect(md).toContain('```pine\nadd(float a, b = 1)\n```');
    expect(md).toContain('Adds.');
    expect(md).toContain('`a` Left.');
    expect(md).toContain('**Returns** Sum.');
  });
});
