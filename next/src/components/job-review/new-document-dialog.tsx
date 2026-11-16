"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { DocumentLabelField } from "@/components/studio-ui-kit/document-label-field";
import { PageRangeEditor } from "@/components/studio-ui-kit/page-range-editor";
import type {
  PageRangeFileOption,
  PageRangeRow,
} from "@/components/studio-ui-kit/page-range-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DOCUMENT_LABEL_MAX_LENGTH } from "@/lib/review-model";
import { isKnownDropReason, sourcesFromRows } from "./structure-view";
import type { StructureActions } from "./use-structure-actions";
import { usePageRangeLabels } from "./use-page-range-labels";

/** 라벨 select 트리거만 칸 너비를 채운다(입력은 기본 class 그대로). */
const LABEL_FIELD_CLASS_NAMES = { trigger: "w-full" } as const;

export interface NewDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 새 문서의 파일 그룹(선택 문서의 그룹). */
  groupId: string;
  fileOptions: readonly PageRangeFileOption[];
  /** 설정 라벨. 없으면 자유 입력. */
  labelChoices: readonly string[] | null;
  /** 이 문서 바로 뒤에 만든다. */
  afterDocumentId: string | null;
  /** 첫 범위 행 초기값(보던 쪽). 파일이 `fileOptions` 에 없으면 첫 파일의 빈 행. */
  initialRow?: PageRangeRow;
  onCreate: StructureActions["onAddDocument"];
}

/** 라벨과 페이지 범위를 지정해 그 페이지를 지금 문서에서 새 문서로 분리하는 대화 상자. */
export function NewDocumentDialog({
  open,
  onOpenChange,
  ...props
}: NewDocumentDialogProps) {
  const t = useTranslations("review.structure.newDocument");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        data-testid="job-review-new-document-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {/* 열 때마다 새로 마운트해 초기 입력에서 시작한다. */}
        {open ? (
          <NewDocumentForm {...props} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewDocumentForm({
  groupId,
  fileOptions,
  labelChoices,
  afterDocumentId,
  initialRow,
  onCreate,
  onClose,
}: Omit<NewDocumentDialogProps, "open" | "onOpenChange"> & {
  onClose: () => void;
}) {
  const t = useTranslations("review.structure");
  const labelId = useId();
  const errorId = useId();
  const rangeLabels = usePageRangeLabels();
  const [label, setLabel] = useState("");
  const labelFieldLabels = useMemo(() => ({ noLabel: t("noLabel") }), [t]);
  const [initialRows] = useState<PageRangeRow[]>(() =>
    initialRow &&
    fileOptions.some(option => option.fileRef === initialRow.fileRef)
      ? [initialRow]
      : fileOptions[0]
        ? [{ fileRef: fileOptions[0].fileRef, text: "" }]
        : [],
  );
  const [rows, setRows] = useState<PageRangeRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const sourceFiles = sourcesFromRows(rows);
    if (!sourceFiles || sourceFiles.length === 0) {
      setError(t("newDocument.invalidRanges"));
      return;
    }
    const outcome = onCreate({
      groupId,
      label: label.trim() === "" ? null : label.trim(),
      sourceFiles,
      afterDocumentId,
    });
    if (outcome.ok) {
      onClose();
      return;
    }
    setError(
      isKnownDropReason(outcome.reason)
        ? t(`errors.${outcome.reason}`)
        : t("errors.generic", { code: outcome.reason }),
    );
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={labelId}
          className="text-xs font-medium text-muted-foreground"
        >
          {t("label")}
        </label>
        <DocumentLabelField
          value={label === "" ? null : label}
          onValueChange={value => setLabel(value ?? "")}
          choices={labelChoices}
          commit="change"
          noLabelOption="always"
          outsideOption="none"
          maxLength={DOCUMENT_LABEL_MAX_LENGTH}
          id={labelId}
          labels={labelFieldLabels}
          testId="job-review-new-document"
          classNames={LABEL_FIELD_CLASS_NAMES}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("pageRanges.title")}
        </h3>
        <PageRangeEditor
          rows={initialRows}
          fileOptions={fileOptions}
          validate={rangeLabels.validate}
          onDraftChange={next => {
            setRows(next);
            setError(null);
          }}
          labels={rangeLabels.labels}
          aria-describedby={error ? errorId : undefined}
          testId="job-review-new-document-ranges"
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          data-testid="job-review-new-document-button-cancel"
        >
          {t("newDocument.cancel")}
        </Button>
        <Button
          type="submit"
          data-testid="job-review-new-document-button-create"
        >
          {t("newDocument.create")}
        </Button>
      </DialogFooter>
    </form>
  );
}
