"use client";

import { useEffect, useMemo, useRef } from "react";
import type { FilmstripCallbacks } from "@/components/studio-ui-kit/structure-editor";
import {
  addChange,
  documentPages,
  findDocument,
  findLayout,
  flattenPages,
  flattenSources,
  groupOfFile,
  layouts,
  newDocumentId,
  newGroupId,
  pageKey,
  parsePageKey,
  type ChangeDraft,
  type DropReason,
  type PageRef,
  type ReviewJob,
  type SourceRange,
} from "@/lib/review-model";
import { useJobReview } from "./job-review-context";
import { jobOf, type DocumentSelection } from "./job-review-state";
import {
  batchDrafts,
  type BatchAction,
  type BatchSelection,
} from "./organizer-selection";
import { randomUUID } from "./random-uuid";
import { pagesInRange } from "./structure-toolbar-model";

/** 그룹 `groupId` 의 마지막 문서 바로 다음 자리(없으면 끝)와 그 앞 문서 id. */
export function placementAfterGroup(
  job: ReviewJob,
  stepId: string | null,
  groupId: string,
): { index: number; afterDocumentId: string | null } {
  const documents = findLayout(job, stepId)?.content.documents ?? [];
  let last = -1;
  documents.forEach((document, index) => {
    if (document.group_id === groupId) last = index;
  });
  const at = last >= 0 ? last : documents.length - 1;
  return {
    index: at + 1,
    afterDocumentId: documents[at]?.document_id ?? null,
  };
}

/**
 * 제외 띠·빈 자리 띠의 페이지 하나로 새 문서를 만드는 변경. 제외한 페이지는
 * `restore_pages`(새 문서 대상), 어디에도 없는 페이지는 `add_document` 로 그 그룹의
 * 마지막 문서 뒤에 만든다. 만들 수 없으면 `null`.
 */
export function newDocumentFromPageDraft(
  job: ReviewJob,
  stepId: string | null,
  key: string,
  newId: string,
): ChangeDraft | null {
  const page = parsePageKey(key);
  const groupId = page ? groupOfFile(job, page.file_ref)?.group_id : undefined;
  if (!page || groupId === undefined) return null;
  const { index, afterDocumentId } = placementAfterGroup(job, stepId, groupId);
  let excluded = false;
  try {
    excluded = flattenSources(job.file_groups?.excluded_pages ?? []).some(
      ref => pageKey(ref) === key,
    );
  } catch {
    excluded = false;
  }
  if (excluded) {
    if (afterDocumentId === null) return null;
    return {
      kind: "restore_pages",
      jobId: job.id,
      stepId,
      pages: [page],
      to: { newDocumentId: newId, afterDocumentId },
    };
  }
  return {
    kind: "add_document",
    jobId: job.id,
    stepId,
    newDocumentId: newId,
    groupId,
    label: null,
    sourceFiles: [
      { file_ref: page.file_ref, page_ranges: [[page.page, page.page]] },
    ],
    index,
  };
}

export type AddDocumentInput = {
  groupId: string;
  label: string | null;
  sourceFiles: readonly SourceRange[];
  /** 이 문서 바로 뒤에 넣는다. 없으면 그룹의 마지막 문서 뒤. */
  afterDocumentId: string | null;
};

/** 새 문서 만들기 변경. 넣을 자리는 `afterDocumentId` 다음(찾지 못하면 그룹 끝). */
export function addDocumentDraft(
  job: ReviewJob,
  stepId: string | null,
  input: AddDocumentInput,
  newId: string,
): ChangeDraft {
  const documents = findLayout(job, stepId)?.content.documents ?? [];
  const after =
    input.afterDocumentId === null
      ? -1
      : documents.findIndex(
          document => document.document_id === input.afterDocumentId,
        );
  const index =
    after >= 0
      ? after + 1
      : placementAfterGroup(job, stepId, input.groupId).index;
  return {
    kind: "add_document",
    jobId: job.id,
    stepId,
    newDocumentId: newId,
    groupId: input.groupId,
    label: input.label,
    sourceFiles: input.sourceFiles,
    index,
  };
}

/** 옮긴 페이지를 대상 문서의 어디에 넣는가. `beforePage` 는 대상 문서의 1-based 페이지 번호. */
export type MovePagesPosition = "end" | "start" | { beforePage: number };

