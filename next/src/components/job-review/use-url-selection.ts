"use client";

import { useCallback, useEffect, useRef } from "react";
import { withUrlSelection } from "./url-state";
import { useFlushOnHide } from "./use-flush-on-hide";

/** 선택이 바뀐 뒤 주소창을 고치기까지 기다리는 시간(연속 스크롤로 쪽이 빠르게 바뀔 때 묶는다). */
export const URL_SYNC_MS = 300;

type Selection = { documentId: string; pageIndex: number } | null;

function writeUrlSelection(selection: Selection): void {
  const { pathname, search, hash } = window.location;
  const next = withUrlSelection(search, selection);
  if (next !== search) {
    window.history.replaceState(null, "", `${pathname}${next}${hash}`);
  }
}

/**
 * 선택 문서·페이지를 주소창 쿼리(`?doc=…&page=…`)에 적는다. 라우터 이동 없이
 * `history.replaceState` 로만 바꾸므로 화면은 다시 그려지지 않고, 지금 주소와 같으면 부르지
 * 않는다(effect 는 선택값에만 묶여 있어 되먹임이 없다). 새로 고침·링크 공유로 같은 자리를
 * 다시 연다. 기다리는 동안 페이지가 숨겨지거나 내려가면(새로 고침 직전 등) 바로 적는다.
 */
export function useUrlSelectionSync(selection: Selection): void {
  const documentId = selection?.documentId ?? null;
  const pageIndex = selection?.pageIndex ?? null;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ selection: Selection } | null>(null);

  const flushNow = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    writeUrlSelection(pending.selection);
  }, []);

  useEffect(() => {
    pendingRef.current = {
      selection:
        documentId !== null && pageIndex !== null
          ? { documentId, pageIndex }
          : null,
    };
    timerRef.current = setTimeout(flushNow, URL_SYNC_MS);
    // 언마운트·선택 변경 때는 기다리던 쓰기만 취소한다(다음 effect 가 새 값으로 다시 건다).
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [documentId, pageIndex, flushNow]);

  useFlushOnHide(flushNow);
  // 기다리던 쓰기가 링크나 버튼으로 시작한 라우트 이동 도중에 끼어들면 Next 라우터가 그 이동을 버린다
  // (예: Job 을 연 직후 "← Job 목록" 을 누르면 주소만 `?doc=…` 로 바뀌고 화면은 그대로). 누르는 순간
  // (capture 단계, 이동이 시작되기 전) 기다리던 쓰기를 마친다. 클릭 없이 이동하는 ⌘/Ctrl+Enter(완료하고
  // 다음 Job 열기) 단축키도 같다.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) flushNow();
    };
    document.addEventListener("click", flushNow, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("click", flushNow, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [flushNow]);
}
