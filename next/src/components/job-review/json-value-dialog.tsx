"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { JsonTextEditor } from "@/components/job-review/json-text-editor";
import type { JsonTextEditorError } from "@/components/job-review/json-text-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  isReviewModelError,
  jsonEquals,
  parseJson,
  schemaAt,
  schemaProblem,
  stringifyJson,
  type JsonValue,
  type SchemaNode,
} from "@/lib/review-model";
import { lineColumn } from "./value-fields";

export interface JsonValueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 결과 섹션 제목(Step 이름). */
  heading: string;
  content: JsonValue;
  schema: SchemaNode | null;
  /** 바뀐 값을 확정할 때(결과 `content` 전체 교체). */
  onApply: (value: JsonValue) => void;
}

/** 루트 모양이 schema 와 맞지 않는 이유. 항목 하나짜리 배열 래퍼(`[{…}]`)는 그 항목으로 본다. */
function rootProblem(
  schema: SchemaNode | null,
  value: JsonValue,
): string | null {
  const problem = schemaProblem(schemaAt(schema, [], value), value);
  if (!problem) return null;
  if (Array.isArray(value) && value.length === 1 && value[0] !== undefined) {
    const item = value[0];
    if (schemaProblem(schemaAt(schema, [], item), item) === null) return null;
  }
  return problem.expected;
}

/** 결과 하나의 값(`content`)을 JSON 텍스트로 통째로 고치는 대화 상자. */
export function JsonValueDialog({
  open,
  onOpenChange,
  heading,
  content,
  schema,
  onApply,
}: JsonValueDialogProps) {
  const t = useTranslations("review.values.jsonDialog");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[90vh] flex-col sm:max-w-2xl"
        data-testid="job-review-json-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("title", { name: heading })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {/* 열 때마다 새로 마운트해 현재 값에서 시작한다. */}
        {open ? (
          <JsonValueForm
            content={content}
            schema={schema}
            onApply={onApply}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function JsonValueForm({
  content,
  schema,
  onApply,
  onCancel,
}: {
  content: JsonValue;
  schema: SchemaNode | null;
  onApply: (value: JsonValue) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("review.values.jsonDialog");
  const [text, setText] = useState(() =>
    stringifyJson(content, { pretty: true }),
  );
  const [error, setError] = useState<JsonTextEditorError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = () => {
    let value: JsonValue;
    try {
      value = parseJson(text);
    } catch (caught) {
      if (!isReviewModelError(caught)) throw caught;
      const offset = caught.details?.offset;
      const position =
        typeof offset === "number" ? lineColumn(text, offset) : null;
      switch (caught.code) {
        case "invalid_json":
          setError(
            position
              ? { ...position, message: t("invalidJsonAt", position) }
              : { message: t("invalidJson") },
          );
          return;
        case "duplicate_key":
          setError({
            message: t("duplicateKey", {
              key: String(caught.details?.key ?? ""),
            }),
          });
          return;
        case "nesting_too_deep":
          setError({ message: t("tooDeep") });
          return;
        case "json_too_large":
          setError({ message: t("tooLarge") });
          return;
        default:
          setError({ message: t("invalidJson") });
          return;
      }
    }
    const expected = rootProblem(schema, value);
    if (expected !== null) {
      setError({ message: t("schemaProblem", { expected }) });
      return;
    }
    if (jsonEquals(value, content)) {
      setNotice(t("unchanged"));
      return;
    }
    onApply(value);
  };

  return (
    <>
      <JsonTextEditor
        value={text}
        onChange={next => {
          setText(next);
          setError(null);
          setNotice(null);
        }}
        error={error}
        labels={{ editor: t("editor"), jumpToError: t("jumpToError") }}
        testId="job-review-json-dialog-editor"
        className="min-h-0"
      />
      {notice ? (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          data-testid="job-review-json-dialog-button-cancel"
          className="cursor-pointer"
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={apply}
          data-testid="job-review-json-dialog-button-apply"
          className="cursor-pointer"
        >
          {t("apply")}
        </Button>
      </DialogFooter>
    </>
  );
}
