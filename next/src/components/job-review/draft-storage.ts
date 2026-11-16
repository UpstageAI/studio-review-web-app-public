import { localStore } from "@/lib/browser-storage";

// 임시 저장의 저장소 접근. 어느 호출도 던지지 않는다 — 막힌 저장소(사생활 보호 모드·차단)·용량 초과는
// `null`·쓰기 결과·무시로 돌려 화면은 임시 저장 없이 계속 동작한다.

/**
 * 쓰기 결과. `unavailable` = 저장소가 없다(서버 렌더·사이트 데이터 차단 등, 처음부터 쓸 수 없음).
 * `failed` = 저장소는 있으나 쓰기를 거부했다(용량 초과 `QuotaExceededError` 등).
 */
export type DraftWriteResult = "ok" | "unavailable" | "failed";

export type DraftStorage = {
  /** 없거나 읽을 수 없으면 `null`. */
  read(key: string): string | null;
  write(key: string, text: string): DraftWriteResult;
  clear(key: string): void;
};

export type DraftStorageBackend = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export function createDraftStorage(
  backend: DraftStorageBackend | null,
): DraftStorage {
  return {
    read(key) {
      try {
        return backend?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write(key, text) {
      if (!backend) return "unavailable";
      try {
        backend.setItem(key, text);
        return "ok";
      } catch {
        return "failed";
      }
    },
    clear(key) {
      try {
        backend?.removeItem(key);
      } catch {
        // 지울 수 없으면 다음에 읽을 때 모양·version 검사가 거른다.
      }
    },
  };
}

/** 브라우저 `localStorage`. 서버 렌더·막힌 저장소에서는 읽기 `null`·쓰기 `unavailable`. */
export function browserStorage(): DraftStorage {
  return createDraftStorage(localStore());
}
