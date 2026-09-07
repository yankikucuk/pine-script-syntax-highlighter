// Produces src/data/reference.json from the Pine Script v6 reference.
// Needs playwright-core and a Chromium: `npx playwright-core install chromium` once.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const URL = 'https://www.tradingview.com/pine-script-reference/v6/';
const OUT = path.join(root, 'src/data/reference.json');

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error(
    'playwright-core is not installed. Run: npm install --no-save playwright-core && npx playwright-core install chromium',
  );
  process.exit(1);
}

const extractor = await readFile(path.join(here, 'lib/extract-reference.js'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tv-pine-reference-item[id]');
  const { entries } = await page.evaluate(`${extractor}; extractReference();`);
  if (entries.length < 900) {
    throw new Error(`Only ${entries.length} entries extracted; the page structure may have changed.`);
  }
  // Overload arguments are read after selecting each overload; this known case catches a silent regression.
  const tostring = entries.find((e) => e.id === 'fun_str.tostring');
  if (!tostring || !tostring.overloads.some((o) => o.params.length === 2)) {
    throw new Error('Overload extraction failed: str.tostring should have a two-parameter overload.');
  }
  const data = { version: '6', generatedAt: new Date().toISOString().slice(0, 10), entries };
  await writeFile(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log(`Wrote ${entries.length} entries to ${path.relative(root, OUT)}`);
} finally {
  await browser.close();
}
