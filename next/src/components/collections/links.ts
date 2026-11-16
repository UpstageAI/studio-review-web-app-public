// Collection 화면의 내부 경로와 행 클릭 처리.

import type { MouseEvent } from "react";

export function collectionHref(collectionId: string): string {
  return `/collections/${encodeURIComponent(collectionId)}`;
}

export function jobHref(collectionId: string, jobId: string): string {
  return `${collectionHref(collectionId)}/jobs/${encodeURIComponent(jobId)}`;
}

/**
 * 링크·버튼이 아닌 곳을 눌렀을 때만 행 이동을 처리한다(링크는 스스로 이동한다).
 * 툴팁처럼 포털로 행 밖에 그려진 요소의 클릭은 React 트리를 따라 행까지 올라오므로 제외한다.
 */
export function isRowNavigationClick(event: MouseEvent): boolean {
  const target = event.target as Element | null;
  if (!target || !(event.currentTarget as Node).contains(target)) return false;
  return !target.closest("a, button, input, label");
}