/** 페이지를 보낼 곳: 같은 그룹의 문서 안 위치, 또는 라벨을 정한 새 문서(원본 문서 바로 뒤). */
export type MoveDestination =
  | { kind: "document"; documentId: string; position: MovePagesPosition }
  | { kind: "new-document"; label: string | null };

export type MovePagesInput = {
  documentId: string;
  /** 옮길 범위의 첫 페이지(문서 안 1-based). */
  from: number;
  /** 옮길 범위의 끝 페이지(문서 안 1-based, 포함). */
  to: number;
  destination: MoveDestination;
};

/**
 * 페이지 범위를 다른 문서 또는 새 문서(`newId`, 원본 문서 바로 뒤)로 옮기는 변경 하나. 문서가
 * 없거나 범위·위치가 문서 밖이면 `null`.
 */
export function movePagesDraft(
  job: ReviewJob,
  stepId: string | null,
  input: MovePagesInput,
  newId: string,
): ChangeDraft | null {
  const from = findDocument(job, stepId, input.documentId);
  if (!from) return null;
  const pages = pagesInRange(documentPages(from), input.from, input.to);
  if (!pages) return null;
  const destination = input.destination;
  if (destination.kind === "new-document") {
    return {
      kind: "move_pages",
      jobId: job.id,
      stepId,
      fromDocumentId: input.documentId,
      pages,
      to: {
        newDocumentId: newId,
        afterDocumentId: input.documentId,
        label: destination.label,
      },
    };
  }
  const target = findDocument(job, stepId, destination.documentId);
  if (!target) return null;
  const targetLength = documentPages(target).length;
  let index: number;
  if (destination.position === "end") index = targetLength;
  else if (destination.position === "start") index = 0;
  else {
    const before = destination.position.beforePage;
    if (!Number.isInteger(before) || before < 1 || before > targetLength + 1) {
      return null;
    }
    index = before - 1;
  }
  return {
    kind: "move_pages",
    jobId: job.id,
    stepId,
    fromDocumentId: input.documentId,
    pages,
    to: { documentId: destination.documentId, index },
  };
}

/** 편집 뒤 고를 문서와 그 안의 페이지 위치(0-based). */
export type SelectionAfterEdit = { documentId: string; pageIndex: number };

export type { BatchSelection };

/** 일괄 편집 결과. 성공하면 고른 문서·페이지(제외는 없음 — 선택은 reducer 가 보정한다). */
export type BatchOutcome =
  { ok: true; select?: SelectionAfterEdit } | { ok: false; reason: DropReason };

/**
 * 일괄 편집 뒤 고를 자리: 옮기기는 대상 문서에서 첫 변경이 넣은 자리, 새 문서로는 새 문서의 첫
 * 페이지. 제외는 `undefined`.
 */
export function selectionAfterBatch(
  action: BatchAction,
  drafts: readonly ChangeDraft[],
): SelectionAfterEdit | undefined {
  const first = drafts[0];
  if (action.kind === "exclude" || first?.kind !== "move_pages") {
    return undefined;
  }
  const to = first.to;
  return "documentId" in to
    ? { documentId: to.documentId, pageIndex: to.index }
    : { documentId: to.newDocumentId, pageIndex: 0 };
}

/**
 * 선택 문서의 페이지를 다른 문서로 보내 선택 문서가 사라지는 편집이면, 페이지가 간 곳(대상 문서와
 * 거기 붙은 첫 페이지)을 돌려준다. 합치기는 늘 보낸 문서가 사라지고, 페이지 옮기기는 보낸 문서의
 * 페이지를 전부 옮길 때만 사라진다. 그 밖(선택 문서가 남거나 다른 문서를 보는 중)은 `null` 이고
 * 선택은 reducer 가 유지한다. `job` 은 편집 전 Job 이다.
 */
export function selectionAfterEdit(
  job: ReviewJob,
  stepId: string | null,
  draft: ChangeDraft,
  selected: DocumentSelection | null,
): SelectionAfterEdit | null {
  if (!selected || selected.stepId !== stepId) return null;
  const length = (documentId: string): number | null => {
    const document = findDocument(job, stepId, documentId);
    return document ? documentPages(document).length : null;
  };
  if (draft.kind === "merge_documents") {
    if (selected.documentId !== draft.fromDocumentId) return null;
    const into = length(draft.intoDocumentId);
    return into === null
      ? null
      : { documentId: draft.intoDocumentId, pageIndex: into };
  }
  if (draft.kind === "move_pages") {
    if (selected.documentId !== draft.fromDocumentId) return null;
    if (length(draft.fromDocumentId) !== draft.pages.length) return null;
    const to = draft.to;
    if (!("documentId" in to)) {
      return { documentId: to.newDocumentId, pageIndex: 0 };
    }
    const target = length(to.documentId);
    if (target === null) return null;
    // 모델은 끝을 넘는 위치를 끝으로 줄인다.
    return {
      documentId: to.documentId,
      pageIndex: Math.min(Math.max(to.index, 0), target),
    };
  }
  return null;
}

