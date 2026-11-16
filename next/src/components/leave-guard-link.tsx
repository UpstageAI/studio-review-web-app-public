"use client";

import type { ComponentProps } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { isNewTabClick } from "@/lib/links";
import { confirmAppLeave, needsLeaveConfirm } from "./leave-guard-store";

/**
 * 앱 안 링크인데, 검수 화면에 저장하지 않은 변경이 있으면(저장 중 포함) 기본 이동을 막고 떠날지 먼저
 * 묻는다. "나가기" 를 고르면 같은 주소로 옮긴다. 새 탭이나 새 창으로 여는 클릭(⌘/Ctrl, Shift, Alt,
 * 가운데 단추)은 화면을 떠나지 않으므로 묻지 않는다.
 */
export function LeaveGuardLink({
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  /** "나가기" 뒤 `router.push` 로 옮기므로 router 가 받는 주소 형식만 받는다. */
  href: Parameters<ReturnType<typeof useRouter>["push"]>[0];
}) {
  const router = useRouter();
  return (
    <Link
      {...props}
      href={href}
      onClick={event => {
        if (!isNewTabClick(event) && needsLeaveConfirm()) {
          event.preventDefault();
          void confirmAppLeave().then(ok => {
            if (ok) router.push(href);
          });
          return;
        }
        onClick?.(event);
      }}
    />
  );
}
