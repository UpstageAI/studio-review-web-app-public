// Collection 목록 표의 열 폭. 표는 고정 레이아웃(`table-fixed`)이라 보이는 열 구성이 같으면 필터·페이지·
// 내용과 무관하게 열 폭이 같다. 이름 열은 폭을 정하지 않고 남는 폭을 모두 가진다.

import type { HideableColumn } from "./column-visibility";

/**
 * 숨길 수 있는 열의 고정 폭(rem, 셀 좌우 여백 1.5rem 포함). 3 locale 의 가장 긴 내용을 기준으로 잡았다.
 * - 출처: 가장 긴 배지(ja "ファイルアップロード")와 고른 수가 붙은 필터 머리.
 * - 검수: 진행 막대 상자(최소 8rem)와 "완료 1,234 / 12,345".
 * - 날짜 두 열: `dateStyle: "medium"` + `timeStyle: "short"` 의 가장 긴 형식(en·ko 약 8.8rem).
 * Workflow 이름은 길이가 정해져 있지 않아 말줄임하고 `title` 로 전체를 보인다.
 */
export const COLUMN_WIDTH_REM: Readonly<Record<HideableColumn, number>> = {
  source: 10.5,
  workflow: 14,
  jobs: 6,
  review: 10,
  updated: 10.5,
  lastResult: 10.5,
};

/** 마지막 열 보기 메뉴 열의 폭(rem). */
export const MENU_COLUMN_REM = 2.5;

/** 이름 열이 최소로 가지는 폭(rem). 창이 좁아 이보다 줄어야 하면 표가 가로로 스크롤된다. */
export const NAME_MIN_REM = 16;

function isWidthColumn(value: string): value is HideableColumn {
  return Object.hasOwn(COLUMN_WIDTH_REM, value);
}

/** 보이는 열(이름·메뉴 열 제외)의 폭 합에 이름 최소 폭과 메뉴 열 폭을 더한 표 최소 폭(rem). 모르는 열 이름은 무시한다. */
export function tableMinWidthRem(visible: readonly string[]): number {
  let total = NAME_MIN_REM + MENU_COLUMN_REM;
  for (const column of new Set(visible)) {
    if (isWidthColumn(column)) total += COLUMN_WIDTH_REM[column];
  }
  return total;
}
