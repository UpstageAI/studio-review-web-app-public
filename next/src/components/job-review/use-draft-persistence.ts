"use client";

import { useEffect, useState, type Dispatch } from "react";
import { createDraftPersister } from "./draft-persister";
import { browserStorage } from "./draft-storage";
import {
  draftStorageKey,
  parseStoredDraft,
  type StoredDraft,
} from "./draft-store";
import type { JobReviewAction, JobReviewState } from "./job-review-state";
import { useFlushOnHide } from "./use-flush-on-hide";

/**
 * 저장하지 않은 변경 항목을 브라우저에 임시 저장하고, 불러온 직후 지난 임시 저장을 읽어 reducer 에
 * 알린다(복원 배너는 `DraftBanner`).
 *
 * - 읽기: 불러온 직후(`draft.status === "unchecked"`) 한 번. 저장소를 읽지 못해도 반드시
 *   `DRAFT_CHECKED` 를 보낸다 — 이 상태가 풀려야 쓰기가 시작된다.
 * - 쓰기: 시점(500 ms 디바운스)·지우기·실패 처리는 `createDraftPersister` 가 정한다. 이 hook 은 상태가
 *   바뀔 때 알리고, 기다리던 쓰기를 화면을 떠날 때(언마운트)와 탭을 숨기거나 떠날 때
 *   (`pagehide`·`visibilitychange`) 그 자리에서 마치게 한다.
 */
export function useDraftPersistence(
  state: JobReviewState,
  dispatch: Dispatch<JobReviewAction>,
): void {
  const { status, session, collectionId, jobId, requestKey } = state;
  const draftStatus = state.draft.status;
  const key = draftStorageKey(collectionId, jobId);

  // `dispatch` 는 `useReducer` 의 것이라 렌더 사이에 바뀌지 않는다.
  const [persister] = useState(() =>
    createDraftPersister({
      storage: browserStorage(),
      dispatch,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: handle =>
        clearTimeout(handle as ReturnType<typeof setTimeout>),
    }),
  );

  // 읽기 effect 보다 먼저 둔다 — 다시 불러올 때(`unchecked`) 기다리던 쓰기를 먼저 마쳐야 읽기가
  // 그 내용을 본다.
  useEffect(() => {
    persister.update({
      session: status === "ready" ? session : null,
      draftStatus,
      key,
    });
  }, [persister, status, session, draftStatus, key]);

  useEffect(() => {
    if (status !== "ready" || draftStatus !== "unchecked" || !session) return;
    let stored: StoredDraft | null = null;
    try {
      const storage = browserStorage();
      const text = storage.read(key);
      stored = text === null ? null : parseStoredDraft(text);
      if (stored !== null && stored.drafts.length === 0) stored = null;
      // 읽을 수 없는 값은 지워서 다음에 다시 읽지 않는다.
      if (stored === null) storage.clear(key);
    } catch {
      stored = null;
    }
    dispatch({ type: "DRAFT_CHECKED", stored });
  }, [status, draftStatus, requestKey, session, key, dispatch]);

  // 언마운트 때 기다리던 쓰기를 마치고 타이머를 남기지 않는다.
  useEffect(() => () => persister.dispose(), [persister]);
  useFlushOnHide(persister.flush);
}
