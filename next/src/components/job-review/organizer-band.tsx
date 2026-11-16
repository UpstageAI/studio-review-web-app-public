"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  PageGrid,
  type StructureClickModifiers,
  type PageGridLabels,
  type StructureMenuButtons,
  type StructurePage,
} from "@/components/studio-ui-kit/structure-editor";
import {
  DOCUMENT_LABEL_MAX_LENGTH,
  labelChoices,
  pageKey,
  type DropReason,
} from "@/lib/review-model";
import { DocumentPositionDialog } from "./document-position-dialog";
import { useJobReview } from "./job-review-context";
import { MovePagesDialog } from "./move-pages-dialog";
import { movePagesTargets, type MovePagesTarget } from "./move-pages-targets";
import { useOrganizer } from "./organizer-context";
import {
  applyClick,
  EMPTY_SELECTION,
  formatPageRuns,
  groupSelection,
  orderedPages,
  pruneSelection,
  splitTargetOf,
  type SelectionState,
} from "./organizer-selection";
import { OrganizerSelectionBar } from "./organizer-selection-bar";
import { markSelectPage } from "./perf-marks";
import { buildStructureView, groupBlockOf } from "./structure-view";
import { useDropReasonText } from "./use-drop-reason-text";
import { useStructureActions } from "./use-structure-actions";

/** 여러 장 선택과 그 선택을 만든 문서 배치 보기. 보기가 바뀌면 선택은 비운다. */
type ScopedSelection = SelectionState & { scope: string | null };

/** Esc 를 입력 요소에 맡기는 대상(라벨 입력 등). */
const TEXT_ENTRY = "input, textarea, select, [contenteditable='true']";

/**
 * 구성 모드의 페이지 정리 화면: 작업 패널 자리에 들어가는 문서별 썸네일 격자. 필름스트립과 같은
 * 문서 배치 보기(`buildStructureView`)를 그대로 넘기고, 썸네일을 누르면 옆 뷰어가 그 페이지로 간다.
 * 편집(드래그·셀 메뉴·머리 라벨·머리 메뉴)은 `useStructureActions().filmstrip` 콜백을 그대로 쓰고,
 * 머리 메뉴 "위치 지정…" 은 필름스트립과 같은 대화상자로 같은 파일 그룹 구간 안 번호를 받는다. 넓은
 * 화면을 창 높이에 맞출 때는 패널에 남은 높이를 채우고 격자 안에서만 스크롤한다.
 *
 * 여러 장 선택: ⌘/Ctrl+클릭은 한 장씩 넣고 빼고, Shift+클릭은 기준 페이지부터 문서 경계를 넘어 범위를
 * 고른다. 그냥 클릭은 선택을 비운다. 어떤 클릭이든 뷰어는 누른 페이지로 간다. 고른 페이지는 격자 위
 * 일괄 바로 한 번에 옮기거나 제외하거나 새 문서로 보낸다(고른 것이 없을 때도 바 자리에 힌트 줄을 두어
 * 선택이 생기고 비어도 격자가 밀리지 않는다). 겹친 페이지·잠긴 문서의 페이지는 고를 수 없다(클릭하면
 * 뷰어만 간다). 고른 페이지 중 하나를 끌면 고른 페이지 전부가 함께 옮겨지고(일괄 바와 같은 일괄 편집),
 * 고르지 않은 페이지를 끌면 선택을 비우고 그 한 장만 옮긴다. 선택은 이 화면의 지역 상태라 화면을 닫거나
 * 보기를 바꾸면 사라지고, 편집으로 없어진 페이지는 빠진다. Esc(입력 요소 밖)로 비운다.
 */
