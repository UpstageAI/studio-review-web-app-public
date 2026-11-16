import type { PageRangeRow } from "./page-range-editor";

/**
 * 편집 중인 행. `id` 는 행이 지워져 뒤 행이 당겨져도 그 행을 따라가는 key, `origin` 은 Esc 로
 * 돌아갈 값(확정 값에서 온 행은 그 값, 새로 더한 행은 처음 값)이다.
 */
export interface RangeDraft extends PageRangeRow {
  id: number;
  origin: PageRangeRow;
}

function nextId(drafts: readonly RangeDraft[]): number {
  return drafts.reduce((max, draft) => Math.max(max, draft.id + 1), 0);
}

/**
 * 확정 값으로 편집 중인 행을 다시 채운다. 같은 자리의 행은 id 를 이어 받아 입력 DOM 이 유지되고,
 * 늘어난 자리만 새 id 를 받는다.
 */
export function syncDrafts(
  drafts: readonly RangeDraft[],
  rows: readonly PageRangeRow[],
): RangeDraft[] {
  let fresh = nextId(drafts);
  return rows.map((row, index) => ({
    id: drafts[index]?.id ?? fresh++,
    origin: { fileRef: row.fileRef, text: row.text },
    fileRef: row.fileRef,
    text: row.text,
  }));
}

/** 끝에 새 행을 더한다. Esc 는 이 처음 값으로 돌아간다. */
export function appendDraft(
  drafts: readonly RangeDraft[],
  row: PageRangeRow,
): RangeDraft[] {
  return [
    ...drafts,
    {
      id: nextId(drafts),
      origin: { fileRef: row.fileRef, text: row.text },
      fileRef: row.fileRef,
      text: row.text,
    },
  ];
}

/** `index` 행을 바꾼다(`id`·`origin` 은 그대로). */
export function editDraft(
  drafts: readonly RangeDraft[],
  index: number,
  patch: Partial<PageRangeRow>,
): RangeDraft[] {
  return drafts.map((draft, i) =>
    i === index ? { ...draft, ...patch } : draft,
  );
}

/** `index` 행을 그 행의 `origin` 으로 되돌린다. */
export function revertDraft(
  drafts: readonly RangeDraft[],
  index: number,
): RangeDraft[] {
  return drafts.map((draft, i) =>
    i === index
      ? { ...draft, fileRef: draft.origin.fileRef, text: draft.origin.text }
      : draft,
  );
}

/** 콜백에 넘길 행(`fileRef`·`text` 만). */
export function rowsOf(drafts: readonly RangeDraft[]): PageRangeRow[] {
  return drafts.map(({ fileRef, text }) => ({ fileRef, text }));
}