/** 뷰어가 보이는 페이지의 키: 선택 문서의 `pages[clamp(pageIndex)]`. 문서가 없거나 비었으면 `null`. */
export function viewedPageKeyOf(
  job: ReviewJob,
  selected: DocumentSelection | null,
  pageIndex: number,
): string | null {
  if (!selected) return null;
  const document = findDocument(job, selected.stepId, selected.documentId);
  if (!document) return null;
  const pages = documentPages(document);
  if (pages.length === 0) return null;
  const index = Math.min(Math.max(pageIndex, 0), pages.length - 1);
  const viewed = pages[index];
  return viewed ? pageKey(viewed) : null;
}

/** 편집이 페이지를 보낼 수 있는 문서(선택 문서 외에 보던 페이지를 찾아볼 곳). */
export function pageDestinations(draft: ChangeDraft): string[] {
  switch (draft.kind) {
    case "split_document":
      return [draft.newDocumentId];
    case "merge_documents":
      return [draft.intoDocumentId];
    case "move_pages":
    case "restore_pages":
      return [
        "documentId" in draft.to ? draft.to.documentId : draft.to.newDocumentId,
      ];
    default:
      return [];
  }
}

/**
 * 편집 뒤 고를 자리: 선택은 보던 페이지를 따라간다. 적용 뒤 Job 에서 선택 문서와 편집이 페이지를 보낸
 * 문서를 차례로 보며 보던 페이지(`viewedPageKey`)를 찾는다. 선택 문서를 먼저 보므로 같은 페이지가
 * 두 곳에 있으면 남은 쪽이 이긴다. 찾지 못하면(보던 페이지를 제외했거나 키를 모름)
 * `selectionAfterEdit` 로 돌아가고, 그것도 `null` 이면 reducer 가 선택을 보정한다. `before`·`after` 는
 * 편집 전·후 Job 이다.
 */
export function selectionAfterApply(
  before: ReviewJob,
  after: ReviewJob,
  stepId: string | null,
  draft: ChangeDraft,
  selected: DocumentSelection | null,
  viewedPageKey: string | null,
): SelectionAfterEdit | null {
  if (!selected || selected.stepId !== stepId) return null;
  if (viewedPageKey !== null) {
    const candidates = [
      ...new Set([selected.documentId, ...pageDestinations(draft)]),
    ];
    for (const documentId of candidates) {
      const document = findDocument(after, stepId, documentId);
      if (!document) continue;
      const pages = documentPages(document);
      const index = pages.findIndex(page => pageKey(page) === viewedPageKey);
      if (index >= 0) return { documentId, pageIndex: index };
    }
  }
  return selectionAfterEdit(before, stepId, draft, selected);
}

/** 필름스트립 콜백(썸네일 클릭은 화면이 정한다). 제외·복귀·새 문서로는 항상 있다. */
export type FilmstripActions = Omit<FilmstripCallbacks, "onThumbnailClick"> &
  Required<
    Pick<
      FilmstripCallbacks,
      "onExcludeDocument" | "onRestoreDocument" | "onRestoreToNewDocument"
    >
  >;

