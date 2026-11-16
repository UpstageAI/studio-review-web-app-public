import "server-only";

// 서버 프로세스 메모리의 TTL 캐시. 건수와 바이트 합계 상한을 함께 둬서 큰 항목이 쌓여도 메모리가
// 한정된다. 서버 프로세스마다 하나이며 사용자 구분이 없다(이 앱은 서버 키 하나로 동작한다).

export interface TtlCache<V> {
  get(key: string): V | undefined;
  /** 넣는다. 항목 하나가 `maxBytes` 보다 크면 넣지 않는다(있던 같은 키도 지운다). */
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  /** 들어 있는 항목의 바이트 합계(`sizeOf` 기준). */
  readonly bytes: number;
}

export interface TtlCacheOptions<V> {
  ttlMs: number;
  maxEntries: number;
  /** 바이트 합계 상한. 없으면 건수만 본다. */
  maxBytes?: number;
  /** 항목의 바이트 수. 없으면 모든 항목을 0 으로 센다. */
  sizeOf?: (value: V) => number;
  now?: () => number;
}

export function createTtlCache<V>(opts: TtlCacheOptions<V>): TtlCache<V> {
  const { ttlMs, maxEntries } = opts;
  const maxBytes = opts.maxBytes ?? Number.POSITIVE_INFINITY;
  const sizeOf = opts.sizeOf ?? (() => 0);
  const now = opts.now ?? (() => Date.now());
  // Map 은 넣은 순서를 지키므로 첫 키가 가장 오래된 항목이다.
  const entries = new Map<
    string,
    { value: V; expiresAt: number; bytes: number }
  >();
  let total = 0;

  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    total -= entry.bytes;
  };

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        remove(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      remove(key);
      const bytes = sizeOf(value);
      if (bytes > maxBytes) return;
      entries.set(key, { value, expiresAt: now() + ttlMs, bytes });
      total += bytes;
      while (entries.size > maxEntries || total > maxBytes) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
    },
    delete(key) {
      remove(key);
    },
    clear() {
      entries.clear();
      total = 0;
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return total;
    },
  };
}
