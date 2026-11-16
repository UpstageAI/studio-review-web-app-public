"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  MovePagesDialog as CoreMovePagesDialog,
  type MovePagesDialogLabels,
  type MovePagesResult,
} from "@/components/studio-ui-kit/move-pages-dialog";
import {
  DOCUMENT_LABEL_MAX_LENGTH,
  type DropReason,
  type PageRef,
} from "@/lib/review-model";
import type { MovePagesTarget } from "./move-pages-targets";
import { isKnownDropReason } from "./structure-view";
import type {
  MoveDestination,
  StructureActions,
} from "./use-structure-actions";

/** 이미 고른 여러 장을 옮길 때: 범위 입력 대신 요약 한 줄을 보이고 대상·위치만 받는다. */
export type MovePagesSelection = {
  count: number;
  /** 예: "3장 · 문서 2: 1, 3쪽 · 문서 5: 2쪽". */
  summary: string;
  onMove: (
    destination: MoveDestination,
  ) => { ok: true } | { ok: false; reason: DropReason };
};

type RangeSource = {
  /** 페이지를 내보내는(현재) 문서. */
  documentId: string;
  docPages: readonly PageRef[];
  /** 보고 있는 페이지(0-based). 범위의 기본값. */
  currentIndex: number;
  onMove: StructureActions["onMovePages"];
  selection?: undefined;
};

type SelectionSource = {
  selection: MovePagesSelection;
  documentId?: undefined;
  docPages?: undefined;
  currentIndex?: undefined;
  onMove?: undefined;
};

export type MovePagesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 옮길 수 있는 문서. 호출처가 `movePagesTargets` 로 같은 규칙(같은 그룹 · 잠금 제외 · 원본이 한 문서면 제외)으로 만든다. */
  targets: readonly MovePagesTarget[];
  /** 새 문서 라벨로 고를 수 있는 설정 라벨. `null` 이면 자유 입력. */
  labelChoices: readonly string[] | null;
  /** 새 문서 라벨의 기본값(원본 문서 라벨). */
  defaultLabel: string | null;
  /** 열 때 "새 문서" 를 미리 고른다. */
  initialTarget?: "new-document";
} & (RangeSource | SelectionSource);

/**
 * 페이지를 같은 그룹의 다른 문서로 옮기거나, 라벨을 정한 새 문서(원본 문서 바로 뒤)로 분리하는
 * 대화 상자. 기본은 현재 문서의 페이지 범위를 고르고, `selection` 이 있으면 이미 고른
 * 페이지(여러 문서에 걸칠 수 있다)를 보낸다. 다른 문서가 없어도 새 문서는 늘 고를 수 있다.
 */
export function MovePagesDialog({
  open,
  onOpenChange,
  targets,
  labelChoices,
  defaultLabel,
  initialTarget,
  ...source
}: MovePagesDialogProps) {
  const tm = useTranslations("review.structure.movePages");
  const ts = useTranslations("review.organizer.selection");
  const t = useTranslations("review.structure");
  const tf = useTranslations("review.filmstrip");
  const labels = useMemo<MovePagesDialogLabels>(
    () => ({
      title: tm("title"),
      description: tm("description"),
      selectionDescription: ts("dialogDescription"),
      from: tm("from"),
      to: tm("to"),
      target: tm("target"),
      documentOption: (index, label) =>
        tf("documentOption", { index, label: label ?? tf("untitled") }),
      newDocument: tm("newDocument"),
      onlyNewDocument: tm("onlyNewDocument"),
      newDocumentLabel: tm("newDocumentLabel"),
      noLabel: t("noLabel"),
      position: tm("position"),
      positions: { end: tm("end"), start: tm("start"), before: tm("before") },
      beforePage: max => tm("beforePage", { max }),
      invalidRange: total => tm("invalidRange", { total }),
      invalidBefore: total => tm("invalidBefore", { total }),
      targetMissing: t("errors.target_missing"),
      cancel: tm("cancel"),
      move: tm("move"),
    }),
    [t, tm, tf, ts],
  );
  const toResult = (
    outcome: { ok: true } | { ok: false; reason: DropReason },
  ): MovePagesResult =>
    outcome.ok
      ? outcome
      : {
          ok: false,
          message: isKnownDropReason(outcome.reason)
            ? t(`errors.${outcome.reason}`)
            : t("errors.generic", { code: outcome.reason }),
        };
  const common = {
    open,
    onOpenChange,
    targets,
    labelChoices,
    defaultLabel,
    initialTarget,
    labelMaxLength: DOCUMENT_LABEL_MAX_LENGTH,
    labels,
    testId: "job-review-move-pages-dialog",
  };
  if (source.selection) {
    const { selection } = source;
    return (
      <CoreMovePagesDialog
        {...common}
        source={{
          kind: "selection",
          count: selection.count,
          summary: selection.summary,
        }}
        onMove={request => toResult(selection.onMove(request.destination))}
      />
    );
  }
  const { documentId, docPages, currentIndex, onMove } = source;
  return (
    <CoreMovePagesDialog
      {...common}
      source={{ kind: "range", pageCount: docPages.length, currentIndex }}
      onMove={request => {
        // range 출처로 열었으니 요청도 range 다.
        if (request.kind !== "range") {
          throw new Error("range 출처의 요청에 range 가 없다");
        }
        return toResult(
          onMove({
            documentId,
            from: request.range.from,
            to: request.range.to,
            destination: request.destination,
          }),
        );
      }}
    />
  );
}
