"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { InstructOutput } from "@/lib/review-api/instruct";
import { formatPageRanges, stringifyJson } from "@/lib/review-model";
import { useJobReview } from "./job-review-context";
import { instructHighlightId, isInstructHighlightId } from "./job-review-state";
import {
  InstructCitationContext,
  type InstructCitationValue,
} from "./instruct-citation-context";
import { InstructMarkdown } from "./instruct-markdown";
import {
  InstructStructured,
  type InstructStructuredLabels,
} from "./instruct-structured";
import { citationTarget, resolveCitation } from "./step-outputs";
import {
  HIGHLIGHT_KEEP_SELECTOR,
  useOutsidePointerDown,
} from "./use-outside-pointer-down";

// 본문(react-markdown + remark 플러그인)은 Instruct 탭을 열 때만 불러온다(별도 chunk). 그동안 보일 자리.
const MARKDOWN_FALLBACK = <Skeleton className="h-16 w-full" />;

/** JSON 보기 글자. 직렬화할 수 없는 값이면 `null`. */
function prettyJson(value: unknown): string | null {
  try {
    return stringifyJson(value, { pretty: true });
  } catch {
    return null;
  }
}

/**
 * Instruct 탭: 선택 문서 범위의 Instruct 출력을 보인다(보기 전용). 출력마다 결정(enum) 상자,
 * markdown 본문(`response_format` 으로 받은 JSON 출력은 필드별 보기), 인용 칩(가리키면 뷰어가 그
 * 위치를 미리 보이고 누르면 고른다), 원본 JSON 보기.
 */
