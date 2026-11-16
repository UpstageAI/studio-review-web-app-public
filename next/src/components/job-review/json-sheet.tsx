"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { JsonTextEditor } from "@/components/job-review/json-text-editor";
import type { JsonTextEditorError } from "@/components/job-review/json-text-editor";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  planImport,
  utf8Length,
  type DropReason,
  type ImportPlan,
  type ReviewModelError,
  type ReviewSession,
} from "@/lib/review-model";
import { LARGE_JSON_BYTES, editedText } from "./download";
import { useJobReview } from "./job-review-context";
import { formatBytes } from "./save-errors";
import { useDropReasonText } from "./use-drop-reason-text";
import { lineColumn } from "./value-fields";

/** 편집 칸 내용을 어디서 불러왔는지: 현재 편집본, 원본(서버에서 불러온 결과), 파일. */
export type JsonBasis =
  { kind: "edited" } | { kind: "original" } | { kind: "file"; name: string };

/** 편집 칸에 넣을 텍스트. `key` 가 바뀌면 편집 칸을 그 텍스트로 새로 시작한다. */
export type JsonSheetSeed = {
  key: number;
  text: string;
  basis: JsonBasis;
  notice?: string;
};

export interface JsonSheetProps {
  seed: JsonSheetSeed;
  /** 파일 고르기(입력은 메뉴가 가진다). 읽은 결과는 `seed` 로 돌아온다. */
  onPickFile: () => void;
  /** 파일을 읽지 못한 이유 등 시트 아래 안내. */
  fileError: string | null;
}

