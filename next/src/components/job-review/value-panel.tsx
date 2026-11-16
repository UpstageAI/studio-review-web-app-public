"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  changedValueResultIds,
  findResult,
  isValidateStepType,
  linkedDocumentIds,
  results as jobResults,
  resultsForDocument,
  type DocumentChange,
  type DropReason,
  type JsonPath,
  type JsonValue,
  type PairedHighlight,
  type Result,
  type ValueDraft,
  validateValues,
} from "@/lib/review-model";
import type { ValueEdit } from "./content-tree";
import {
  EMPTY_FIELD_ERRORS,
  fieldErrorsFrom,
  schemaErrorsFor,
  type FieldError,
} from "./field-errors";
import {
  savedFieldsFor,
  stepFieldKeys,
  visibleFieldList,
} from "./field-filter";
import { FieldsMenu, HiddenFieldsNotice } from "./fields-menu";
import { historyAvailability } from "./history-model";
import { useJobReview } from "./job-review-context";
import { isInstructHighlightId, isParseHighlightId } from "./job-review-state";
import { ResultSection } from "./result-section";
import { localStore } from "@/lib/browser-storage";
import { UnlinkedResults } from "./unlinked-results";
import { originalValueAt } from "./cleared-value";
import { markHighlightInput } from "./perf-marks";
import { ValidationSummary } from "./validation-summary";
import {
  HIGHLIGHT_KEEP_SELECTOR,
  useOutsidePointerDown,
} from "./use-outside-pointer-down";
import { isSaveErrorCode } from "./save-errors";
import { useFieldChoices } from "./use-field-filter";
import {
  readValueDisplay,
  writeValueDisplay,
  type ValueDisplay,
} from "./value-display";
import type { ValidateRule } from "@/lib/review-api/validate-rules";
import { fieldEntryIds, lockReasonFor } from "./value-fields";
import {
  readValueFilter,
  writeValueFilter,
  type ValueFilter,
} from "./value-filter";
import { useReviewPolicy } from "./review-policy-context";

type ResultGroup = {
  stepId: string;
  name: string;
  results: Result[];
};

/** 결과를 Step 별로 묶는다(처음 나온 순서). */
function groupByStep(
  results: readonly Result[],
  steps: Readonly<Record<string, { name: string }>> | undefined,
): ResultGroup[] {
  const out: ResultGroup[] = [];
  for (const result of results) {
    const step =
      steps && Object.hasOwn(steps, result.step_id)
        ? steps[result.step_id]
        : undefined;
    const group = out.find(item => item.stepId === result.step_id);
    if (group) group.results.push(result);
    else {
      out.push({
        stepId: result.step_id,
        name: step?.name ?? result.step_id,
        results: [result],
      });
    }
  }
  return out;
}

/**
 * 값 탭 작업 패널: 선택 문서에 연결된 결과(`document_ids`·Merge 결과의 `field_groups`) 중 고른 Step 의
 * 결과를 schema 기반 폼으로 보이고, 그 Step 의 결과 중 어느 문서에도 연결되지 않은 것은 끝에 접힌 묶음으로 둔다.
 * 편집은 입력을 확정할 때 `set_value`, 배열 항목·필드 추가·삭제·JSON 교체는 그 종류의 변경으로 쌓이고, 행을 고르면 뷰어가 그 위치로 간다.
 * 뷰어에서 위치를 고르면 그 행으로 스크롤하고 입력에 포커스를 준다.
 * 위 칩 "바뀐 값만", "빈 값만", "현재 페이지 값만" 은 행을 거른다(브라우저가 기억). 뷰어에서 고른 행은 필터와 무관하게 보인다.
 * 칩 줄 끝 "필드" 메뉴는 Step 결과의 맨 위 필드 중 고른 것만 보이고(Step 별로 브라우저가 기억), 숨긴 필드는
 * 뷰어 하이라이트에서도 빠진다. 같은 줄 오른쪽 스위치는 값 행의 설명(Validate Step 이면 Config 규칙)을
 * 켜고 끈다(기본 꺼짐, 브라우저가 기억).
 */
