// 값 패널 필터(바뀐 값만, 빈 값만, 현재 페이지 값만)의 순수 규칙. 브라우저 기억은 `localStorage` 한 키에
// JSON 으로 두고, 읽기·쓰기는 저장소가 막혀 있어도 던지지 않는다(없으면 필터 없음).

export type ValueFilter = {
  /** 원본 값과 다른 leaf 만 보인다. */
  readonly changedOnly: boolean;
  /** 보고 있는 뷰어 페이지에 위치가 있는 leaf 만 보인다(위치가 없는 값은 숨긴다). */
  readonly currentPageOnly: boolean;
  /** 빈 leaf(`null`, 빈 문자열, 공백만 있는 문자열)만 보인다. */
  readonly emptyOnly: boolean;
};

/** 브라우저에 기억하는 키. 값은 `{"changedOnly":boolean,"currentPageOnly":boolean,"emptyOnly":boolean}` JSON. */
export const VALUE_FILTER_KEY = "review-value-filter";

const EMPTY_SET: ReadonlySet<string> = new Set();

export const NO_VALUE_FILTER: ValueFilter = Object.freeze({
  changedOnly: false,
  currentPageOnly: false,
  emptyOnly: false,
});

/** 저장소 값 → 필터. 없음, 깨진 JSON, 모르는 모양은 필터 없음. 모두 꺼진 값은 공유 상수로 돌려준다. */
export function parseValueFilter(raw: string | null): ValueFilter {
  if (raw === null) return NO_VALUE_FILTER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_VALUE_FILTER;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NO_VALUE_FILTER;
  }
  const record = parsed as Record<string, unknown>;
  const filter: ValueFilter = {
    changedOnly: record.changedOnly === true,
    currentPageOnly: record.currentPageOnly === true,
    emptyOnly: record.emptyOnly === true,
  };
  return isFiltering(filter) ? filter : NO_VALUE_FILTER;
}

export function readValueFilter(
  storage: Pick<Storage, "getItem"> | null,
): ValueFilter {
  try {
    return parseValueFilter(storage?.getItem(VALUE_FILTER_KEY) ?? null);
  } catch {
    return NO_VALUE_FILTER;
  }
}

export function writeValueFilter(
  storage: Pick<Storage, "setItem"> | null,
  filter: ValueFilter,
): void {
  try {
    storage?.setItem(
      VALUE_FILTER_KEY,
      JSON.stringify({
        changedOnly: filter.changedOnly,
        currentPageOnly: filter.currentPageOnly,
        emptyOnly: filter.emptyOnly,
      }),
    );
  } catch {
    // 저장소가 가득 찼거나 막혀 있으면 기억하지 않는다.
  }
}

/** 하나라도 켜져 있는가. */
export function isFiltering(filter: ValueFilter): boolean {
  return filter.changedOnly || filter.currentPageOnly || filter.emptyOnly;
}

/**
 * leaf pointer 가 보이는지 판정하는 함수. 모두 꺼져 있으면 `undefined`(필터 없음, 트리가 기존
 * 경로를 그대로 탄다). "바뀐 값만" 은 `changed` 집합, "빈 값만" 은 `empty` 집합, "현재 페이지 값만" 은
 * 그 pointer 의 하이라이트가 `pageIndex` 를 가리킬 때만(하이라이트가 없으면 숨김). 여럿이 켜져 있으면
 * 모두 만족해야 한다.
 */
export function visiblePointerFor({
  filter,
  changed,
  empty = EMPTY_SET,
  highlights,
  pageIndex,
}: {
  filter: ValueFilter;
  changed: ReadonlySet<string>;
  /** 빈 leaf pointer 집합. "빈 값만" 이 꺼져 있으면 넘기지 않아도 된다. */
  empty?: ReadonlySet<string>;
  highlights: ReadonlyMap<string, { readonly viewerIndex: number }>;
  pageIndex: number;
}): ((pointer: string) => boolean) | undefined {
  const tests: ((pointer: string) => boolean)[] = [];
  if (filter.changedOnly) tests.push(pointer => changed.has(pointer));
  if (filter.emptyOnly) tests.push(pointer => empty.has(pointer));
  if (filter.currentPageOnly) {
    tests.push(pointer => highlights.get(pointer)?.viewerIndex === pageIndex);
  }
  if (tests.length === 0) return undefined;
  const [only] = tests;
  if (tests.length === 1 && only) return only;
  return pointer => tests.every(test => test(pointer));
}

/**
 * 트리가 그릴 노드 pointer 집합: `visible` 을 통과한 leaf 와 그 조상 전부. `alwaysVisible`(선택·오류
 * pointer)은 필터와 무관하게 조상과 함께 넣는다. 루트(`""`)는 늘 그리므로 넣지 않는다.
 */
export function visibleNodeSet(
  leafPointers: Iterable<string>,
  visible: (pointer: string) => boolean,
  alwaysVisible: Iterable<string | null> = [],
): Set<string> {
  const nodes = new Set<string>();
  const addWithAncestors = (pointer: string) => {
    let current = pointer;
    while (current !== "" && !nodes.has(current)) {
      nodes.add(current);
      current = current.slice(0, current.lastIndexOf("/"));
    }
  };
  for (const pointer of leafPointers) {
    if (visible(pointer)) addWithAncestors(pointer);
  }
  for (const pointer of alwaysVisible) {
    if (pointer !== null) addWithAncestors(pointer);
  }
  return nodes;
}

/** `visible` 이 거르는 leaf 수. 필터가 없으면 0. */
export function countHidden(
  leafPointers: Iterable<string>,
  visible: ((pointer: string) => boolean) | undefined,
): number {
  if (!visible) return 0;
  let hidden = 0;
  for (const pointer of leafPointers) {
    if (!visible(pointer)) hidden += 1;
  }
  return hidden;
}
