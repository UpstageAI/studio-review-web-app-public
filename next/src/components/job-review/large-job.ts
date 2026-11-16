// 큰 Job(수백 쪽)에서 화면이 다른 경로를 타는 임계치와 묶음 크기. 화면·훅·reducer 가 함께 쓴다.
// 작은 Job(임계치 아래)은 기존 UI 그대로라 회귀 범위가 이 값들로 격리된다.

/** 문서 쪽수가 이보다 크면 페이지 탭 대신 위치 바를 보인다. */
export const PAGE_TABS_MAX = 12;

/** Job 전체 쪽수가 이보다 크면 필름스트립을 이웃 보기(앞 끝 · 선택 전체 · 뒤 앞)로 줄인다. */
export const NEIGHBORHOOD_ABOVE = 20;

/** 문서 쪽수가 이보다 크면 Parse 탭 "현재 페이지만" 이 기본으로 켜진다. */
export const PARSE_PAGE_FILTER_ABOVE = 10;

/** 문서 수가 이보다 크면 문서 목록을 윈도잉한다. */
export const DOCUMENT_LIST_VIRTUALIZE_ABOVE = 100;

/** 뷰어에 넘기는 하이라이트: 현재 페이지 ± 이 쪽수(선택·호버는 늘 포함). */
export const HIGHLIGHT_WINDOW = 3;

/** Parse 하이라이트를 받아 오는 페이지 묶음 크기(묶음 시작은 1, 21, 41, …). */
export const HIGHLIGHT_CHUNK = 20;

/** 값 패널이 큰 배열을 한 번에 그리는 항목 수. */
export const ARRAY_BATCH = 50;
