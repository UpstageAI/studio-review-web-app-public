"use client";

import { useEffect } from "react";

/**
 * 저장하지 않은 변경이 있거나 저장 중이면 탭 닫기·새로 고침·주소 이동 때 브라우저 확인을 띄운다.
 * 앱 안 링크 이동은 `@/lib/leave-confirm` 의 `confirmLeave` 로 따로 묻는다.
 */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 오래된 브라우저는 `returnValue` 가 있어야 확인을 띄운다.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}