export type StructureActions = {
  stepId: string | null;
  editable: boolean;
  filmstrip: FilmstripActions;
  /** 문서의 페이지 범위를 지정한 값으로 바꾼다. */
  onSetPageRanges: (
    documentId: string,
    sourceFiles: readonly SourceRange[],
  ) => void;
  /**
   * 새 문서를 만들고 고른다. 적용되지 않으면 사유를 돌려주고 세션은 그대로 둔다
   * (대화 상자가 열린 채 사유를 보이도록).
   */
  onAddDocument: (
    input: AddDocumentInput,
  ) => { ok: true; documentId: string } | { ok: false; reason: DropReason };
  /** 파일을 다른 그룹(`groupId`) 또는 새 그룹(`null`, id 는 여기서 만든다)으로 옮긴다. */
  onMoveFile: (fileRef: string, groupId: string | null) => void;
  /**
   * `afterPageKey` 뒤에서 문서를 나눈다. 선택은 보던 페이지를 따라가므로 보던 페이지가 잘린 꼬리에
   * 있으면 꼬리(새 문서)가, 머리에 있으면 원래 문서가 선택된 채 같은 페이지가 보인다. `documentId` 는
   * 그 뒤 선택된 문서다. 적용되지 않으면 사유를 돌려준다.
   */
  onSplitAndSelect: (
    documentId: string,
    afterPageKey: string,
  ) => { ok: true; documentId: string } | { ok: false; reason: DropReason };
  /** 페이지 범위를 다른 문서 또는 새 문서로 옮긴다. 적용되지 않으면 사유를 돌려주고 세션은 그대로 둔다. */
  onMovePages: (
    input: MovePagesInput,
  ) => { ok: true } | { ok: false; reason: DropReason };
  /**
   * 여러 원본 문서에서 고른 페이지를 한 문서로 옮긴다(전부 옮기거나 하나도 옮기지 않는다). 대상 문서에
   * 든 선택 페이지는 그 자리에 둔다. 성공하면 대상 문서와 옮긴 첫 페이지를 고른다.
   */
  onBatchMove: (
    selection: BatchSelection,
    targetDocumentId: string,
    position: MovePagesPosition,
  ) => BatchOutcome;
  /**
   * 고른 페이지를 끌어 놓은 자리(`index` 는 끄는 페이지를 모두 뺀 뒤 기준)에 문서 순으로 모은다.
   * 대상 문서에 든 고른 페이지도 함께 모인다. 성공하면 대상 문서와 모인 첫 페이지를 고른다.
   */
  onBatchDrop: (
    selection: BatchSelection,
    targetDocumentId: string,
    index: number,
  ) => BatchOutcome;
  /** 고른 페이지를 전부 제외한다(전부 또는 하나도). */
  onBatchExclude: (selection: BatchSelection) => BatchOutcome;
  /**
   * 고른 페이지로 첫 원본 문서 뒤에 `label`(`null` 은 라벨 없음) 새 문서를 만들고 고른다(전부 또는
   * 하나도).
   */
  onBatchNewDocument: (
    selection: BatchSelection,
    label: string | null,
  ) => BatchOutcome;
};

/**
 * 필름스트립 콜백 → 편집 모델 변경(`ChangeDraft`) → `APPLY`. 적용되지 않으면 reducer 가
 * 사유를 `editError` 에 남긴다. 구성 편집은 문서 배치 보기가 하나인 Job 에서만 연다.
 * 대상 보기는 고른 구성 탭의 보기(구성 탭이 아니면 첫 보기)다.
 *
 * 선택은 보던 페이지를 따라간다: 페이지를 움직이는 편집(나누기·페이지 옮기기·합치기·제외·복귀·
 * 순서 바꾸기·범위 지정)은 적용 뒤 보던 페이지가 있는 문서와 그 위치를 고른다(`selectionAfterApply`).
 * 보던 페이지가 남으면 문서는 그대로 두고 위치만 맞춘다. reducer 의 "그 자리 문서" 는 페이지가 간 곳을
 * 모르는 경우(되돌리기·다시 읽기·임시 저장 복원·JSON 가져오기)의 fallback 이다.
 */
