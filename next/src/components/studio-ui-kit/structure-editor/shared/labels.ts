import type { StructurePage } from "./types";

/**
 * 문서 제외·복귀 문구. `onExcludeDocument`·`onRestoreDocument` 와 함께 넘긴다. 배지는 콜백과 상관없이
 * 제외한 문서(`excluded`)에 붙는다.
 */
export interface StructureDocumentExclusionLabels {
  /** 문서 메뉴 "문서 제외" */
  exclude: string;
  /** 문서 메뉴 "문서 복귀" */
  restore: string;
  /** 제외 문서 배지 */
  badge: string;
}

/**
 * 필름스트립·페이지 격자가 함께 쓰는 문구. view 전용 문구(필름스트립의 ✂ 뒤에서 나누기·띠 끌기·이웃
 * 보기, 페이지 격자의 앞에서 나누기·여러 장 끌기·크기 토글)는 각 view 의 labels 타입에 있다. 기능 하나에만
 * 쓰는 문구는 선택 묶음이고, 그 기능을 켜는 콜백과 함께 넘긴다(묶음이 없으면 콜백이 있어도 그 기능을
 * 그리지 않는다).
 */
export interface StructureEditorLabels {
  /** view 전체의 접근성 이름 */
  region: string;
  /** 문서 제목(예: i => `문서 ${i}`) — 1-based */
  document: (index: number) => string;
  /** 라벨 없는 문서 */
  untitled: string;
  /** 라벨 입력의 접근성 이름 */
  label: string;
  /** select 의 "라벨 없음" 항목 */
  noLabel: string;
  /** select 에서 설정에 없는 현재 라벨 항목(예: v => `${v} (설정에 없음)`) */
  notInConfigOption: (label: string) => string;
  /** 설정에 없는 라벨 배지 */
  notInConfigBadge: string;
  /** 배지 설명(title) */
  notInConfigHint: string;
  /** 페이지 수(예: n => `${n}쪽`) */
  pageCount: (count: number) => string;
  /** 썸네일 아래 캡션과 버튼 이름(예: 파일명 + 페이지) */
  page: (page: StructurePage) => string;
  /** 이미지가 아직 없는 썸네일 */
  noImage: string;
  /** 썸네일 메뉴 버튼 이름 */
  pageMenu: (page: StructurePage) => string;
  /** 페이지 메뉴 "앞으로"(필름스트립은 "왼쪽으로" 를 넘긴다) */
  movePageEarlier: string;
  /** 페이지 메뉴 "뒤로"(필름스트립은 "오른쪽으로" 를 넘긴다) */
  movePageLater: string;
  moveToDocument: string;
  /** 문서 고르기 항목(예: (i, label) => `문서 ${i} · ${label}`) — 1-based */
  documentOption: (index: number, label: string | null) => string;
  /** 옮길 수 있는 같은 그룹 문서가 없을 때 */
  noOtherDocument: string;
  excludePage: string;
  /** 제외 페이지를 문서로 되돌리는 하위 메뉴 */
  restorePage: string;
  /** 제외·빠진 페이지 메뉴 "새 문서로". `onRestoreToNewDocument` 와 함께 넘긴다. */
  restoreToNewDocument?: string;
  /** 문서 메뉴 버튼 이름 — 1-based */
  documentMenu: (index: number) => string;
  mergeWithPrevious: string;
  moveDocumentEarlier: string;
  moveDocumentLater: string;
  /** 문서 메뉴 "위치 지정…". `onRequestDocumentPosition` 과 함께 넘긴다. */
  moveDocumentTo?: string;
  /** 문서 제외·복귀 메뉴와 제외 문서 배지. */
  documentExclusion?: StructureDocumentExclusionLabels;
  /** 제외 자리 제목 */
  excluded: string;
  /** 제외 자리가 비었을 때 안내 */
  excludedEmpty: string;
  /** 빠진 페이지 자리 제목 */
  unplaced: string;
  /** 빠진 페이지 메뉴 버튼 이름 */
  unplacedMenu?: (page: StructurePage) => string;
  /** 빠진 페이지 설명 */
  missing: string;
  /** 겹친 페이지 설명 */
  overlap: string;
  /** 다른 그룹으로 drop 하려 할 때 */
  dropRejected: string;
  /** 잠긴 문서에 drop 하려 할 때 */
  dropRejectedLocked: string;
  /** 파일 그룹 경계 구분선 이름 */
  groupBoundary: string;
}

/**
 * 편집 조작부(라벨 select·입력, 페이지·문서 메뉴, 끌기 거부 안내)에만 쓰는 공통 문구 키. 두 view
 * (필름스트립·페이지 격자)는 이 키들을 선택으로 받고, 콜백과 문구가 함께 있을 때만 그 조작부를
 * 그린다(짝은 `pairs.ts`). 읽기 전용으로 쓸 때는 이 키들을 빼고 보기 문구만 넘기면 된다.
 */
export type StructureEditLabelKey =
  | "label"
  | "noLabel"
  | "notInConfigOption"
  | "pageMenu"
  | "movePageEarlier"
  | "movePageLater"
  | "moveToDocument"
  | "documentOption"
  | "noOtherDocument"
  | "excludePage"
  | "restorePage"
  | "documentMenu"
  | "mergeWithPrevious"
  | "moveDocumentEarlier"
  | "moveDocumentLater"
  | "dropRejected"
  | "dropRejectedLocked";
