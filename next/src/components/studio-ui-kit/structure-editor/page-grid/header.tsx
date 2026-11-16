import { useCallback, type DragEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LabelField, LabelText } from "../shared/label-field";
import { documentMenuItems } from "../shared/menu";
import { tid } from "../shared/test-id";
import { CellMenu } from "./cell";
import type { PageGridActions, PageGridLabels } from "./page-grid";
import { blockPages, type GridRow } from "./rows";
import type { StructureDocument } from "../shared/types";

type HeaderDropProps = {
  /** drop 자리 표시: true 받음 · false 거부 · null 아님. */
  dropState: boolean | null;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
};

/**
 * 블록 머리 행. 행 높이(`HEADER_ROW_HEIGHT`)는 블록 사이 여백(`BLOCK_GAP` = `pt-3`)과 머리
 * (`HEADER_HEIGHT` = `h-10`)의 합이다. 문서 머리는 제목·라벨 필드·배지·쪽수·⋯ 메뉴(앞 문서와 합치기·
 * 앞으로·뒤로·위치 지정…·문서 제외/복귀)를, 제외·빠진 페이지 칸 머리는 제목·쪽수를 보인다.
 * `boundaryBefore` 면 여백에 파일 그룹 경계 점선을 긋는다. 끌던 페이지를 문서 머리에 놓으면 그 문서
 * 끝으로, 제외 칸 머리에 놓으면 제외된다(핸들러는 부모가 준다).
 */
export function BlockHeader({
  row,
  documents,
  disabled,
  labels,
  labelMaxLength,
  commitLabelOnUnmount,
  testId,
  actions,
  registerMenuButton,
  dropState,
  onDragOver,
  onDrop,
}: {
  row: Extract<GridRow, { kind: "header" }>;
  /** 문서 전체(배치 순). 앞·뒤 문서와 같은 그룹인지 보는 데 쓴다. */
  documents: readonly StructureDocument[];
  disabled: boolean;
  labels: PageGridLabels;
  labelMaxLength?: number;
  commitLabelOnUnmount: boolean;
  testId?: string;
  actions: PageGridActions;
  /** 문서 머리 메뉴 버튼을 문서 id 로 등록한다(문서 머리만). 돌려준 함수는 등록을 지운다. */
  registerMenuButton?: (documentId: string, element: HTMLElement) => () => void;
} & HeaderDropProps) {
  const { block, boundaryBefore, height } = row;
  const count = blockPages(block).length;
  const menuDocumentId =
    block.kind === "document" ? block.document.documentId : null;
  const menuButtonRef = useCallback(
    (element: HTMLButtonElement | null) =>
      element && menuDocumentId !== null && registerMenuButton
        ? registerMenuButton(menuDocumentId, element)
        : undefined,
    [registerMenuButton, menuDocumentId],
  );

  if (block.kind === "document") {
    const { document, index } = block;
    const inert = disabled || Boolean(document.locked);
    const menu = documentMenuItems({
      document,
      index,
      documents,
      labels,
      actions,
    });
    // 라벨 편집은 `onLabelChange` 와 그 문구가 함께 있을 때만. 없으면 라벨 글자만 보인다.
    const onLabelChange = actions.onLabelChange;
    const labelFieldLabels =
      onLabelChange &&
      labels.label !== undefined &&
      labels.noLabel !== undefined &&
      labels.notInConfigOption
        ? {
            label: labels.label,
            noLabel: labels.noLabel,
            notInConfigOption: labels.notInConfigOption,
            untitled: labels.untitled,
          }
        : null;
    return (
      <div
        data-document-id={document.documentId}
        data-testid={tid(testId, "header")}
        style={{ height }}
        className="relative flex min-w-0 flex-col pt-3"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {boundaryBefore ? (
          <div
            role="separator"
            aria-label={labels.groupBoundary}
            title={labels.groupBoundary}
            className="absolute inset-x-0 top-1.5 border-t border-dashed border-border"
          />
        ) : null}
        <div
          className={cn(
            "flex h-10 min-w-0 items-center gap-2 rounded-md border bg-card px-2",
            dropState === true
              ? "border-primary bg-accent"
              : dropState === false
                ? "border-destructive"
                : "border-border",
            (document.locked || document.excluded) && "opacity-60",
          )}
        >
          <h3 className="shrink-0 text-xs font-medium text-muted-foreground">
            {labels.document(index + 1)}
          </h3>
          {onLabelChange && labelFieldLabels ? (
            <LabelField
              document={document}
              disabled={inert}
              labels={labelFieldLabels}
              maxLength={labelMaxLength}
              testId={testId}
              onLabelChange={onLabelChange}
              commitOnUnmount={commitLabelOnUnmount}
            />
          ) : (
            <LabelText label={document.label} untitled={labels.untitled} />
          )}
          {document.excluded && labels.documentExclusion ? (
            <Badge variant="secondary" className="shrink-0">
              {labels.documentExclusion.badge}
            </Badge>
          ) : null}
          {document.labelNotInConfig ? (
            <Badge
              variant="outline"
              title={labels.notInConfigHint}
              className="shrink-0"
            >
              {labels.notInConfigBadge}
            </Badge>
          ) : null}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {labels.pageCount(count)}
          </span>
          {labels.documentMenu ? (
            <CellMenu
              name={labels.documentMenu(index + 1)}
              items={menu}
              disabled={inert}
              testId={tid(testId, "header-menu")}
              align="end"
              className="size-6"
              triggerRef={menuButtonRef}
            />
          ) : null}
        </div>
      </div>
    );
  }

  const unplaced = block.kind === "unplaced";
  return (
    <div
      data-testid={tid(testId, block.kind)}
      style={{ height }}
      className="flex min-w-0 flex-col pt-3"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className={cn(
          "flex h-10 min-w-0 items-center gap-2 rounded-md border border-dashed px-2",
          unplaced
            ? "border-destructive"
            : dropState === true
              ? "border-primary bg-accent"
              : dropState === false
                ? "border-destructive bg-muted/50"
                : "border-border bg-muted/50",
        )}
      >
        <h3
          className={cn(
            "min-w-0 flex-1 truncate text-xs font-medium",
            unplaced ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {unplaced ? labels.unplaced : labels.excluded}
        </h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {labels.pageCount(count)}
        </span>
      </div>
    </div>
  );
}
