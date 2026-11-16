"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import {
  Filmstrip,
  type FilmstripLabels,
  type StructureMenuButtons,
  type FilmstripNeighborhood,
  type StructurePage,
} from "@/components/studio-ui-kit/structure-editor";
import { DOCUMENT_LABEL_MAX_LENGTH, pageKey } from "@/lib/review-model";
import { DocumentPositionDialog } from "./document-position-dialog";
import { useJobReview } from "./job-review-context";
import { NEIGHBORHOOD_ABOVE } from "./large-job";
import { markSelectPage } from "./perf-marks";
import { buildStructureView, groupBlockOf } from "./structure-view";
import { useDropReasonText } from "./use-drop-reason-text";
import { useStructureActions } from "./use-structure-actions";

/**
 * 구성 모드의 가운데 띠: 필름스트립. 편집은 `useStructureActions` 로 변경 항목이 되고,
 * 저장 전 검증(빈 자리·겹침·설정에 없는 라벨)을 그 자리에 표시한다. Job 전체 쪽수가
 * `NEIGHBORHOOD_ABOVE` 를 넘으면 선택 문서와 양옆 문서만 그리는 이웃 보기로 바꾼다.
 */
export function StructureBand() {
  const t = useTranslations("review.filmstrip");
  const ts = useTranslations("review.structure");
  const reasonText = useDropReasonText();
  const { state, dispatch, job, selected, docPages, issues } = useJobReview();
  const { files, session, selectedPageIndex, editError } = state;
  const { stepId, editable, filmstrip } = useStructureActions();
  const [positioning, setPositioning] = useState<{
    documentId: string;
    index: number;
    /** 옮길 수 있는 범위(1-based): 같은 파일 그룹이 이어진 구간. */
    block: { first: number; last: number };
  } | null>(null);
  // "위치 지정…" 을 연 문서. 닫힌 뒤 그 문서의 띠 메뉴 버튼으로 포커스를 돌려준다.
  const positionedDocument = useRef<string | null>(null);
  const menuButtons = useRef<StructureMenuButtons>(null);

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

  const fileNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const group of job?.file_groups?.groups ?? []) {
      for (const file of group.files) names.set(file.file_ref, file.name);
    }
    return names;
  }, [job]);
  const multiFile = fileNames.size > 1;

  const labels = useMemo<FilmstripLabels>(() => {
    const pageName = (page: StructurePage) =>
      multiFile
        ? t("pageInFile", {
            page: page.page,
            file: fileNames.get(page.fileRef) ?? page.fileRef,
          })
        : t("page", { page: page.page });
    return {
      region: t("region"),
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
      movePageEarlier: t("moveLeft"),
      movePageLater: t("moveRight"),
      moveToDocument: t("moveToDocument"),
      documentOption: (index, label) =>
        t("documentOption", { index, label: label ?? t("untitled") }),
      noOtherDocument: t("noOtherDocument"),
      excludePage: t("excludePage"),
      restorePage: t("restorePage"),
      splitAfter: page => t("split", { page: pageName(page) }),
      documentMenu: index => t("documentMenu", { index }),
      dragDocument: t("dragDocument"),
      mergeWithPrevious: t("mergeWithPrevious"),
      moveDocumentEarlier: t("moveDocumentEarlier"),
      moveDocumentLater: t("moveDocumentLater"),
      excluded: t("excluded"),
      excludedEmpty: t("excludedEmpty"),
      unplaced: t("unplaced"),
      missing: t("missing"),
      overlap: t("overlap"),
      dropRejected: t("dropRejected"),
      dropRejectedLocked: t("dropRejectedLocked"),
      groupBoundary: t("groupBoundary"),
      documentExclusion: {
        exclude: t("excludeDocument"),
        restore: t("restoreDocument"),
        badge: t("excludedDocument"),
      },
      restoreToNewDocument: t("restoreToNewDocument"),
      unplacedMenu: page => t("unplacedMenu", { page: pageName(page) }),
      neighborhood: {
        collapsedPages: count => t("collapsedPages", { count }),
        focusDocument: index => t("focusDocument", { index }),
        hiddenBefore: count => t("hiddenBefore", { count }),
        hiddenAfter: count => t("hiddenAfter", { count }),
        expand: t("expand"),
        collapse: t("collapse"),
      },
      moveDocumentTo: t("moveDocumentTo"),
    };
  }, [t, fileNames, multiFile]);

  const selectedRef = docPages[selectedPageIndex];
  const selectedDocumentId = selected?.document.document_id ?? null;
  const selectedPage =
    selectedDocumentId !== null && selectedRef
      ? { documentId: selectedDocumentId, pageKey: pageKey(selectedRef) }
      : null;

  // 쪽수가 많은 Job 은 선택 문서 주변만 그린다(선택 문서가 이 보기에 없으면 Core 가 전체로 돌아간다).
  const neighborhood = useMemo<FilmstripNeighborhood | null>(
    () =>
      view && view.totalPages > NEIGHBORHOOD_ABOVE && selectedDocumentId
        ? { focusDocumentId: selectedDocumentId }
        : null,
    [view, selectedDocumentId],
  );

  if (!view) return null;

  const editErrorText = editError ? reasonText(editError) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
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
      <Filmstrip
        documents={view.strips}
        excluded={view.excluded}
        unplaced={view.unplaced}
        groupBoundariesAfter={view.groupBoundariesAfter}
        selectedPage={selectedPage}
        disabled={!editable}
        neighborhood={neighborhood}
        labels={labels}
        labelMaxLength={DOCUMENT_LABEL_MAX_LENGTH}
        testId="job-review-filmstrip"
        menuButtonsRef={menuButtons}
        {...filmstrip}
        onThumbnailClick={(documentId, _key, index) => {
          if (documentId === null) return;
          dispatch({
            type: "SELECT_DOCUMENT",
            document: { stepId, documentId },
          });
          markSelectPage(index, "filmstrip");
          dispatch({ type: "SELECT_PAGE", index });
        }}
        onFocusDocument={documentId =>
          dispatch({
            type: "SELECT_DOCUMENT",
            document: { stepId, documentId },
          })
        }
        onRequestDocumentPosition={(documentId, index) => {
          positionedDocument.current = documentId;
          const block = groupBlockOf(view.strips, index);
          setPositioning({
            documentId,
            index,
            block: { first: block.first + 1, last: block.last + 1 },
          });
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
