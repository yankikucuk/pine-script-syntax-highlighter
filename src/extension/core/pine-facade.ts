export interface RemoteLibrary {
  libId: string;
  user: string;
  lib: string;
  version: string;
  scriptIdPart: string;
  docs: string;
}

export interface RawIssue {
  code?: string;
  message: string;
  ctx?: Record<string, string>;
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}

export interface CompileResult {
  success: boolean;
  reason?: string;
  errors: RawIssue[];
  warnings: RawIssue[];
  variables: { name: string; type: string }[];
  functions: { name: string; syntax: string; desc?: string; args: { name: string; type: string; info?: string }[] }[];
}

export interface FacadeOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  log?: (message: string) => void;
}

const BASE = 'https://pine-facade.tradingview.com/pine-facade/';
const LIB_TTL = 10 * 60 * 1000;
const BACKOFF = 5 * 60 * 1000;
const FAILURES_BEFORE_BACKOFF = 3;
const COMPILE_CACHE_SIZE = 100;

type RawResponse = { success?: boolean; reason?: string; result?: Record<string, unknown> };

export class PineFacade {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly log: (m: string) => void;
  private failures = 0;
  disabledUntil = 0;
  private readonly libCache = new Map<string, { at: number; value: RemoteLibrary[] }>();
  private readonly scriptCache = new Map<string, string | null>();
  private readonly compileCache = new Map<string, CompileResult | null>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: FacadeOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.log = options.log ?? (() => {});
  }

  async libList(prefix: string): Promise<RemoteLibrary[]> {
    const hit = this.libCache.get(prefix);
    if (hit && this.now() - hit.at < LIB_TTL) return hit.value;
    const data = await this.request<unknown>(
      'GET',
      `lib_list/?lib_id_prefix=${encodeURIComponent(prefix)}&ignore_case=true`,
    );
    const value = Array.isArray(data) ? (data as RemoteLibrary[]).filter((l) => typeof l.libId === 'string') : [];
    if (data !== null) this.libCache.set(prefix, { at: this.now(), value });
    return value;
  }

  async getScript(scriptIdPart: string, version: string): Promise<string | null> {
    const key = `${scriptIdPart}@${version}`;
    if (this.scriptCache.has(key)) return this.scriptCache.get(key)!;
    const data = await this.request<{ source?: string }>(
      'GET',
      `get/${encodeURIComponent(scriptIdPart)}/${encodeURIComponent(version)}?no_4xx=true`,
    );
    const source = typeof data?.source === 'string' ? data.source : null;
    if (data !== null) this.scriptCache.set(key, source);
    return source;
  }

  async translateLight(source: string): Promise<CompileResult | null> {
    const key = hash(source);
    if (this.compileCache.has(key)) return this.compileCache.get(key)!;
    const body = new URLSearchParams({ source });
    const data = await this.request<RawResponse>(
      'POST',
      'translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
      body,
    );
    if (data === null) return null;
    const result = normalize(data);
    this.compileCache.set(key, result);
    if (this.compileCache.size > COMPILE_CACHE_SIZE) this.compileCache.delete(this.compileCache.keys().next().value!);
    return result;
  }

  private request<T>(method: 'GET' | 'POST', path: string, body?: URLSearchParams): Promise<T | null> {
    if (this.now() < this.disabledUntil) return Promise.resolve(null);
    const key = `${method} ${path} ${body?.toString() ?? ''}`;
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T | null>;
    const p = this.doRequest<T>(method, path, body).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRequest<T>(method: 'GET' | 'POST', path: string, body?: URLSearchParams): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(BASE + path, {
        method,
        headers: { Accept: 'application/json', Referer: 'https://www.tradingview.com/' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.failures = 0;
      return (await res.json()) as T;
    } catch (err) {
      this.failures++;
      this.log(
        `TradingView request failed (${method} ${path.split('?')[0]}): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (this.failures >= FAILURES_BEFORE_BACKOFF) {
        this.disabledUntil = this.now() + BACKOFF;
        this.failures = 0;
        this.log('Remote features paused for five minutes after repeated failures.');
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalize(data: RawResponse): CompileResult {
  const r = data.result ?? {};
  const docsOf = (key: string): unknown[] => {
    const groups = r[key];
    return Array.isArray(groups)
      ? groups.flatMap((g) => (Array.isArray((g as { docs?: unknown[] }).docs) ? (g as { docs: unknown[] }).docs : []))
      : [];
  };
  return {
    success: data.success !== false,
    reason: data.reason,
    errors: Array.isArray(r.errors2) ? (r.errors2 as RawIssue[]) : [],
    warnings: Array.isArray(r.warnings2) ? (r.warnings2 as RawIssue[]) : [],
    variables: docsOf('variables2') as CompileResult['variables'],
    functions: docsOf('functions2') as CompileResult['functions'],
  };
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16) + ':' + text.length;
}