export function InstructTab() {
  const t = useTranslations("review.instruct");
  const { instructView, space, state, dispatch } = useJobReview();
  const { selectedHighlightId } = state;
  // 인용 칩·뷰어·열린 오버레이 밖을 누르면 고정을 푼다. 누를 수 있는 칩은 모두 안쪽으로 친다:
  // pointerdown 에서 풀면 이어지는 click 이 다시 고정해 선택이 한 번 깜빡인다. 칩은 선택이 바뀌어도
  // 다시 마운트되지 않으므로(markdown `components` 고정) 누른 칩의 포커스도 남는다.
  useOutsidePointerDown(
    isInstructHighlightId(selectedHighlightId),
    target =>
      target.closest(HIGHLIGHT_KEEP_SELECTOR) !== null ||
      target.closest("[data-citation]:not([aria-disabled])") !== null,
    () => dispatch({ type: "SELECT_HIGHLIGHT", id: null }),
  );
  if (!instructView) return null;
  const { outputs, unmatched, stepId } = instructView;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex min-w-0 flex-col gap-4"
        data-testid="job-review-instruct"
      >
        <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
          {!space ? (
            <p className="text-xs text-muted-foreground">{t("noSpace")}</p>
          ) : unmatched ? (
            <p className="text-xs text-muted-foreground">{t("noRangeMatch")}</p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t("readOnly")}</p>
        {outputs.map(output => (
          <InstructOutputView
            key={`${stepId}:${output.index}`}
            output={output}
            numbered={outputs.length > 1}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

function InstructOutputView({
  output,
  numbered,
}: {
  output: InstructOutput;
  numbered: boolean;
}) {
  const t = useTranslations("review.instruct");
  const { state, dispatch, space, docPages, documents } = useJobReview();
  const { selectedHighlightId } = state;
  const { parseElements } = state.response;

  const targetOf = useCallback(
    (index: number) => {
      const citation = output.citations.find(item => item.index === index);
      if (!citation) return null;
      const location = resolveCitation(citation, space, parseElements);
      return location ? citationTarget(location, docPages, documents) : null;
    },
    [output.citations, space, parseElements, docPages, documents],
  );

  const citationState = useCallback<InstructCitationValue["citationState"]>(
    index => ({
      disabled: targetOf(index) === null,
      selected:
        selectedHighlightId ===
        instructHighlightId(output.stepId, output.index, index),
    }),
    [targetOf, selectedHighlightId, output.stepId, output.index],
  );

  const onCitation = useCallback(
    (index: number) => {
      const target = targetOf(index);
      if (!target) return;
      if (target.document) {
        dispatch({
          type: "SELECT_DOCUMENT",
          document: {
            stepId: target.document.stepId,
            documentId: target.document.document.document_id,
          },
        });
      }
      dispatch({
        type: "SELECT_HIGHLIGHT",
        id: instructHighlightId(output.stepId, output.index, index),
        source: "panel",
        pageIndex: target.pageIndex,
      });
    },
    [targetOf, dispatch, output.stepId, output.index],
  );

  // 칩을 가리키면 그 인용 영역을 뷰어에 미리 보인다(값 행을 가리킬 때와 같다). 다른 문서에
  // 있는 인용은 지금 뷰어에 없어 미리 보이지 않는다.
  const onCitationHover = useCallback<
    NonNullable<InstructCitationValue["onCitationHover"]>
  >(
    index => {
      if (index === null) {
        dispatch({ type: "HOVER_HIGHLIGHT", id: null });
        return;
      }
      const target = targetOf(index);
      if (!target || target.document !== null) return;
      dispatch({
        type: "HOVER_HIGHLIGHT",
        id: instructHighlightId(output.stepId, output.index, index),
      });
    },
    [targetOf, dispatch, output.stepId, output.index],
  );

  const labels = useMemo<InstructCitationValue["labels"]>(
    () => ({
      citation: n => t("citation", { n }),
      noLocation: t("noLocation"),
      image: alt => t("image", { alt }),
    }),
    [t],
  );
  const structuredLabels = useMemo<InstructStructuredLabels>(
    () => ({
      nullValue: t("structured.nullValue"),
      emptyText: t("structured.emptyText"),
      emptyList: t("structured.emptyList"),
      emptyObject: t("structured.emptyObject"),
    }),
    [t],
  );
  const citation = useMemo<InstructCitationValue>(
    () => ({ citationState, onCitation, onCitationHover, labels }),
    [citationState, onCitation, onCitationHover, labels],
  );
  // 칩 상태는 context 로 가므로 본문 렌더 함수는 바뀌지 않는다(선택이 바뀌어도 markdown 을 다시
  // 파싱하거나 칩을 다시 마운트하지 않는다).
  const renderText = useCallback(
    (text: string) => (
      <InstructMarkdown text={text} fallback={MARKDOWN_FALLBACK} />
    ),
    [],
  );

  const rawJson = useMemo(
    () =>
      prettyJson(
        output.extra
          ? { text: output.text, additional_values: output.extra }
          : { text: output.text },
      ),
    [output.text, output.extra],
  );

  return (
    <InstructCitationContext value={citation}>
      <section
        className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3"
        data-testid="job-review-instruct-output"
      >
        {numbered || output.pageRanges.length > 0 ? (
          <p className="text-xs font-medium text-muted-foreground">
            {[
              numbered ? t("outputHeading", { n: output.index + 1 }) : null,
              output.pageRanges.length > 0
                ? t("pages", { ranges: formatPageRanges(output.pageRanges) })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {output.enumDecision !== null ? (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-muted p-3">
            <span className="text-xs text-muted-foreground">
              {t("decision")}
            </span>
            <span className="text-sm font-medium">
              {output.enumDecision || t("unclassified")}
            </span>
          </div>
        ) : null}
        {output.json !== null ? (
          <InstructStructured
            value={output.json}
            renderText={renderText}
            labels={structuredLabels}
          />
        ) : output.text.trim() === "" ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          renderText(output.text)
        )}
        {rawJson !== null ? (
          <details className="min-w-0">
            <summary
              className="cursor-pointer rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              data-testid="job-review-instruct-raw-toggle"
            >
              {t("rawJson")}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5">
              {rawJson}
            </pre>
          </details>
        ) : null}
      </section>
    </InstructCitationContext>
  );
}
