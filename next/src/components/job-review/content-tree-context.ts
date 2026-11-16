"use client";

// 값 트리(`ContentTree`)와 그 조각(배열 표, 노드 메뉴)이 함께 쓰는 props, context 타입과 helper.

import { createContext, use } from "react";
import {
  toPointer,
  type JsonPath,
  type JsonValue,
  type PairedHighlight,
  type Result,
  type ReviewStep,
  type SchemaMatch,
  type SchemaNode,
  type ValueDraft,
} from "@/lib/review-model";
import type { FieldError } from "./field-errors";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** 결과 하나 안에서 만드는 값 변경(`jobId`, `resultId` 는 패널이 붙인다). */
export type ValueEdit = DistributiveOmit<ValueDraft, "jobId" | "resultId">;

export interface ContentTreeProps {
  result: Result;
  baseResult: Result | undefined;
  step: ReviewStep | undefined;
  locked: boolean;
  /** pointer → 추출값 하이라이트(선택 문서에 그려지는 것만). */
  highlights: ReadonlyMap<string, PairedHighlight>;
  selectedHighlightId: string | null;
  /**
   * pointer → 행 오류(서버 오류, schema 검사). 오류는 pointer 가 가리키는 노드에 보인다: leaf 는 그 값
   * 행, 배열, 중첩 객체는 묶음 머리 아래, 배열 안 객체 항목은 순번 줄 아래, 루트 객체는 트리 맨 위.
   */
  errors: ReadonlyMap<string, FieldError>;
  /** `errors` 의 키(같은 Map 이면 같은 배열). 큰 배열이 첫 오류 항목까지 펼칠 때 쓴다. */
  errorPointers: readonly string[];
  /** 결과 전체를 JSON 으로 고치는 대화 상자를 연다(긴 문자열 요약에서). 잠겨 있으면 없음. */
  onEditJson?: () => void;
  /**
   * 필터가 켜져 있을 때 그릴 노드 pointer 집합(보이는 leaf 와 그 조상, `visibleNodeSet`). 없으면
   * 필터 없음(모든 행). 거른 leaf 와 비는 묶음은 그리지 않는다. 선택, 오류 행은 호출하는 쪽이 넣는다.
   */
  visibleNodes?: ReadonlySet<string> | null;
  /**
   * "필드" 메뉴로 고른 보이는 맨 위 필드 키. 없으면 모든 필드. 다른 맨 위 필드와 그 아래는 그리지 않고
   * "필드 추가" 에도 넣지 않는다. 묶음 펼침은 `visibleNodes` 필터와 달리 평소대로 둔다.
   */
  visibleFields?: ReadonlySet<string> | null;
  /** 값 행 아래에 schema 설명을 보인다(기본 숨김). "필드 추가" 메뉴의 설명은 늘 보인다. */
  showDescription?: boolean;
  onSelectHighlight: (highlight: PairedHighlight) => void;
  onHoverHighlight: (id: string | null) => void;
  onApply: (resultId: string, path: JsonPath, value: JsonValue) => void;
  /**
   * 지금 경로의 처음 값(배열 항목을 넣고 옮긴 변경을 되짚어 찾는다). 처음에 없던 자리면 `undefined`.
   * 입력칸을 비웠을 때 `null` 로 돌릴지 정한다. 없으면 같은 위치 경로의 처음 값을 쓴다.
   */
  originalValueAt?: (resultId: string, path: JsonPath) => JsonValue | undefined;
  onRevert: (resultId: string, path: JsonPath) => void;
  onEdit: (resultId: string, edit: ValueEdit) => void;
  /**
   * 하이라이트가 없을 수도 있는 행(`resultId` 안 `pointer`)을 선택한다. 뷰어 페이지는 옮기지 않는다.
   * "항목 추가" 가 새 항목을 선택 행으로 만들어 필터 중에도 보이게 할 때 쓴다.
   */
  onSelectPointer?: (resultId: string, pointer: string) => void;
}

export type Parent =
  | {
      readonly kind: "object";
      readonly path: JsonPath;
      readonly match: SchemaMatch | null;
      readonly key: string;
      /** 그려지는 순서의 형제 키(`key` 포함). 필드를 지운 뒤 포커스를 줄 이웃을 고른다. */
      readonly siblings: readonly string[];
    }
  | {
      readonly kind: "array";
      readonly path: JsonPath;
      readonly index: number;
      readonly length: number;
      readonly min: number | undefined;
    };

export type TreeContextValue = {
  props: ContentTreeProps;
  schema: SchemaNode | null;
  baseContent: JsonValue | undefined;
  selectedPointer: string | null;
  /** 오류가 있는 pointer 들(`errors` 의 키). */
  errorPointers: readonly string[];
  errorAt: (pointer: string) => FieldError | null;
  /** `pointer` 아래(자신 제외)에 오류가 있다. 접힌 묶음을 펼칠 때 쓴다. */
  hasErrorUnder: (pointer: string) => boolean;
  matchAt: (path: JsonPath, value?: JsonValue) => SchemaMatch | null;
  templateAt: (path: JsonPath) => JsonValue;
  /** 변경을 쌓고, 적용된 뒤 `focusPath` 의 첫 입력에 포커스를 준다. */
  edit: (edit: ValueEdit, focusPath?: JsonPath) => void;
  hasPendingFocus: () => boolean;
  isOpen: (pointer: string, leafCount: number) => boolean;
  setOpen: (pointer: string, open: boolean) => void;
  /** `visibleNodes` 필터가 켜져 있다(묶음은 닫아 둔 것 말고 모두 펼친다). */
  filtering: boolean;
  /**
   * 이 노드를 그릴지. 숨긴 맨 위 필드 아래는 늘 거짓. 그 밖에는 필터가 없으면 참, 있으면 보이는 leaf
   * 이거나 그런 leaf 를 품은 컨테이너.
   */
  isVisible: (path: JsonPath) => boolean;
  /** 이 경로의 맨 위 필드가 보이는가("필드" 메뉴). 루트는 늘 참. */
  isFieldShown: (path: JsonPath) => boolean;
  /**
   * 배열 `pointer` 가 지금 그릴 항목 수. `count` 는 그릴 후보 수, `needed` 는 꼭 보여야 하는 후보
   * 위치(선택, 오류 항목, 없으면 `null`), 그 위치까지 묶음 단위로 늘린다.
   */
  itemLimit: (pointer: string, count: number, needed: number | null) => number;
  /** 배열 `pointer` 의 한도를 적어도 `atLeast` 로 늘린다(이미 넉넉하면 그대로). */
  extendItems: (pointer: string, atLeast: number) => void;
  /**
   * 배열 `pointer` 를 자동으로 펼칠 이유 `key`(`autoOpenKey`)를 기록하고, 직전 이유와 달라 지금
   * 펼쳐야 하면 참. `null` 이면 기록을 지워 다음에 필요해질 때 다시 펼치게 한다.
   */
  markAutoOpen: (pointer: string, key: string | null) => boolean;
};

export const TreeContext = createContext<TreeContextValue | null>(null);

export function useTree(): TreeContextValue {
  const value = use(TreeContext);
  if (!value) throw new Error("ContentTree context missing");
  return value;
}

/** 트리 노드의 DOM id(`data-field-id`, `data-node-id`): 결과 id + `#` + pointer. */
export function nodeId(resultId: string, path: JsonPath): string {
  return `${resultId}#${toPointer(path)}`;
}
