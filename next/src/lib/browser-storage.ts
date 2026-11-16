import { useMemo, useSyncExternalStore } from "react";

// 브라우저 저장소(localStorage·sessionStorage)를 안전하게 연다. 서버 렌더·사생활 보호 모드·저장소 차단에서는
// 예외 대신 `null` 을 돌려주거나 조용히 건너뛴다(화면 설정·탭 상태 기억용이라 저장소가 없어도 화면은 동작해야 한다).

function openStore(kind: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/** `localStorage`(브라우저를 닫아도 남는 선호값용). 쓸 수 없으면 `null`. */
export function localStore(): Storage | null {
  return openStore("localStorage");
}

/** `sessionStorage`(탭 안에서만 남는 값용). 쓸 수 없으면 `null`. */
export function sessionStore(): Storage | null {
  return openStore("sessionStorage");
}

/** `localStorage` 의 값(없거나 읽지 못하면 `null`). */
export function readStorageItem(key: string): string | null {
  try {
    return localStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** `localStorage` 에 값을 쓴다. 가득 찼거나 막혀 있으면 기억하지 않는다. */
export function writeStorageItem(key: string, value: string): void {
  try {
    localStore()?.setItem(key, value);
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}

/**
 * 저장소 값이 바뀔 때 누구에게 알리는지.
 * - `"none"`: 알리지 않는다(쓰기만 하고, 읽는 쪽은 처음 그릴 때 한 번 읽는다).
 * - `"tab"`: 같은 탭의 구독자에게만 알린다.
 * - `"tab+storage"`: 같은 탭의 구독자와, 다른 탭이 같은 키를 바꿨을 때(`storage` 이벤트, 저장소를 통째로
 *   비운 `key === null` 포함)도 알린다.
 */
export type StoredValueNotify = "none" | "tab" | "tab+storage";

export type StoredValueOptions<T> = {
  key: string;
  area: "local" | "session";
  /** 저장소 글 → 값. 없거나 읽지 못하면 `null` 을 받는다. 서버 렌더와 첫 화면도 `parse(null)` 이다. */
  parse: (text: string | null) => T;
  serialize: (value: T) => string;
  notify: StoredValueNotify;
};

export type StoredValue<T> = {
  /** 지금 저장소의 값(읽지 못하면 `parse(null)`). */
  read(): T;
  /** 값을 쓰고(막혀 있으면 기억하지 않는다) `notify` 에 따라 구독자에게 알린다. */
  write(value: T): void;
  /** `notify` 가 `"none"` 이면 아무것도 듣지 않는다. */
  subscribe(listener: () => void): () => void;
  /** 값을 구독하는 훅. 같은 글이면 같은 값(참조)을 돌려준다. */
  useValue(): T;
};

/**
 * 저장소 키 하나를 읽고 쓰고 구독하는 묶음. 구독 스냅숏은 저장소 글 그대로라(값이 같으면 같은 문자열)
 * `parse` 가 매번 새 객체를 만들어도 다시 그리기가 반복되지 않는다. 같은 키를 쓰는 곳은 이 묶음 하나를
 * 모듈 수준에서 함께 써야 같은 탭 알림이 닿는다.
 */
export function createStoredValue<T>({
  key,
  area,
  parse,
  serialize,
  notify,
}: StoredValueOptions<T>): StoredValue<T> {
  const open = area === "local" ? localStore : sessionStore;
  const listeners = new Set<() => void>();

  function readText(): string | null {
    try {
      return open()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function read(): T {
    return parse(readText());
  }

  function write(value: T): void {
    try {
      open()?.setItem(key, serialize(value));
    } catch {
      // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
    }
    if (notify === "none") return;
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    if (notify === "none") return () => {};
    listeners.add(listener);
    if (notify === "tab") {
      return () => {
        listeners.delete(listener);
      };
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  function useValue(): T {
    const text = useSyncExternalStore(subscribe, readText, () => null);
    return useMemo(() => parse(text), [text]);
  }

  return { read, write, subscribe, useValue };
}