export function OrganizerBand() {
  const t = useTranslations("review.filmstrip");
  const to = useTranslations("review.organizer");
  const ts = useTranslations("review.structure");
  const reasonText = useDropReasonText();
  const { state, dispatch, job, selected, docPages, issues } = useJobReview();
  const { files, session, selectedPageIndex, editError } = state;
  const tsel = useTranslations("review.organizer.selection");
  const {
    stepId,
    editable,
    filmstrip,
    onBatchMove,
    onBatchDrop,
    onBatchExclude,
    onBatchNewDocument,
    onSplitAndSelect,
  } = useStructureActions();
  // 크기 토글은 정리 화면 머리 줄(`OrganizerHeader`)에 있어 격자에는 크기만 넘긴다.
  const { size } = useOrganizer();
  const [positioning, setPositioning] = useState<{
    documentId: string;
    index: number;
    /** 옮길 수 있는 범위(1-based): 같은 파일 그룹이 이어진 구간. */
    block: { first: number; last: number };
  } | null>(null);
  // "위치 지정…" 을 연 문서. 닫힌 뒤 그 문서의 머리 메뉴 버튼으로 포커스를 돌려준다.
  const positionedDocument = useRef<string | null>(null);
  const menuButtons = useRef<StructureMenuButtons>(null);
  const [stored, setStored] = useState<ScopedSelection>(() => ({
    ...EMPTY_SELECTION,
    scope: stepId,
  }));
  const [batchError, setBatchError] = useState<DropReason | null>(null);
  // 고른 페이지를 보내는 대화 상자. "새 문서로 분리…" 는 새 문서를 미리 고른 채 연다.
  const [movingSelection, setMovingSelection] = useState<{
    initialTarget?: "new-document";
  } | null>(null);

  const view = useMemo(
    () =>
      job && session
        ? buildStructureView({
            doc: session.current,
            job,
            files,
            issues,
            layoutStepId: stepId,
          })
        : null,
    [job, session, files, issues, stepId],
  );

  const order = useMemo(() => (view ? orderedPages(view.strips) : []), [view]);
  // 편집으로 없어진 페이지를 빼고, 보기가 바뀌었으면 비운다. 바뀐 것이 없으면 `pruneSelection` 이 같은
  // 객체를 돌려주므로 다시 그리지 않는다(렌더 중 상태 보정).
  const base: ScopedSelection =
    stored.scope === stepId ? stored : { ...EMPTY_SELECTION, scope: stepId };
  const selection = pruneSelection(base, order);
  if (selection !== stored) setStored({ ...selection, scope: stepId });

  const fileNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const group of job?.file_groups?.groups ?? []) {
      for (const file of group.files) names.set(file.file_ref, file.name);
    }
    return names;
  }, [job]);
  const multiFile = fileNames.size > 1;

  const labels = useMemo<PageGridLabels>(() => {
    const pageName = (page: StructurePage) =>
      multiFile
        ? t("pageInFile", {
            page: page.page,
            file: fileNames.get(page.fileRef) ?? page.fileRef,
          })
        : t("page", { page: page.page });
    return {
      region: to("region"),
      document: index => t("document", { index }),
      untitled: t("untitled"),
      label: t("label"),
      noLabel: t("noLabel"),
      notInConfigOption: label => t("notInConfigOption", { label }),
      notInConfigBadge: t("notInConfigBadge"),
      notInConfigHint: t("notInConfigHint"),
      pageCount: count => t("pageCount", { count }),
      page: pageName,
      noImage: t("noImage"),
      pageMenu: page => t("pageMenu", { page: pageName(page) }),
      movePageEarlier: to("moveEarlier"),
      movePageLater: to("moveLater"),
      moveToDocument: t("moveToDocument"),
      documentOption: (index, label) =>
        t("documentOption", { index, label: label ?? t("untitled") }),
      noOtherDocument: t("noOtherDocument"),
      splitBefore: page => to("splitBefore", { page: pageName(page) }),
      excludePage: t("excludePage"),
      restorePage: t("restorePage"),
      restoreToNewDocument: t("restoreToNewDocument"),
      documentMenu: index => t("documentMenu", { index }),
      mergeWithPrevious: t("mergeWithPrevious"),
      moveDocumentEarlier: t("moveDocumentEarlier"),
      moveDocumentLater: t("moveDocumentLater"),
      moveDocumentTo: t("moveDocumentTo"),
      documentExclusion: {
        exclude: t("excludeDocument"),
        restore: t("restoreDocument"),
        badge: t("excludedDocument"),
      },
      excluded: t("excluded"),
      excludedEmpty: t("excludedEmpty"),
      unplaced: t("unplaced"),
      unplacedMenu: page => t("unplacedMenu", { page: pageName(page) }),
      missing: t("missing"),
      overlap: t("overlap"),
      dropRejected: t("dropRejected"),
      dropRejectedLocked: t("dropRejectedLocked"),
      groupBoundary: t("groupBoundary"),
      sizeToggle: {
        size: to("size"),
        sizeSmall: to("sizeSmall"),
        sizeMedium: to("sizeMedium"),
      },
      multiDrag: {
        dragCount: count => to("dragCount", { count }),
        dragging: count => to("dragging", { count }),
      },
    };
  }, [t, to, fileNames, multiFile]);

  const selectedRef = docPages[selectedPageIndex];
  const selectedDocumentId = selected?.document.document_id ?? null;
  const selectedPage =
    selectedDocumentId !== null && selectedRef
      ? { documentId: selectedDocumentId, pageKey: pageKey(selectedRef) }
      : null;

  // 썸네일 클릭 → 여러 장 선택을 보조 키대로 바꾸고, 그 문서·페이지를 뷰어에. 제외 칸 페이지는
  // 뷰어가 가리킬 수 없고 고를 수도 없어 무시한다. memo 한 셀이 같은 콜백 참조를 받도록 고정한다.
  const onThumbnailClick = useCallback(
    (
      documentId: string | null,
      key: string,
      index: number,
      modifiers: StructureClickModifiers,
    ) => {
      if (documentId === null) return;
      setStored(previous => ({
        ...applyClick(
          previous.scope === stepId ? previous : EMPTY_SELECTION,
          order,
          key,
          modifiers,
        ),
        scope: stepId,
      }));
      setBatchError(null);
      dispatch({ type: "SELECT_DOCUMENT", document: { stepId, documentId } });
      markSelectPage(index, "organizer");
      dispatch({ type: "SELECT_PAGE", index });
    },
    [dispatch, stepId, order],
  );

  const strips = view?.strips;
  // 머리 메뉴 "위치 지정…" → 같은 그룹이 이어진 구간의 번호만 받는 대화상자. memo 한 셀·머리가 같은
  // 참조를 받도록 문서 배치가 바뀔 때만 새로 만든다.
  const onRequestDocumentPosition = useCallback(
    (documentId: string, index: number) => {
      if (!strips) return;
      positionedDocument.current = documentId;
      const block = groupBlockOf(strips, index);
      setPositioning({
        documentId,
        index,
        block: { first: block.first + 1, last: block.last + 1 },
      });
    },
    [strips],
  );

  if (!view) return null;

  const clearSelection = () => {
    setStored({ ...EMPTY_SELECTION, scope: stepId });
    setBatchError(null);
  };
  const batch = groupSelection(selection.keys, view.strips);
  const mixedGroups = new Set(batch.map(item => item.groupId)).size > 1;
  const split = splitTargetOf(batch, view.strips);
  const stripIndex = new Map(
    view.strips.map((strip, index) => [strip.documentId, index]),
  );
  // 새 문서 라벨의 기본값: 첫 원본 문서의 라벨. 고를 수 있는 라벨도 첫 원본 기준.
  const firstLabel = batch[0]
    ? (view.strips[stripIndex.get(batch[0].documentId) ?? -1]?.label ?? null)
    : null;
  const firstChoices =
    batch[0] && session && job
      ? labelChoices(session.current, job, batch[0].documentId, stepId)
      : null;
  // 옮길 곳: 고른 페이지와 같은 그룹의 잠기지 않은 문서. 고른 페이지가 든 문서도 대상이 될 수 있다
  // (그 문서의 고른 페이지는 제자리에 남는다) — 고른 페이지가 모두 한 문서에 있으면 그 문서는 뺀다.
  const onlyDocumentId = batch.length === 1 ? batch[0]!.documentId : null;
  const moveTargets: MovePagesTarget[] =
    batch.length === 0 || mixedGroups
      ? []
      : movePagesTargets(
          view.strips.map(strip => ({
            documentId: strip.documentId,
            groupId: strip.groupId,
            label: strip.label,
            pageCount: strip.pages.length,
            locked: strip.locked,
          })),
          { groupId: batch[0]!.groupId, excludeDocumentId: onlyDocumentId },
        );
  const summary = tsel("summary", {
    count: batch.reduce((sum, item) => sum + item.keys.length, 0),
    documents: batch
      .map(item => {
        const strip = view.strips[stripIndex.get(item.documentId) ?? -1];
        const positions = strip
          ? item.keys.map(
              key => strip.pages.findIndex(page => page.key === key) + 1,
            )
          : [];
        return tsel("summaryDocument", {
          index: (stripIndex.get(item.documentId) ?? 0) + 1,
          pages: formatPageRuns(positions),
        });
      })
      .join(" · "),
  });
  /** 일괄 편집 결과: 성공하면 선택을 비우고, 실패하면 바 아래에 사유를 남긴다. */
  const settle = (
    outcome: { ok: true } | { ok: false; reason: DropReason },
  ) => {
    if (outcome.ok) clearSelection();
    else setBatchError(outcome.reason);
    return outcome;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (selection.keys.size === 0) return;
    const target = event.target as HTMLElement;
    // 메뉴·대화상자는 포털이라 DOM 으로는 이 안에 없다 — 그쪽 Esc 는 그쪽이 닫는 데 쓴다.
    if (!event.currentTarget.contains(target)) return;
    if (target.closest(TEXT_ENTRY)) return;
    event.preventDefault();
    clearSelection();
  };

  const editErrorText = editError ? reasonText(editError) : null;

  return (
    // 격자·일괄 바 안에 포커스가 있을 때 Esc 로 선택을 비운다(키보드 조작 자체는 안의 버튼이 받는다).
    <div
      className="flex min-w-0 flex-col gap-2 xl:fit:min-h-0 xl:fit:flex-1"
      onKeyDown={onKeyDown}
    >
      <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
        {view.coverageUnknown ? (
          <p className="text-xs text-muted-foreground">
            {ts("coverageUnknown")}
          </p>
        ) : null}
        {editErrorText ? (
          <p role="alert" className="text-xs text-destructive">
            {editErrorText}
          </p>
        ) : null}
      </div>
      <OrganizerSelectionBar
        count={selection.keys.size}
        disabled={!editable}
        mixedGroups={mixedGroups}
        canSplit={split !== null}
        error={batchError ? reasonText(batchError) : null}
        onMove={() => {
          setBatchError(null);
          setMovingSelection({});
        }}
        onExclude={() => settle(onBatchExclude(batch))}
        onNewDocument={() => {
          setBatchError(null);
          setMovingSelection({ initialTarget: "new-document" });
        }}
        onSplit={() => {
          if (split)
            settle(onSplitAndSelect(split.documentId, split.afterPageKey));
        }}
        onClear={clearSelection}
      />
      <PageGrid
        documents={view.strips}
        excluded={view.excluded}
        unplaced={view.unplaced}
        groupBoundariesAfter={view.groupBoundariesAfter}
        selectedPage={selectedPage}
        multiSelected={selection.keys}
        size={size}
        disabled={!editable}
        // 보통은 화면 높이 기준, 넓은 화면을 창 높이에 맞출 때는 패널에 남은 높이까지.
        maxHeight="var(--job-review-organizer-max-h)"
        className="[--job-review-organizer-max-h:60vh] xl:fit:min-h-0 xl:fit:flex-1 xl:fit:[--job-review-organizer-max-h:100%]"
        labels={labels}
        labelMaxLength={DOCUMENT_LABEL_MAX_LENGTH}
        testId="job-review-organizer"
        menuButtonsRef={menuButtons}
        {...filmstrip}
        onThumbnailClick={onThumbnailClick}
        onRequestDocumentPosition={onRequestDocumentPosition}
        // 고르지 않은 셀(제외 칸 셀 포함)을 끌기 시작하면 그냥 클릭처럼 선택을 비운다 — 그 한 장만 끈다.
        onPageDragStart={(documentId, key) => {
          if (documentId !== null && selection.keys.has(key)) return;
          setStored(previous => ({
            ...applyClick(
              previous.scope === stepId ? previous : EMPTY_SELECTION,
              order,
              key,
              { shift: false, toggle: false },
            ),
            scope: stepId,
          }));
          setBatchError(null);
        }}
        // 고른 페이지를 함께 끌어 놓으면 일괄 바와 같은 일괄 편집으로 적용한다.
        onDropPages={(keys, target) => {
          const picked = groupSelection(new Set(keys), view.strips);
          settle(
            target.kind === "excluded"
              ? onBatchExclude(picked)
              : onBatchDrop(picked, target.documentId, target.index),
          );
        }}
      />
      <MovePagesDialog
        open={movingSelection !== null}
        onOpenChange={open => {
          if (!open) setMovingSelection(null);
        }}
        targets={moveTargets}
        labelChoices={firstChoices}
        defaultLabel={firstLabel}
        initialTarget={movingSelection?.initialTarget}
        selection={{
          count: selection.keys.size,
          summary,
          onMove: destination => {
            const outcome =
              destination.kind === "document"
                ? onBatchMove(
                    batch,
                    destination.documentId,
                    destination.position,
                  )
                : onBatchNewDocument(batch, destination.label);
            if (outcome.ok) clearSelection();
            return outcome.ok ? { ok: true } : outcome;
          },
        }}
      />
      <DocumentPositionDialog
        open={positioning !== null}
        onOpenChange={open => {
          if (!open) setPositioning(null);
        }}
        index={positioning?.index ?? 0}
        min={positioning?.block.first ?? 1}
        max={positioning?.block.last ?? 1}
        returnFocus={() => {
          const documentId = positionedDocument.current;
          return documentId === null
            ? null
            : (menuButtons.current?.get(documentId) ?? null);
        }}
        onMove={position => {
          // 최종 위치 n(1-based)은 "그 문서를 뺀 뒤" 기준 toIndex n-1 과 같다.
          if (positioning) {
            filmstrip.onReorderDocument(positioning.documentId, position - 1);
          }
        }}
      />
    </div>
  );
}