/** 전체 JSON 편집 시트: 편집 → 검사 → 적용(변경 항목으로). 열림 상태는 reducer 가 가진다. */
export function JsonSheet({ seed, onPickFile, fileError }: JsonSheetProps) {
  const t = useTranslations("review.json");
  const { state, dispatch } = useJobReview();
  return (
    <Sheet
      open={state.jsonSheetOpen}
      onOpenChange={open =>
        dispatch({ type: open ? "OPEN_JSON" : "CLOSE_JSON" })
      }
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        onCloseAutoFocus={event => {
          // 메뉴에서 열려 트리거가 없으므로 닫힐 때 JSON 메뉴 버튼으로 돌아간다.
          const opener = document.querySelector<HTMLElement>(
            '[data-testid="job-review-json-menu-trigger"]',
          );
          if (opener) {
            event.preventDefault();
            opener.focus();
          }
        }}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:w-1/2 data-[side=right]:sm:max-w-none"
        data-testid="job-review-json-sheet"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        {state.jsonSheetOpen && state.session ? (
          <JsonSheetBody
            key={seed.key}
            seed={seed}
            session={state.session}
            onPickFile={onPickFile}
            fileError={fileError}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type Checked = {
  /** 검사한 텍스트·세션. 둘 중 하나라도 바뀌면 다시 검사해야 한다. */
  text: string;
  session: ReviewSession;
  plan: ImportPlan;
};

function JsonSheetBody({
  seed,
  session,
  onPickFile,
  fileError,
}: {
  seed: JsonSheetSeed;
  session: ReviewSession;
  onPickFile: () => void;
  fileError: string | null;
}) {
  const t = useTranslations("review.json");
  const { state, dispatch, saving } = useJobReview();
  const [text, setText] = useState(seed.text);
  // 불러온 그대로의 텍스트와 그 출처. 지금 텍스트와 다르면 이 창에서 직접 고친 것이다.
  const [baseText, setBaseText] = useState(seed.text);
  const [basis, setBasis] = useState<JsonBasis>(seed.basis);
  const [notice, setNotice] = useState<string | null>(seed.notice ?? null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const bytes = useMemo(() => utf8Length(text), [text]);
  const blocked = saving || state.save.phase === "conflict";
  const fresh =
    checked !== null && checked.text === text && checked.session === session;
  const plan = fresh ? checked.plan : null;

  const replaceText = (
    next: string,
    message: string | null,
    nextBasis: JsonBasis,
  ) => {
    setText(next);
    setBaseText(next);
    setBasis(nextBasis);
    setNotice(message);
    setChecked(null);
  };

  // 큰 파일은 파싱·비교가 수백 ms 걸리므로 "검사 중" 을 먼저 그린 뒤 검사한다.
  const check = () => {
    if (checking) return;
    setChecking(true);
    const target = text;
    timer.current = setTimeout(() => {
      timer.current = null;
      setChecked({
        text: target,
        session,
        plan: planImport({ session, jobId: state.jobId, text: target }),
      });
      setChecking(false);
    }, 0);
  };

  const apply = () => {
    if (!plan || !plan.ok || plan.errors.length > 0 || blocked) return;
    dispatch({ type: "APPLY_MANY", drafts: plan.drafts, source: "json" });
  };

  const parseError = plan && !plan.ok ? plan.error : null;
  const editorError = useParseErrorText(parseError, text);
  const canApply =
    plan !== null &&
    plan.ok &&
    plan.errors.length === 0 &&
    plan.drafts.length > 0 &&
    !blocked;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={onPickFile}
              data-testid="job-review-json-sheet-button-pick-file"
              className="cursor-pointer"
            >
              {t("pickFile")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() =>
                    replaceText(editedText(session.current), null, {
                      kind: "edited",
                    })
                  }
                  data-testid="job-review-json-sheet-button-load-edited"
                  className="cursor-pointer"
                >
                  {t("loadEdited")}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72">
                {t("loadEditedHint")}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              variant="outline"
              size="default"
              disabled={state.sourceText === null}
              onClick={() => {
                if (state.sourceText !== null) {
                  replaceText(state.sourceText, null, { kind: "original" });
                }
              }}
              data-testid="job-review-json-sheet-button-load-original"
              className="cursor-pointer"
            >
              {t("loadOriginal")}
            </Button>
          </div>
        </TooltipProvider>
        <BasisLine basis={basis} modified={text !== baseText} />
        {fileError || notice ? (
          <p
            aria-live="polite"
            className={
              fileError
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {fileError ?? notice}
          </p>
        ) : null}
        {bytes > LARGE_JSON_BYTES ? (
          <p className="text-xs text-muted-foreground">
            {t("largeNotice", { size: formatBytes(bytes) })}
          </p>
        ) : null}
        <JsonTextEditor
          value={text}
          onChange={next => {
            setText(next);
            setNotice(null);
          }}
          error={editorError}
          rows={20}
          labels={{ editor: t("editor"), jumpToError: t("jumpToError") }}
          testId="job-review-json-sheet-editor"
          className="min-h-0"
        />
        <CheckReport
          plan={plan}
          stale={checked !== null && !fresh}
          importError={state.importError}
        />
      </div>
      <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t border-border">
        <Button
          type="button"
          variant="outline"
          onClick={check}
          disabled={checking}
          aria-busy={checking || undefined}
          data-testid="job-review-json-sheet-button-check"
          className="cursor-pointer"
        >
          {checking ? t("checking") : t("check")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => dispatch({ type: "CLOSE_JSON" })}
          data-testid="job-review-json-sheet-button-close"
          className="cursor-pointer"
        >
          {t("close")}
        </Button>
        <Button
          type="button"
          disabled={!canApply}
          onClick={apply}
          data-testid="job-review-json-sheet-button-apply"
          className="cursor-pointer"
        >
          {t("apply")}
        </Button>
      </SheetFooter>
    </>
  );
}

/** 편집 칸에 지금 들어 있는 JSON 의 출처 한 줄. 불러온 뒤 직접 고쳤으면 그것도 덧붙인다. */
function BasisLine({
  basis,
  modified,
}: {
  basis: JsonBasis;
  modified: boolean;
}) {
  const t = useTranslations("review.json.basis");
  const label =
    basis.kind === "file" ? t("file", { name: basis.name }) : t(basis.kind);
  return (
    <p
      role="status"
      className="text-xs text-muted-foreground"
      data-testid="job-review-json-sheet-basis"
      data-basis={basis.kind}
      data-modified={modified ? "true" : "false"}
    >
      {label}
      {modified ? ` · ${t("modified")}` : null}
    </p>
  );
}

/** 읽기 오류 → 편집 칸 오류 문구(텍스트 위치가 있으면 줄·열). */
function useParseErrorText(
  error: ReviewModelError | null,
  text: string,
): JsonTextEditorError | null {
  const t = useTranslations("review.json.parse");
  if (!error) return null;
  const offset = error.details?.offset;
  const position = typeof offset === "number" ? lineColumn(text, offset) : null;
  switch (error.code) {
    case "invalid_json":
      return position
        ? { ...position, message: t("invalidJsonAt", position) }
        : { message: t("invalidJson") };
    case "duplicate_key":
      return {
        ...(position ?? {}),
        message: t("duplicateKey", { key: String(error.details?.key ?? "") }),
      };
    case "nesting_too_deep":
      return { message: t("tooDeep") };
    case "json_too_large":
      return { message: t("tooLarge") };
    case "unsupported_review_format":
      return {
        message: t("unsupportedFormat", {
          format: String(error.details?.format ?? "null"),
        }),
      };
    case "invalid_document":
      return {
        message: t("invalidDocument", {
          pointer: error.pointer || "/",
          reason: String(error.details?.reason ?? ""),
        }),
      };
    default: {
      const unreachable: never = error.code;
      return unreachable;
    }
  }
}

/** 검사 결과: 요약 한 줄, 거부·경고 목록(pointer + 문구), 적용하면 더해질 항목 수. */
function CheckReport({
  plan,
  stale,
  importError,
}: {
  plan: ImportPlan | null;
  stale: boolean;
  importError: { index: number; reason: DropReason } | null;
}) {
  const t = useTranslations("review.json");
  const reasonText = useDropReasonText();
  const { state, saving } = useJobReview();
  const failure = importError ? (
    <p
      role="alert"
      className="text-xs text-destructive"
      data-testid="job-review-json-sheet-apply-error"
    >
      {t("applyFailed", {
        index: importError.index + 1,
        detail: reasonText(importError.reason),
      })}
    </p>
  ) : null;
  if (stale || !plan) {
    return (
      <>
        {failure}
        {stale ? (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {t("recheck")}
          </p>
        ) : null}
      </>
    );
  }
  const errors = plan.ok ? plan.errors : [];
  const warnings = plan.ok ? plan.warnings : [];
  const blocked = saving || state.save.phase === "conflict";
  return (
    <div
      aria-live="polite"
      className="flex min-w-0 flex-col gap-2 text-xs"
      data-testid="job-review-json-sheet-report"
    >
      {failure}
      <p className="font-medium">
        {t("summary", {
          errors: plan.ok ? 0 : 1,
          rejected: errors.length,
          ignored: warnings.length,
        })}
      </p>
      {errors.length > 0 ? (
        <ProblemList
          title={t("rejectedTitle")}
          tone="error"
          items={errors.map(item => ({
            pointer: item.pointer,
            text: t(`errors.${item.code}`, { reason: item.reason ?? "" }),
          }))}
        />
      ) : null}
      {warnings.length > 0 ? (
        <ProblemList
          title={t("warningsTitle")}
          tone="muted"
          items={warnings.map(item => ({
            pointer: item.pointer,
            text: t(`warnings.${item.code}`),
          }))}
        />
      ) : null}
      {plan.ok && errors.length === 0 ? (
        <p className="text-muted-foreground">
          {plan.drafts.length > 0
            ? t("willAdd", { count: plan.drafts.length })
            : t("noChanges")}
        </p>
      ) : null}
      {plan.ok && errors.length === 0 && plan.drafts.length > 0 && blocked ? (
        <p className="text-destructive">{t("blockedBySave")}</p>
      ) : null}
    </div>
  );
}

/** 목록은 길어질 수 있어 앞 50 개만 그린다. */
const MAX_PROBLEMS = 50;

function ProblemList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "error" | "muted";
  items: readonly { pointer: string; text: string }[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p
        className={
          tone === "error" ? "text-destructive" : "text-muted-foreground"
        }
      >
        {title} ({items.length})
      </p>
      <ul className="flex max-h-48 min-w-0 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
        {items.slice(0, MAX_PROBLEMS).map((item, index) => (
          <li
            key={`${item.pointer}\u0000${index}`}
            className="flex min-w-0 flex-wrap gap-x-2"
          >
            <code className="font-mono break-all">{item.pointer || "/"}</code>
            <span>{item.text}</span>
          </li>
        ))}
        {items.length > MAX_PROBLEMS ? (
          <li className="text-muted-foreground">…</li>
        ) : null}
      </ul>
    </div>
  );
}