export function useStructureActions(): StructureActions {
  const { state, dispatch, job, saving, activeStepTab } = useJobReview();
  const session = state.session;
  const selectedDocument = state.selectedDocument;
  const tabStepId =
    activeStepTab?.kind === "structure" ? activeStepTab.stepId : undefined;
  // 보던 페이지 위치는 편집할 때만 읽는다. memo 의존성에 넣으면 페이지를 넘길 때마다 콜백이 바뀌어
  // 이 콜백을 받는 썸네일 셀이 모두 다시 그려진다.
  const pageIndexRef = useRef(state.selectedPageIndex);
  useEffect(() => {
    pageIndexRef.current = state.selectedPageIndex;
  }, [state.selectedPageIndex]);

  return useMemo(() => {
    const views = job ? layouts(job) : [];
    // 저장 중에는 구성을 고칠 수 없다.
    const editable = Boolean(job?.file_groups) && views.length === 1 && !saving;
    const stepId =
      tabStepId !== undefined ? tabStepId : (views[0]?.step_id ?? null);
    const jobId = job?.id ?? "";
    const apply = (draft: ChangeDraft) => {
      if (editable) dispatch({ type: "APPLY", draft });
    };
    const select = (next: SelectionAfterEdit) => {
      dispatch({
        type: "SELECT_DOCUMENT",
        document: { stepId, documentId: next.documentId },
      });
      if (next.pageIndex > 0) {
        dispatch({ type: "SELECT_PAGE", index: next.pageIndex });
      }
    };
    /** 같은 문서면 위치만 옮겨 하이라이트 선택을 남기고, 다른 문서면 문서부터 고른다. */
    const follow = (next: SelectionAfterEdit) => {
      if (next.documentId === selectedDocument?.documentId) {
        dispatch({ type: "SELECT_PAGE", index: next.pageIndex });
      } else {
        select(next);
      }
    };
    /**
     * 적용해 보고(순수 계산) 맞으면 APPLY 를 보낸 뒤 보던 페이지를 따라간다. 맞지 않으면 사유를
     * 돌려주고 세션은 그대로 둔다.
     */
    const commit = (
      draft: ChangeDraft,
    ):
      | { ok: true; select: SelectionAfterEdit | null }
      | { ok: false; reason: DropReason } => {
      if (!editable || !job || !session) {
        return { ok: false, reason: "target_missing" };
      }
      const outcome = addChange(session, draft);
      if (!outcome.ok) return outcome;
      dispatch({ type: "APPLY", draft });
      const after = jobOf(outcome.session);
      const viewed = viewedPageKeyOf(
        job,
        selectedDocument,
        pageIndexRef.current,
      );
      const next = after
        ? selectionAfterApply(
            job,
            after,
            stepId,
            draft,
            selectedDocument,
            viewed,
          )
        : null;
      if (next) follow(next);
      return { ok: true, select: next };
    };
    /** `commit` 이 맞지 않으면 reducer 가 사유를 `editError` 에 남기도록 APPLY 를 그대로 보낸다. */
    const applyAndFollow = (draft: ChangeDraft) => {
      if (!commit(draft).ok) apply(draft);
    };
    const ref = (key: string): PageRef | null => parsePageKey(key);
    /** 문서 안 위치(0-based)의 페이지. 겹친 페이지가 있어도 키로 찾는다. */
    const pageIn = (documentId: string, key: string): PageRef | null => {
      if (!job) return null;
      const document = findDocument(job, stepId, documentId);
      if (!document) return null;
      try {
        return (
          flattenPages(document).find(page => pageKey(page) === key) ?? null
        );
      } catch {
        return null;
      }
    };

    /**
     * 일괄 변경을 만들어 순서대로 적용해 보고(순수 계산) 모두 맞을 때만 한 액션으로 보낸 뒤 고를
     * 자리를 고른다. 실패하면 사유를 돌려주고 세션은 그대로 둔다.
     */
    const applyBatch = (
      selection: BatchSelection,
      action: BatchAction,
    ): BatchOutcome => {
      if (!editable || !job || !session) {
        return { ok: false, reason: "target_missing" };
      }
      const drafts = batchDrafts(job, stepId, selection, action, {
        newDocumentId: newDocumentId(randomUUID),
        batchId: randomUUID(),
      });
      if (!Array.isArray(drafts)) return { ok: false, reason: drafts.reason };
      let trial = session;
      for (const draft of drafts) {
        const outcome = addChange(trial, draft);
        if (!outcome.ok) return outcome;
        trial = outcome.session;
      }
      dispatch({ type: "APPLY_BATCH", drafts });
      const next = selectionAfterBatch(action, drafts);
      if (!next) return { ok: true };
      select(next);
      return { ok: true, select: next };
    };

    const filmstrip: FilmstripActions = {
      onReorderPage: (documentId, key, toIndex) => {
        const page = pageIn(documentId, key);
        if (!page) return;
        applyAndFollow({
          kind: "reorder_pages",
          jobId,
          stepId,
          documentId,
          page,
          toIndex,
        });
      },
      onMovePage: (fromDocumentId, key, toDocumentId, toIndex) => {
        const page = pageIn(fromDocumentId, key);
        if (!page) return;
        applyAndFollow({
          kind: "move_pages",
          jobId,
          stepId,
          fromDocumentId,
          pages: [page],
          to: { documentId: toDocumentId, index: toIndex },
        });
      },
      onSplit: (documentId, afterKey) => {
        const afterPage = pageIn(documentId, afterKey);
        if (!afterPage) return;
        applyAndFollow({
          kind: "split_document",
          jobId,
          stepId,
          documentId,
          afterPage,
          newDocumentId: newDocumentId(randomUUID),
        });
      },
      onMergeInto: (fromDocumentId, intoDocumentId) =>
        applyAndFollow({
          kind: "merge_documents",
          jobId,
          stepId,
          intoDocumentId,
          fromDocumentId,
        }),
      onReorderDocument: (documentId, toIndex) =>
        apply({
          kind: "reorder_documents",
          jobId,
          stepId,
          documentId,
          toIndex,
        }),
      onExcludePage: (fromDocumentId, key) => {
        const page = pageIn(fromDocumentId, key);
        if (!page) return;
        applyAndFollow({
          kind: "exclude_pages",
          jobId,
          stepId,
          fromDocumentId,
          pages: [page],
        });
      },
      onRestorePage: (key, toDocumentId, toIndex) => {
        const page = ref(key);
        if (!page) return;
        applyAndFollow({
          kind: "restore_pages",
          jobId,
          stepId,
          pages: [page],
          to: { documentId: toDocumentId, index: toIndex },
        });
      },
      onLabelChange: (documentId, label) =>
        apply({ kind: "set_label", jobId, stepId, documentId, label }),
      onExcludeDocument: documentId =>
        apply({ kind: "exclude_document", jobId, documentId }),
      onRestoreDocument: documentId =>
        apply({ kind: "restore_document", jobId, documentId }),
      onRestoreToNewDocument: key => {
        if (!job) return;
        const draft = newDocumentFromPageDraft(
          job,
          stepId,
          key,
          newDocumentId(randomUUID),
        );
        if (draft) apply(draft);
      },
    };

    return {
      stepId,
      editable,
      filmstrip,
      onSetPageRanges: (documentId, sourceFiles) =>
        applyAndFollow({
          kind: "set_page_ranges",
          jobId,
          stepId,
          documentId,
          sourceFiles,
        }),
      onAddDocument: input => {
        if (!editable || !job || !session) {
          return { ok: false, reason: "target_missing" };
        }
        const id = newDocumentId(randomUUID);
        const draft = addDocumentDraft(job, stepId, input, id);
        // 대화 상자가 사유를 보일 수 있게 먼저 적용해 본다(순수 계산이라 상태는 그대로).
        const outcome = addChange(session, draft);
        if (!outcome.ok) return outcome;
        dispatch({ type: "APPLY", draft });
        dispatch({
          type: "SELECT_DOCUMENT",
          document: { stepId, documentId: id },
        });
        return { ok: true, documentId: id };
      },
      onMoveFile: (fileRef, groupId) =>
        apply({
          kind: "move_file",
          jobId,
          fileRef,
          to:
            groupId === null
              ? { newGroupId: newGroupId(randomUUID) }
              : { groupId },
        }),
      onSplitAndSelect: (documentId, afterPageKey) => {
        if (!editable || !job || !session) {
          return { ok: false, reason: "target_missing" };
        }
        const afterPage = pageIn(documentId, afterPageKey);
        if (!afterPage) return { ok: false, reason: "page_not_in_document" };
        const id = newDocumentId(randomUUID);
        const draft: ChangeDraft = {
          kind: "split_document",
          jobId,
          stepId,
          documentId,
          afterPage,
          newDocumentId: id,
        };
        const outcome = commit(draft);
        if (!outcome.ok) return outcome;
        return {
          ok: true,
          documentId: outcome.select?.documentId ?? documentId,
        };
      },
      onBatchMove: (selection, targetDocumentId, position) =>
        applyBatch(selection, {
          kind: "move",
          targetDocumentId,
          position,
        }),
      onBatchDrop: (selection, targetDocumentId, index) =>
        applyBatch(selection, { kind: "drop", targetDocumentId, index }),
      onBatchExclude: selection => applyBatch(selection, { kind: "exclude" }),
      onBatchNewDocument: (selection, label) =>
        applyBatch(selection, { kind: "new-document", label }),
      onMovePages: input => {
        if (!editable || !job || !session) {
          return { ok: false, reason: "target_missing" };
        }
        const draft = movePagesDraft(
          job,
          stepId,
          input,
          newDocumentId(randomUUID),
        );
        if (!draft) return { ok: false, reason: "target_missing" };
        const outcome = commit(draft);
        return outcome.ok ? { ok: true } : outcome;
      },
    };
  }, [dispatch, job, saving, selectedDocument, session, tabStepId]);
}
