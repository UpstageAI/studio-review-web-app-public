export interface StructurePage {
  key: string;
  fileRef: string;
  /** 파일 안 페이지(1-based). */
  page: number;
  thumbnailUrl: string | null;
  /** 저장 전 검증 표시: 빈 자리(빨간 점선) · 다른 문서와 겹침(빨간 실선 테두리). */
  issue?: "missing" | "overlap";
}

/** 제외·빠진 페이지 자리의 페이지. 같은 그룹 문서로만 되돌릴 수 있다. */
export interface StructureLoosePage extends StructurePage {
  groupId: string;
}

/** 문서 하나(필름스트립의 띠 하나, 페이지 격자의 머리 행 + 셀 줄). */
export interface StructureDocument {
  documentId: string;
  label: string | null;
  /** 설정이 허용하는 라벨. 있으면 select, 없으면 자유 입력. */
  labelChoices?: readonly string[];
  /** 현재 라벨이 설정에 없다(저장은 된다). */
  labelNotInConfig?: boolean;
  /** 파일 그룹. 페이지는 같은 그룹 문서 사이에서만 오간다. */
  groupId: string;
  pages: readonly StructurePage[];
  /** 흐리게 보이고 조작을 받지 않는다. */
  locked?: boolean;
  /** 제외한 문서. 흐리게 보이고 배지가 붙는다(조작은 그대로 받는다). */
  excluded?: boolean;
}

/** 뷰어가 보고 있는 페이지. */
export interface StructureSelectedPage {
  documentId: string;
  pageKey: string;
}

/** 썸네일을 누를 때 함께 눌린 보조 키. `toggle` 은 ⌘(mac)·Ctrl. */
export interface StructureClickModifiers {
  shift: boolean;
  toggle: boolean;
}

/** 사용자에게 문구로 알리는 drop 거부 사유: 잠긴(또는 없는) 문서 · 다른 파일 그룹. */
export type StructureRejectReason = "locked" | "group";

/** 포인터가 가리키는 drop 자리: 문서의 `index` 앞(끝이면 `pages.length`) 또는 제외 자리. */
// prettier-ignore
export type StructureDropSpot =
  { kind: "pages"; documentId: string; index: number } | { kind: "excluded" };

/** `menuButtonsRef` 로 받는 조회 수단. */
export interface StructureMenuButtons {
  /** 지금 그려진 그 문서의 메뉴(⋯) 버튼. 부를 때 찾으며, 그려져 있지 않으면 `null`. */
  get(documentId: string): HTMLElement | null;
}
