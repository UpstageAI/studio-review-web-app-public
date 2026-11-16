"use client";

import { useTranslations } from "next-intl";
import { EllipsisVerticalIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { StatusChip } from "@/components/job-review/status-chip";
import { VerdictSegment } from "@/components/studio-ui-kit/verdict-segment";
import type { Verdict } from "@/components/studio-ui-kit/verdict-segment";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  contentLeaves,
  isHiddenWrapper,
  isMergeStepType,
  isValidateStepType,
  isVerdictValue,
  jsonEquals,
  type JsonPath,
  type JsonValue,
  type PairedHighlight,
  type Result,
  type ReviewStep,
  type ValueLockReason,
} from "@/lib/review-model";
import type { ValidateRule } from "@/lib/review-api/validate-rules";
import { ContentTree, type ValueEdit } from "./content-tree";
import type { HistoryUnavailableReason } from "./history-model";
import { withServerError, type FieldError } from "./field-errors";
import { leafPointersInFields, withErrorFields } from "./field-filter";
import { JsonValueDialog } from "./json-value-dialog";
import {
  changedContainerPointers,
  changedLeafPointers,
  emptyContainerPointers,
  emptyLeafPointers,
  valueAt,
} from "./value-fields";
import { ValidateRules } from "./validate-rules";
import {
  countHidden,
  visibleNodeSet,
  visiblePointerFor,
  type ValueFilter,
} from "./value-filter";

/** 판정 칸 버튼에 붙이는 표식. Enter 뒤 다음 입력 칸 찾기·뷰어 선택 시 포커스가 `[data-field-input]` 을 찾는다. */
const FIELD_INPUT_PROPS = { "data-field-input": "" } as const;

const EMPTY_POINTERS: ReadonlySet<string> = new Set();

function asVerdict(value: JsonValue | undefined): Verdict | null {
  return isVerdictValue(value) ? value : null;
}

export interface ResultSectionProps {
  /** 현재(편집 반영) 결과. */
  result: Result;
  /** 불러온 결과(원본 값 비교용). */
  baseResult: Result | undefined;
  step: ReviewStep | undefined;
  /** Step 이름(같은 Step 결과가 여럿이면 순번 포함). */
  heading: string;
  lock: ValueLockReason | null;
  /** pointer → 추출값 하이라이트(선택 문서에 그려지는 것만). */
  highlights: ReadonlyMap<string, PairedHighlight>;
  selectedHighlightId: string | null;
  disabled: boolean;
  /** 저장이 거부된 이유(충돌·서버 검증). `pointer` 가 있으면 그 필드 행에도 표시한다. */
  serverError?: { message: string; pointer: string | null } | null;
  /**
   * 편집한 결과의 schema 검사 오류(pointer → 문구). 편집하지 않은 결과는 빈 Map. 같은 결과 값이면 같은
   * 객체를 넘겨 다시 그리지 않게 한다.
   */
  localErrors: ReadonlyMap<string, FieldError>;
  /** 값 필터(바뀐 값만, 빈 값만, 현재 페이지 값만). Validate 판정에는 적용하지 않는다. */
  filter: ValueFilter;
  /**
   * "현재 페이지 값만" 이 볼 뷰어 페이지(0-based). 필터가 꺼져 있으면 호출하는 쪽이 `-1` 처럼 고정값을
   * 넘겨 페이지를 넘길 때마다 이 섹션이 다시 그려지지 않게 한다.
   */
  pageIndex: number;
  /**
   * "필드" 메뉴로 고른 보이는 맨 위 필드 키(없으면 모든 필드). 값 필터와 함께 쓰면 보이는 필드 안에서만
   * 거르고, "n개 숨김" 도 그 안에서만 센다. 같은 선택이면 같은 집합을 넘겨 다시 그리지 않게 한다.
   */
  visibleFields?: ReadonlySet<string> | null;
  /** 값 행 아래에 schema 설명을 보인다. */
  showDescription?: boolean;
  /**
   * Validate 판정 아래(원본 판정 근거 다음)에 보일 Config 규칙. `undefined` 면 보이지 않는다(토글 꺼짐
   * 또는 Job 응답을 아직 받지 못함), 빈 목록이면 "규칙 없음" 안내.
   */
  rules?: readonly ValidateRule[];
  onSelectHighlight: (highlight: PairedHighlight) => void;
  onHoverHighlight: (id: string | null) => void;
  onApply: (resultId: string, path: JsonPath, value: JsonValue) => void;
  /** 지금 경로의 처음 값(`ContentTreeProps.originalValueAt`). */
  originalValueAt?: (resultId: string, path: JsonPath) => JsonValue | undefined;
  onRevert: (resultId: string, path: JsonPath) => void;
  /** 배열 항목·키·하위 트리 변경. */
  onEdit: (resultId: string, edit: ValueEdit) => void;
  /** 하이라이트 없이 행을 선택한다(뷰어 페이지는 그대로). */
  onSelectPointer?: (resultId: string, pointer: string) => void;
  /**
   * 머리 메뉴 "이 결과의 변경 이력". 있으면 잠긴 결과에서도 메뉴가 열린다(이력은 보기 전용).
   * `unavailable` 이면 항목을 비활성으로 두고 이유를 둘째 줄에 보인다. 같은 값이면 같은 객체를 넘긴다.
   */
  history?: {
    onShow: (resultId: string) => void;
    unavailable: HistoryUnavailableReason | null;
  };
}

