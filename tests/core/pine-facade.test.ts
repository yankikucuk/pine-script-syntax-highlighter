import { describe, expect, it, vi } from 'vitest';
import { PineFacade } from '../../src/extension/core/pine-facade';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const mockFetch = (impl: () => Promise<Response>) => vi.fn<FetchFn>(impl);
const asFetch = (fn: unknown) => fn as typeof globalThis.fetch;

describe('PineFacade', () => {
  it('lists libraries and caches by prefix', async () => {
    const fetch = mockFetch(async () =>
      json([
        {
          libId: 'TradingView/ta/14',
          user: 'TradingView',
          lib: 'ta',
          version: '14.0',
          scriptIdPart: 'PUB;1',
          docs: '',
        },
      ]),
    );
    const f = new PineFacade({ fetch: asFetch(fetch) });
    const a = await f.libList('TradingView/t');
    const b = await f.libList('TradingView/t');
    expect(a[0]?.libId).toBe('TradingView/ta/14');
    expect(b).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]![0])).toContain('lib_list/?lib_id_prefix=TradingView%2Ft&ignore_case=true');
  });

  it('returns library source', async () => {
    const fetch = mockFetch(async () => json({ source: '//@version=6\nlibrary("ta")\n' }));
    const f = new PineFacade({ fetch: asFetch(fetch) });
    expect(await f.getScript('PUB;abc', '14.0')).toContain('library("ta")');
    expect(String(fetch.mock.calls[0]![0])).toContain('/get/PUB%3Babc/14.0?no_4xx=true');
  });

  it('posts source to translate_light and normalizes the result', async () => {
    const fetch = mockFetch(async () =>
      json({
        success: true,
        result: {
          errors2: [
            {
              code: 'CE1',
              message: 'Undeclared identifier "{identifier}"',
              ctx: { identifier: 'x' },
              start: { line: 3, column: 6 },
              end: { line: 3, column: 7 },
            },
          ],
          variables2: [{ docs: [{ name: 'a', type: 'series float' }] }],
          functions2: [],
        },
      }),
    );
    const f = new PineFacade({ fetch: asFetch(fetch) });
    const r = await f.translateLight('//@version=6\nindicator("x")\nplot(x)');
    expect(r?.errors[0]?.code).toBe('CE1');
    expect(r?.variables).toEqual([{ name: 'a', type: 'series float' }]);
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('source=');
  });

  it('backs off after three failures', async () => {
    let now = 1_000_000;
    const fetch = mockFetch(async () => json({}, 500));
    const log = vi.fn();
    const f = new PineFacade({ fetch: asFetch(fetch), now: () => now, log });
    for (let i = 0; i < 3; i++) expect(await f.libList(`p${i}`)).toEqual([]);
    expect(f.disabledUntil).toBeGreaterThan(now);
    await f.libList('p9');
    expect(fetch).toHaveBeenCalledTimes(3);
    now += 5 * 60 * 1000 + 1;
    await f.libList('p9');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalled();
  });
});
