"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { readListSearch } from "./list-storage";

// 목록 query 는 다른 화면에서만 바뀌므로 상세에 있는 동안 구독할 변화가 없다.
const subscribe = () => () => {};

/**
 * 상세에서 Collection 목록으로 돌아가는 링크. 이 탭에서 마지막으로 본 목록의 정렬·필터·페이지
 * query 를 붙인다. 서버 렌더와 hydration 은 query 없는 `/collections` 이고, 그 뒤 저장된 값으로 바뀐다.
 */
export function CollectionsBackLink({ children }: { children: ReactNode }) {
  const search = useSyncExternalStore(subscribe, readListSearch, () => "");

  return (
    <Link
      href={`/collections${search}`}
      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
      data-testid="collection-detail-link-back"
    >
      {children}
    </Link>
  );
}