/**
 * 결과 하나의 값 폼. Validate 는 판정 세그먼트, 그 외는 schema 를 따라 걷는 트리
 * (`ContentTree`). 머리 메뉴 "JSON 으로 편집" 은 결과 값 전체를 교체한다.
 */
export const ResultSection = memo(function ResultSection({
  result,
  baseResult,
  step,
  heading,
  lock,
  highlights,
  selectedHighlightId,
  disabled,
  serverError = null,
  localErrors,
  filter,
  pageIndex,
  visibleFields = null,
  showDescription = false,
  rules,
  onSelectHighlight,
  onHoverHighlight,
  onApply,
  originalValueAt,
  onRevert,
  onEdit,
  onSelectPointer,
  history,
}: ResultSectionProps) {
  const t = useTranslations("review.values");
  const tc = useTranslations("review.chips");
  const tv = useTranslations("review.verdict");
  const tt = useTranslations("review.values.tree");
  const th = useTranslations("review.header.historyUnavailable");
  const [jsonOpen, setJsonOpen] = useState(false);
  const openJson = useCallback(() => setJsonOpen(true), []);
  const leaves = useMemo(() => contentLeaves(result.content), [result.content]);
  const locked = lock !== null || disabled;
  const baseContent = baseResult?.content;
  // 바뀐 leaf(값이 달라졌거나 새로 생김)의 pointer. 필터 "바뀐 값만" 과 변경 수가 함께 쓴다.
  const changed = useMemo(
    () => changedLeafPointers(result.content, baseContent),
    [result.content, baseContent],
  );
  // 바뀐 leaf + 없어진 leaf. 빈 배열·객체만 달라졌으면 1.
  const changedCount = useMemo(() => {
    let count = changed.size;
    if (baseContent !== undefined) {
      count += contentLeaves(baseContent).filter(
        leaf => valueAt(result.content, leaf.path) === undefined,
      ).length;
      if (count === 0 && !jsonEquals(baseContent, result.content)) count = 1;
    }
    return count;
  }, [changed, baseContent, result.content]);

  // 값 필터. 꺼져 있으면 `undefined` 로 트리가 기존 경로를 그대로 탄다. "현재 페이지 값만" 이
  // 꺼져 있으면 페이지를 고정값으로 두어 페이지를 넘겨도 다시 계산하지 않는다.
  const { changedOnly, currentPageOnly, emptyOnly } = filter;
  const effectivePage = currentPageOnly ? pageIndex : -1;
  // 빈 leaf. "빈 값만" 이 꺼져 있으면 계산하지 않는다.
  const empty = useMemo(
    () => (emptyOnly ? emptyLeafPointers(result.content) : EMPTY_POINTERS),
    [emptyOnly, result.content],
  );
  const visiblePointer = useMemo(
    () =>
      visiblePointerFor({
        filter: { changedOnly, currentPageOnly, emptyOnly },
        changed,
        empty,
        highlights,
        pageIndex: effectivePage,
      }),
    [
      changedOnly,
      currentPageOnly,
      emptyOnly,
      changed,
      empty,
      highlights,
      effectivePage,
    ],
  );
  const isVerdict =
    isValidateStepType(step?.type) &&
    leaves.length === 1 &&
    leaves[0] !== undefined;
  // 트리가 그릴 노드(보이는 leaf + 조상). 선택·오류 행은 필터와 무관하게 보인다. 판정 세그먼트에는
  // 필터가 없다. 필터가 꺼져 있으면 `null` 로 트리가 기존 경로를 그대로 탄다.
  const selectedPointer =
    selectedHighlightId?.startsWith(`${result.id}#`) === true
      ? selectedHighlightId.slice(result.id.length + 1)
      : null;
  // 행 오류: 서버 오류가 가리키는 행이 로컬 schema 검사보다 앞선다.
  const errors = useMemo(
    () => withServerError(localErrors, serverError),
    [localErrors, serverError],
  );
  const errorPointers = useMemo(() => [...errors.keys()], [errors]);
  // "필드" 메뉴로 고른 맨 위 필드. 저장을 막는 오류가 있는 필드는 숨겨도 보인다. 판정 세그먼트에는
  // 필드가 없다. 값 필터와 "n개 숨김" 은 보이는 필드의 leaf 만 본다.
  const wrapped = useMemo(
    () => isHiddenWrapper(step?.schema ?? null, result.content),
    [step?.schema, result.content],
  );
  const shownFields = useMemo(
    () => (isVerdict ? null : withErrorFields(visibleFields, errors, wrapped)),
    [isVerdict, visibleFields, errors, wrapped],
  );
  const leafPointers = useMemo(
    () => leafPointersInFields(leaves, shownFields, wrapped),
    [leaves, shownFields, wrapped],
  );
  // "바뀐 값만", "빈 값만" 에서는 leaf 로 드러나지 않는 것(항목을 모두 지운 배열, 항목이 없는 배열 등)을
  // 담은 컨테이너도 보인다. 둘 다 켜져 있으면 두 조건을 모두 만족하는 컨테이너만. 변경 수, 숨김 수는
  // leaf 기준 그대로다. "현재 페이지 값만" 이 함께 켜지면 위치가 없는 컨테이너는 그대로 숨긴다.
  const changedContainers = useMemo(() => {
    if (currentPageOnly || (!changedOnly && !emptyOnly)) return EMPTY_POINTERS;
    const changedSet = changedOnly
      ? changedContainerPointers(result.content, baseContent)
      : null;
    const emptySet = emptyOnly ? emptyContainerPointers(result.content) : null;
    if (changedSet && emptySet) {
      return new Set([...changedSet].filter(pointer => emptySet.has(pointer)));
    }
    return changedSet ?? emptySet ?? EMPTY_POINTERS;
  }, [changedOnly, currentPageOnly, emptyOnly, result.content, baseContent]);
  const visibleNodes = useMemo(
    () =>
      visiblePointer === undefined || isVerdict
        ? null
        : visibleNodeSet(leafPointers, visiblePointer, [
            selectedPointer,
            ...errorPointers,
            ...changedContainers,
          ]),
    [
      visiblePointer,
      isVerdict,
      leafPointers,
      selectedPointer,
      errorPointers,
      changedContainers,
    ],
  );
  const hidden = useMemo(
    () =>
      visibleNodes === null
        ? 0
        : countHidden(leafPointers, pointer => visibleNodes.has(pointer)),
    [visibleNodes, leafPointers],
  );

  const chips = (
    <>
      {lock ? (
        <StatusChip kind="locked" reason={tc(`lock.${lock}`)}>
          {tc("locked")}
        </StatusChip>
      ) : null}
      {result.state === "stale" ? (
        <StatusChip kind="recheck" reason={tc("staleReason")}>
          {tc("recheck")}
        </StatusChip>
      ) : null}
      {changedCount > 0 ? (
        <StatusChip kind="changed">
          {tc("changedCount", { count: changedCount })}
        </StatusChip>
      ) : null}
    </>
  );

  let body;
  if (isVerdict && leaves[0]) {
    const leaf = leaves[0];
    const machine = baseResult
      ? valueAt(baseResult.content, leaf.path)
      : undefined;
    const changed = !jsonEquals(machine, leaf.value);
    const verdict = (
      <VerdictSegment
        value={asVerdict(leaf.value)}
        onValueChange={value => onApply(result.id, leaf.path, value)}
        disabled={locked}
        buttonProps={FIELD_INPUT_PROPS}
        checks={changed ? null : result.checks}
        notice={
          changed
            ? tv("changedNotice")
            : result.checks && result.checks.length > 0
              ? tv("checksNotice")
              : undefined
        }
        labels={{
          group: tv("group"),
          verdicts: {
            green: tv("green"),
            yellow: tv("yellow"),
            red: tv("red"),
          },
          checks: tv("checks"),
          passed: tv("passed"),
          failed: tv("failed"),
        }}
        testId="job-review-verdict"
      />
    );
    body = rules ? (
      <div className="flex flex-col gap-3">
        {verdict}
        <ValidateRules rules={rules} />
      </div>
    ) : (
      verdict
    );
  } else {
    body = (
      <ContentTree
        result={result}
        baseResult={baseResult}
        step={step}
        locked={locked}
        highlights={highlights}
        selectedHighlightId={selectedHighlightId}
        errors={errors}
        errorPointers={errorPointers}
        onEditJson={locked ? undefined : openJson}
        visibleNodes={visibleNodes}
        visibleFields={shownFields}
        showDescription={showDescription}
        onSelectHighlight={onSelectHighlight}
        onHoverHighlight={onHoverHighlight}
        onApply={onApply}
        originalValueAt={originalValueAt}
        onRevert={onRevert}
        onEdit={onEdit}
        onSelectPointer={onSelectPointer}
      />
    );
  }

  return (
    <section
      className="flex min-w-0 flex-col gap-2"
      data-result-id={result.id}
      aria-label={heading}
    >
      {/* 오른쪽 여백을 필드 행(pr-2)과 맞춰 머리와 필드의 ⋮ 메뉴가 한 줄로 선다. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 pr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <h4
              tabIndex={0}
              className="min-w-0 rounded-sm text-sm font-semibold break-words focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
            >
              {heading}
            </h4>
          </TooltipTrigger>
          <TooltipContent>{t("resultId", { id: result.id })}</TooltipContent>
        </Tooltip>
        {chips}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={locked && !history}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={tt("resultMenu", { name: heading })}
              data-testid="job-review-result-button-menu"
              className="ml-auto shrink-0 cursor-pointer text-muted-foreground"
            >
              <EllipsisVerticalIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={locked}
              onSelect={() => setJsonOpen(true)}
              data-testid="job-review-result-menu-edit-json"
            >
              {tt("editJson")}
            </DropdownMenuItem>
            {history ? (
              <DropdownMenuItem
                disabled={history.unavailable !== null}
                onSelect={() => history.onShow(result.id)}
                data-testid="job-review-result-menu-history"
                className="flex-col items-start gap-0.5"
              >
                <span>{tt("history")}</span>
                {history.unavailable !== null ? (
                  <span className="text-xs text-muted-foreground">
                    {th(history.unavailable)}
                  </span>
                ) : null}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {serverError ? (
        <p
          role="alert"
          className="text-xs text-destructive"
          data-testid="job-review-result-error"
        >
          {serverError.message}
        </p>
      ) : null}
      {isMergeStepType(step?.type) ? (
        <p className="text-xs text-muted-foreground">{t("mergeNotice")}</p>
      ) : null}
      {hidden > 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="job-review-values-filter-hidden"
        >
          {t("filter.hidden", { count: hidden })}
        </p>
      ) : null}
      {body}
      <JsonValueDialog
        open={jsonOpen}
        onOpenChange={setJsonOpen}
        heading={heading}
        content={result.content}
        schema={step?.schema ?? null}
        onApply={value => {
          setJsonOpen(false);
          onEdit(result.id, { kind: "replace_subtree", path: [], value });
        }}
      />
    </section>
  );
});