export function ValuePanel() {
  const t = useTranslations("review.values");
  const te = useTranslations("review.values.editErrors");
  const tse = useTranslations("review.errors");
  const tsave = useTranslations("review.save");
  const tsch = useTranslations("review.values.schema");
  const locale = useLocale();
  const [filter, setFilter] = useState<ValueFilter>(() =>
    readValueFilter(localStore()),
  );
  const toggleFilter = useCallback(
    (key: keyof ValueFilter) => {
      const next: ValueFilter = { ...filter, [key]: !filter[key] };
      setFilter(next);
      writeValueFilter(localStore(), next);
    },
    [filter],
  );
  const [display, setDisplay] = useState<ValueDisplay>(() =>
    readValueDisplay(localStore()),
  );
  const toggleDisplay = useCallback(
    (key: keyof ValueDisplay, on: boolean) => {
      const next: ValueDisplay = { ...display, [key]: on };
      setDisplay(next);
      writeValueDisplay(localStore(), next);
    },
    [display],
  );
  const displaySwitchId = useId();
  const {
    state,
    dispatch,
    job,
    selected,
    docChanges,
    extractHighlights,
    unlinkedResults: allUnlinked,
    activeStepId,
    saving,
  } = useJobReview();
  const { session, capabilities, response } = state;
  const panelRef = useRef<HTMLDivElement>(null);
  // "현재 페이지 값만" 이 꺼져 있으면 고정값을 넘겨 페이지를 넘겨도 결과 섹션이 다시 그려지지 않게 한다.
  const filterPageIndex = filter.currentPageOnly ? state.selectedPageIndex : -1;
  const steps = session?.current.steps;
  const baseJob = session?.base.jobs[0] ?? null;
  const editableStates = capabilities?.editable_states ?? null;
  const activeStep =
    activeStepId !== null && steps && Object.hasOwn(steps, activeStepId)
      ? steps[activeStepId]
      : undefined;
  // 고른 Step 이 Validate 면 "규칙 보기", 그 외는 "설명 보기". Step 탭이 없으면(모든 Step) 둘 다 둔다.
  const displayKeys: readonly (keyof ValueDisplay)[] =
    activeStepId === null
      ? ["description", "rules"]
      : isValidateStepType(activeStep?.type)
        ? ["rules"]
        : ["description"];

  // 값 탭은 그 Step 의 결과만 보인다(탭이 없으면 모든 Step).
  const inStep = useCallback(
    (result: Result) =>
      activeStepId === null || result.step_id === activeStepId,
    [activeStepId],
  );
  const groups = useMemo<ResultGroup[]>(
    () =>
      job && selected
        ? groupByStep(
            resultsForDocument(job, selected.document.document_id).filter(
              inStep,
            ),
            steps,
          )
        : [],
    [job, selected, steps, inStep],
  );
  const unlinkedResults = useMemo(
    () => allUnlinked.filter(inStep),
    [allUnlinked, inStep],
  );
  const unlinkedGroups = useMemo(
    () => groupByStep(unlinkedResults, steps),
    [unlinkedResults, steps],
  );

  // "필드" 메뉴: 이 Step 결과의 맨 위 필드(schema 순서, 문서와 무관하게 Job 전체 결과 기준) 중 고른
  // 것만 보인다. 고른 값은 Step 별로 브라우저가 기억한다. 보이는 키를 글로 바꿔 같은 선택이면 같은
  // 집합을 넘겨, 값을 고쳐도 다른 결과 섹션이 다시 그려지지 않게 한다.
  const activeSchema = activeStep?.schema ?? null;
  const fieldKeys = useMemo(
    () =>
      job && activeStepId !== null
        ? stepFieldKeys(
            activeSchema,
            jobResults(job)
              .filter(result => result.step_id === activeStepId)
              .map(result => result.content),
          )
        : NO_FIELDS,
    [job, activeStepId, activeSchema],
  );
  const [fieldChoices, setStepFields] = useFieldChoices();
  const visibleSignature = useMemo(() => {
    if (activeStepId === null) return null;
    const list = visibleFieldList(
      fieldKeys,
      savedFieldsFor(fieldChoices, activeStepId),
    );
    return list === null ? null : JSON.stringify(list);
  }, [fieldKeys, fieldChoices, activeStepId]);
  const visibleFieldKeys = useMemo(
    () =>
      visibleSignature === null
        ? null
        : (JSON.parse(visibleSignature) as string[]),
    [visibleSignature],
  );
  const visibleFields = useMemo(
    () => (visibleFieldKeys === null ? null : new Set(visibleFieldKeys)),
    [visibleFieldKeys],
  );
  const hiddenFieldCount =
    visibleFieldKeys === null ? 0 : fieldKeys.length - visibleFieldKeys.length;
  const changeFields = useCallback(
    (visible: readonly string[] | null) => {
      if (activeStepId !== null) setStepFields(activeStepId, visible);
    },
    [activeStepId, setStepFields],
  );
  const showAllFields = useCallback(() => changeFields(null), [changeFields]);

  const changesFor = useCallback(
    (result: Result): DocumentChange[] => {
      const linked = new Set(linkedDocumentIds(result));
      return [...docChanges.values()].filter(change =>
        linked.has(change.documentId),
      );
    },
    [docChanges],
  );

  const highlightsByResult = useMemo(() => {
    const map = new Map<string, Map<string, PairedHighlight>>();
    for (const highlight of extractHighlights) {
      const resultId = highlight.id.slice(
        0,
        highlight.id.length - highlight.pointer.length - 1,
      );
      let inner = map.get(resultId);
      if (!inner) {
        inner = new Map();
        map.set(resultId, inner);
      }
      inner.set(highlight.pointer, highlight);
    }
    return map;
  }, [extractHighlights]);

  const entriesRef = useRef(session?.entries ?? []);
  useEffect(() => {
    entriesRef.current = session?.entries ?? [];
  }, [session?.entries]);

  const jobId = job?.id ?? "";
  const onApply = useCallback(
    (resultId: string, path: JsonPath, value: JsonValue) =>
      dispatch({
        type: "APPLY",
        draft: { kind: "set_value", jobId, resultId, path, value },
      }),
    [dispatch, jobId],
  );
  const onEdit = useCallback(
    (resultId: string, edit: ValueEdit) =>
      dispatch({
        type: "APPLY",
        draft: { ...edit, jobId, resultId } as ValueDraft,
      }),
    [dispatch, jobId],
  );
  const originalAt = useCallback(
    (resultId: string, path: JsonPath) =>
      originalValueAt(
        entriesRef.current,
        baseJob ? findResult(baseJob, resultId)?.content : undefined,
        resultId,
        path,
      ),
    [baseJob],
  );
  const onRevert = useCallback(
    (resultId: string, path: JsonPath) =>
      dispatch({
        type: "REVERT",
        entryIds: fieldEntryIds(entriesRef.current, resultId, path),
      }),
    [dispatch],
  );
  const onSelectHighlight = useCallback(
    (highlight: PairedHighlight) => {
      markHighlightInput("select");
      dispatch({
        type: "SELECT_HIGHLIGHT",
        id: highlight.id,
        source: "panel",
        pageIndex: highlight.viewerIndex,
      });
    },
    [dispatch],
  );
  // 하이라이트가 없는 행(방금 추가한 항목)을 선택한다. 뷰어 페이지는 옮기지 않는다.
  const onSelectPointer = useCallback(
    (resultId: string, pointer: string) =>
      dispatch({
        type: "SELECT_HIGHLIGHT",
        id: `${resultId}#${pointer}`,
        source: "panel",
      }),
    [dispatch],
  );
  const onHoverHighlight = useCallback(
    (id: string | null) => {
      markHighlightInput("hover");
      dispatch({ type: "HOVER_HIGHLIGHT", id });
    },
    [dispatch],
  );
  const historyUnavailable = useMemo(() => {
    const availability = historyAvailability(capabilities);
    return availability.ok ? null : availability.reason;
  }, [capabilities]);
  // 설정에서 변경 이력을 끄면 결과 메뉴 항목도 두지 않는다.
  const historyOn = useReviewPolicy().features.history;
  const history = useMemo(
    () =>
      historyOn
        ? {
            onShow: (resultId: string) =>
              dispatch({ type: "OPEN_HISTORY", resultId }),
            unavailable: historyUnavailable,
          }
        : undefined,
    [historyOn, dispatch, historyUnavailable],
  );

  // 뷰어에서 고른 위치 → 그 필드 행으로 스크롤하고 입력에 포커스.
  const { selectedHighlightId, highlightSource } = state;
  useEffect(() => {
    if (highlightSource !== "viewer" || !selectedHighlightId) return;
    const frame = requestAnimationFrame(() => {
      const row = panelRef.current?.querySelector<HTMLElement>(
        `[data-field-id="${CSS.escape(selectedHighlightId)}"]`,
      );
      if (!row) return;
      row.scrollIntoView({ block: "nearest" });
      row
        .querySelector<HTMLElement>("[data-field-input]")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedHighlightId, highlightSource]);

  // 고정한 값 행·뷰어·열린 오버레이 밖을 누르면 고정을 푼다. 다른 행을 누르면 여기서 풀린 뒤
  // 그 행의 focus 로 다시 선택되어 선택이 옮겨진다.
  useOutsidePointerDown(
    selectedHighlightId !== null &&
      !isInstructHighlightId(selectedHighlightId) &&
      !isParseHighlightId(selectedHighlightId),
    target =>
      target.closest(HIGHLIGHT_KEEP_SELECTOR) !== null ||
      target.closest("[data-field-id]")?.getAttribute("data-field-id") ===
        selectedHighlightId,
    () => dispatch({ type: "SELECT_HIGHLIGHT", id: null }),
  );

  // 저장이 거부된 결과: 충돌 대상이거나 서버 오류 위치가 가리키는 결과.
  const saveStatus = state.save;
  const serverErrors = useMemo(() => {
    const map = new Map<string, { message: string; pointer: string | null }>();
    if (saveStatus.phase === "conflict") {
      for (const id of saveStatus.conflict.resultIds) {
        map.set(id, { message: tsave("conflictResult"), pointer: null });
      }
    } else if (saveStatus.phase === "failed" && saveStatus.resultId) {
      map.set(saveStatus.resultId, {
        message: isSaveErrorCode(saveStatus.code)
          ? tse(saveStatus.code)
          : tse("unknownCode", { code: saveStatus.code }),
        pointer: saveStatus.fieldPointer,
      });
    }
    return map;
  }, [saveStatus, tsave, tse]);

  // 편집한 결과는 schema 를 바로 검사해 행 오류로 보인다(저장 전 검증과 같은 규칙). 결과 객체마다
  // 한 번만 계산해 두므로, 편집하지 않은 결과는 구조 공유로 같은 객체라 같은 Map 을 받아 결과 섹션이
  // 다시 그려지지 않는다.
  const changedResultIds = useMemo(
    () => changedValueResultIds(session?.entries ?? []),
    [session?.entries],
  );
  const currentDoc = session?.current ?? null;
  const localErrorsFor = (result: Result): ReadonlyMap<string, FieldError> =>
    currentDoc && job && changedResultIds.has(result.id)
      ? schemaErrorsFor(result, steps, locale, () =>
          fieldErrorsFrom(
            validateValues(currentDoc, job, [result.id]),
            result.id,
            message => tsch(message.key, message.values),
          ),
        )
      : EMPTY_FIELD_ERRORS;

  const renderGroup = (group: ResultGroup) => (
    <div key={group.stepId} className="flex min-w-0 flex-col gap-3">
      {group.results.map((result, index) => {
        const step =
          steps && Object.hasOwn(steps, result.step_id)
            ? steps[result.step_id]
            : undefined;
        // Step 탭이 이미 Step 을 말하므로 그 안에서는 결과 순번만 보인다.
        const heading =
          activeStepId !== null
            ? group.results.length > 1
              ? t("resultOrdinal", { n: index + 1 })
              : t("result")
            : group.results.length > 1
              ? t("stepOrdinal", { name: group.name, n: index + 1 })
              : group.name;
        return (
          <ResultSection
            key={result.id}
            result={result}
            baseResult={
              baseJob
                ? (findResult(baseJob, result.id) ?? undefined)
                : undefined
            }
            step={step}
            heading={heading}
            lock={lockReasonFor(result, changesFor(result), editableStates)}
            highlights={highlightsByResult.get(result.id) ?? EMPTY_HIGHLIGHTS}
            selectedHighlightId={selectedHighlightId}
            disabled={saving}
            serverError={serverErrors.get(result.id) ?? null}
            localErrors={localErrorsFor(result)}
            filter={filter}
            pageIndex={filterPageIndex}
            visibleFields={
              activeStepId !== null && result.step_id === activeStepId
                ? visibleFields
                : null
            }
            showDescription={display.description}
            rules={
              display.rules && response.status !== "loading"
                ? Object.hasOwn(response.validateRules, result.step_id)
                  ? response.validateRules[result.step_id]
                  : NO_RULES
                : undefined
            }
            onSelectHighlight={onSelectHighlight}
            onHoverHighlight={onHoverHighlight}
            onApply={onApply}
            originalValueAt={originalAt}
            onRevert={onRevert}
            onEdit={onEdit}
            onSelectPointer={onSelectPointer}
            history={history}
          />
        );
      })}
    </div>
  );

  if (!selected) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={panelRef}
        data-value-panel=""
        className="flex min-w-0 flex-col gap-4"
      >
        <ValidationSummary />
        {groups.length > 0 || unlinkedResults.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                role="group"
                aria-label={t("filter.label")}
                className="flex flex-wrap items-center gap-1"
              >
                <Button
                  type="button"
                  size="default"
                  variant={filter.changedOnly ? "secondary" : "outline"}
                  aria-pressed={filter.changedOnly}
                  onClick={() => toggleFilter("changedOnly")}
                  data-testid="job-review-values-filter-changed"
                  className="cursor-pointer"
                >
                  {t("filter.changedOnly")}
                </Button>
                <Button
                  type="button"
                  size="default"
                  variant={filter.emptyOnly ? "secondary" : "outline"}
                  aria-pressed={filter.emptyOnly}
                  onClick={() => toggleFilter("emptyOnly")}
                  data-testid="job-review-values-filter-empty"
                  className="cursor-pointer"
                >
                  {t("filter.emptyOnly")}
                </Button>
                <Button
                  type="button"
                  size="default"
                  variant={filter.currentPageOnly ? "secondary" : "outline"}
                  aria-pressed={filter.currentPageOnly}
                  onClick={() => toggleFilter("currentPageOnly")}
                  data-testid="job-review-values-filter-current-page"
                  className="cursor-pointer"
                >
                  {t("filter.currentPageOnly")}
                </Button>
                {fieldKeys.length > 1 ? (
                  <FieldsMenu
                    fields={fieldKeys}
                    visible={visibleFieldKeys}
                    schema={activeSchema}
                    onChange={changeFields}
                  />
                ) : null}
              </div>
              {/* 표시만 바꾸므로 눌러도 고정한 행을 풀지 않는다(고른 행의 설명을 켜 볼 수 있게). 칩과
                  같은 32px 줄 높이에 맞춘다. */}
              <div
                data-highlight-keep=""
                className="flex flex-wrap items-center gap-x-3"
              >
                {displayKeys.map(key => (
                  <div key={key} className="flex h-8 items-center gap-2">
                    <Switch
                      id={`${displaySwitchId}-${key}`}
                      size="sm"
                      checked={display[key]}
                      onCheckedChange={on => toggleDisplay(key, on)}
                      data-testid={`job-review-values-switch-${key}`}
                    />
                    <label
                      htmlFor={`${displaySwitchId}-${key}`}
                      className="text-sm select-none"
                    >
                      {t(`display.${key}`)}
                    </label>
                  </div>
                ))}
              </div>
            </div>
            {filter.currentPageOnly ? (
              <p className="text-xs text-muted-foreground">
                {t("filter.noLocationHint")}
              </p>
            ) : null}
            {hiddenFieldCount > 0 ? (
              <HiddenFieldsNotice
                count={hiddenFieldCount}
                onShowAll={showAllFields}
              />
            ) : null}
          </div>
        ) : null}
        <div aria-live="polite" className="flex flex-col gap-1 empty:hidden">
          {response.status === "loading" ? (
            <p className="text-xs text-muted-foreground">
              {t("responseLoading")}
            </p>
          ) : null}
          {response.status === "error" ? (
            <p className="text-xs text-muted-foreground">
              {t("responseFailed")}
            </p>
          ) : null}
          {state.editError ? (
            <p role="alert" className="text-xs text-destructive">
              {isEditErrorKey(state.editError)
                ? te(state.editError)
                : te("generic", { code: state.editError })}
            </p>
          ) : null}
          {state.revertNotice !== null && !state.trayOpen ? (
            <p className="text-xs text-muted-foreground">
              {tsave("alsoReverted", { count: state.revertNotice })}
            </p>
          ) : null}
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {activeStepId !== null ? t("noStepResults") : t("noResults")}
          </p>
        ) : (
          groups.map(renderGroup)
        )}
        {unlinkedResults.length > 0 ? (
          <UnlinkedResults count={unlinkedResults.length}>
            {unlinkedGroups.map(renderGroup)}
          </UnlinkedResults>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

const EDIT_ERROR_KEYS = [
  "result_missing",
  "path_missing",
  "result_not_editable",
  "path_exists",
  "index_out_of_range",
  "depends_on_reverted",
] as const satisfies readonly DropReason[];

function isEditErrorKey(
  code: string,
): code is (typeof EDIT_ERROR_KEYS)[number] {
  return (EDIT_ERROR_KEYS as readonly string[]).includes(code);
}

const EMPTY_HIGHLIGHTS: ReadonlyMap<string, PairedHighlight> = new Map();

const NO_FIELDS: readonly string[] = [];

/** 응답을 받았지만 그 Step 의 규칙이 없을 때(같은 참조라 결과 섹션이 다시 그려지지 않는다). */
const NO_RULES: readonly ValidateRule[] = [];
