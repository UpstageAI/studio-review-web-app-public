"use client";

import { filterStepTabs } from "@/lib/review-policy/review-steps";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import {
  getCollection,
  getJobResponse,
  getReviewCapabilities,
  getReviewDocumentText,
  isAbortError,
} from "@/lib/review-api/review-screen";
import {
  parseHighlightsByFile,
  readJobResponse,
} from "@/lib/review-api/job-response";
import {
  buildPageSpace,
  changedDocuments,
  changedValueResultIds,
  createSession,
  documentPages,
  documentsOf,
  localToMerged,
  openJobReview,
  pairExtractItems,
  unlinkedResults as unlinkedResultsOf,
  validateJob,
  type DocumentChange,
  type ValidationIssue,
} from "@/lib/review-model";
import {
  highlightsStatusFor,
  viewerHighlightsFor,
  type HighlightsStatus,
} from "./highlight-window";
import {
  JobReviewContext,
  type JobReviewContextValue,
} from "./job-review-context";
import {
  documentKey,
  imageUrlsFor,
  initialState,
  jobFiles,
  jobOf,
  isSaving,
  jobReviewReducer,
  parseHighlightsFor,
  parseVisible,
  type PanelTab,
} from "./job-review-state";
import { useLeaveGuard } from "./leave-guard";
import { markHighlightCommitted, markLoaded } from "./perf-marks";
import { readUrlSelection } from "./url-state";
import { useDraftPersistence } from "./use-draft-persistence";
import { useExtractHighlights } from "./use-extract-highlights";
import { useFileHighlights } from "./use-file-highlights";
import { useFilePages } from "./use-file-pages";
import { useReviewStatus } from "./use-review-status";
import { useSave } from "./use-save";
import {
  instructForDocument,
  instructHighlights,
  parseItemsFor,
} from "./step-outputs";
import {
  defaultStepTab,
  stepTabsFor,
  stepTabsForDocument,
} from "./step-tabs-model";
import { useReviewPolicy } from "./review-policy-context";

/** Job 검수 화면의 상태(useReducer 하나)와 불러오기. */
export function JobReviewProvider({
  collectionId,
  jobId,
  children,
}: {
  collectionId: string;
  jobId: string;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${collectionId}\u0000${jobId}\u0000${attempt}`;
  const [state, dispatch] = useReducer(jobReviewReducer, requestKey, key =>
    initialState(key, collectionId, jobId),
  );
  if (state.requestKey !== requestKey) {
    dispatch({ type: "RESET", requestKey, collectionId, jobId });
  }

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // 한도·Collection 이름은 없어도 화면을 열 수 있으므로 실패를 삼키고(기본값으로 연다) 콘솔에만 남긴다.
    const optional = <T,>(name: string, promise: Promise<T>) =>
      promise.catch((err: unknown) => {
        if (isAbortError(err)) throw err;
        console.warn(
          "[review] optional request failed; using defaults:",
          name,
          err,
        );
        return null;
      });
    Promise.all([
      getReviewDocumentText(collectionId, jobId, { signal }),
      optional(
        "review-capabilities",
        getReviewCapabilities(collectionId, { signal }),
      ),
      optional("collection", getCollection(collectionId, { signal })),
    ]).then(
      ([document, capabilities, collection]) => {
        if (signal.aborted) return;
        try {
          const doc = openJobReview(document.text, jobId);
          markLoaded();
          dispatch({
            type: "LOADED",
            session: createSession(doc),
            sourceText: document.text,
            etag: document.etag,
            capabilities,
            collectionName: collection?.name ?? null,
            // 주소창의 `?doc=…&page=…` 로 연 자리(새로 고침·링크 공유)를 처음 선택으로.
            initialSelection: readUrlSelection(window.location.search),
          });
        } catch (err) {
          dispatch({ type: "LOAD_FAILED", error: err });
        }
      },
      (err: unknown) => {
        if (signal.aborted || isAbortError(err)) return;
        dispatch({ type: "LOAD_FAILED", error: err });
      },
    );
    // 추출값 좌표·Parse 요소. 검수 문서와 함께 받기 시작하고, 실패해도 화면은 연다.
    getJobResponse(collectionId, jobId, { signal }).then(
      response => {
        if (signal.aborted) return;
        dispatch({ type: "RESPONSE_LOADED", data: readJobResponse(response) });
      },
      (err: unknown) => {
        if (signal.aborted || isAbortError(err)) return;
        dispatch({ type: "RESPONSE_FAILED" });
      },
    );
    return () => controller.abort();
  }, [collectionId, jobId, requestKey]);

  const { session, files, response, selectedDocument, mode } = state;
  const job = jobOf(session);
  const baseJob = session?.base.jobs[0] ?? null;

  // 파일 목록은 불러온 문서(base)에서만 바뀐다 — 편집할 때마다 다시 조회하지 않고, 저장 뒤
  // 다시 불러와도 파일이 같으면 그대로 둔다.
  const fileKey = jobFiles(baseJob)
    .map(file => `${file.fileRef}\u0000${file.fileId}`)
    .join("\u0001");
  const fileList = useMemo(
    () => jobFiles(baseJob),
    // 파일 구성(`fileKey`)이 같으면 같은 목록을 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileKey],
  );
  const refreshFiles = useFilePages(fileList, dispatch);
  const { save, reload } = useSave(state, dispatch);
  const { completeReview, reopenReview } = useReviewStatus(state, dispatch);
  // 저장하지 않은 변경을 브라우저에 임시 저장하고, 불러온 직후 지난 임시 저장을 읽는다.
  useDraftPersistence(state, dispatch);
  const saving = isSaving(state.save);
  useLeaveGuard(saving || (session?.entries.length ?? 0) > 0);

  const documents = useMemo(() => (job ? documentsOf(job) : []), [job]);
  const docChanges = useMemo(() => {
    const map = new Map<string, DocumentChange>();
    if (!job || !baseJob) return map;
    for (const change of changedDocuments(baseJob, job)) {
      map.set(documentKey(change), change);
    }
    return map;
  }, [job, baseJob]);

  const selected = useMemo(() => {
    if (!selectedDocument) return null;
    return (
      documents.find(
        item =>
          item.stepId === selectedDocument.stepId &&
          item.document.document_id === selectedDocument.documentId,
      ) ?? null
    );
  }, [documents, selectedDocument]);

  const docPages = useMemo(
    () => (selected ? documentPages(selected.document) : []),
    [selected],
  );
  const imageUrls = useMemo(
    () => imageUrlsFor(docPages, files),
    [docPages, files],
  );

  // 병합 페이지 공간: 검수 문서의 `num_pages` 가 없으면 파일 응답의 페이지 수로 채운다.
  const numPagesKey = Object.entries(files)
    .map(([ref, entry]) => `${ref}\u0000${entry.numPages ?? ""}`)
    .join("\u0001");
  const space = useMemo(() => {
    if (!baseJob) return null;
    const numPages: Record<string, number> = {};
    for (const part of numPagesKey ? numPagesKey.split("\u0001") : []) {
      const [ref, count] = part.split("\u0000");
      if (ref && count) numPages[ref] = Number(count);
    }
    return buildPageSpace(baseJob, numPages);
  }, [baseJob, numPagesKey]);

  // 결과 ↔ 응답 항목 짝은 불러온 문서(base) 기준으로 한 번 정한다(값을 고쳐도 유지).
  const pairing = useMemo(
    () =>
      session && baseJob
        ? pairExtractItems(session.base, baseJob, response.extractItems, space)
        : new Map<string, never>(),
    [session, baseJob, response.extractItems, space],
  );
  const responseParse = useMemo(
    () => parseHighlightsByFile(response.parse, space),
    [response.parse, space],
  );
  const extractHighlights = useExtractHighlights({
    job,
    selected,
    docPages,
    pairing,
    space,
  });

  // 저장 전 검증은 구성 모드이거나 트레이가 열려 있을 때만 계산한다(문서 전체를 훑으므로 값
  // 입력마다 돌리지 않는다). 저장할 때는 `useSave` 가 따로 검증한다.
  const currentDoc = session?.current ?? null;
  const entries = session?.entries;
  const { trayOpen } = state;
  const issues = useMemo<readonly ValidationIssue[]>(() => {
    if ((mode !== "structure" && !trayOpen) || !currentDoc || !job) return [];
    return validateJob(currentDoc, job, {
      changedResultIds: changedValueResultIds(entries ?? []),
    });
  }, [mode, trayOpen, currentDoc, entries, job]);

  // 상단 Step 탭: Job 의 탭 중 선택 문서에 해당하는 것만. 아직 고르지 않았거나 고른 탭이
  // 없어졌으면(다시 불러오기·다른 문서 선택) 기본 탭을 보인다.
  const steps = session?.current.steps;
  // 설정 "검수할 단계" 에서 끈 종류의 탭은 뺀다(모두 꺼지면 전부 보인다).
  const visibleSteps = useReviewPolicy().steps;
  // 숨기기 전에 Job 의 모든 탭에 순서 번호를 매겨, 일부를 숨겨도 번호가 Studio 순서와 같게 한다.
  const jobStepTabs = useMemo(
    () =>
      stepTabsFor(job, steps, response).map((tab, index) => ({
        ...tab,
        order: index + 1,
      })),
    [job, steps, response],
  );
  const { tabs: allStepTabs, fallback: stepsFallback } = useMemo(
    () => filterStepTabs(jobStepTabs, visibleSteps),
    [jobStepTabs, visibleSteps],
  );
  const mergedPages = useMemo(() => {
    if (!space) return null;
    const pages = new Set<number>();
    for (const ref of docPages) {
      const merged = localToMerged(space, ref);
      if (merged !== null) pages.add(merged);
    }
    return pages;
  }, [docPages, space]);
  const selectedDocumentId = selected?.document.document_id ?? null;
  const stepTabs = useMemo(() => {
    if (selectedDocumentId === null) return allStepTabs;
    const forDocument = (tabs: readonly (typeof jobStepTabs)[number][]) =>
      stepTabsForDocument(
        tabs,
        job,
        { documentId: selectedDocumentId, mergedPages },
        response,
      );
    // 설정으로 숨긴 단계만 이 문서에 해당하면(예: Classify 를 끄고 추출 결과가 없는 문서) 탭이 0개가
    // 되어 탭 줄과 본문이 통째로 다시 그려지고 검색어, 스크롤, 포커스가 사라진다. 그때는 이 문서의
    // 탭을 숨기지 않고 그대로 보인다.
    const shown = forDocument(allStepTabs);
    return shown.length > 0 ? shown : forDocument(jobStepTabs);
  }, [
    allStepTabs,
    jobStepTabs,
    job,
    selectedDocumentId,
    mergedPages,
    response,
  ]);
  const activeStepTab = defaultStepTab(stepTabs, state.stepTab, allStepTabs);
  const activeStepId =
    activeStepTab && activeStepTab.kind !== "structure"
      ? activeStepTab.stepId
      : null;
  // 불러온 직후(아직 고른 탭이 없을 때)와 고른 탭이 다시 불러오기로 없어졌을 때 기본 탭을
  // 골라 모드·패널 내용을 맞춘다. 맞춘 뒤에는 id 가 같아 다시 보내지 않는다(저장 중이면
  // reducer 가 무시하고 상태가 그대로라 다시 그리지 않는다).
  // 저장 중에 단계를 숨기면 reducer 가 무시하므로, 저장이 끝나면(`saving` 이 바뀌면) 다시 보낸다.
  useEffect(() => {
    if (activeStepTab && state.stepTab !== activeStepTab.id) {
      dispatch({ type: "SET_STEP_TAB", tab: activeStepTab });
    }
  }, [state.stepTab, activeStepTab, saving]);
  const activePanelTab: PanelTab =
    mode === "values" ? state.panelTab : "results";
  const unlinkedResults = useMemo(
    () => (job ? unlinkedResultsOf(job) : []),
    [job],
  );
  const parseItems = useMemo(
    () =>
      activePanelTab.startsWith("parse:")
        ? parseItemsFor(docPages, response.parseElements, space)
        : [],
    [activePanelTab, docPages, response.parseElements, space],
  );
  const instructView = useMemo(
    () =>
      activePanelTab.startsWith("instruct:")
        ? instructForDocument(
            response.instructOutputs,
            activePanelTab.slice("instruct:".length),
            docPages,
            space,
          )
        : null,
    [activePanelTab, response.instructOutputs, docPages, space],
  );
  const citationHighlights = useMemo(
    () =>
      instructHighlights(instructView, docPages, space, response.parseElements),
    [instructView, docPages, space, response.parseElements],
  );

  // 뷰어에 넘길 영역: 추출값은 결과 탭(그 행이 보일 때)만, Parse 요소는 Parse 탭만, 인용은 그
  // Instruct 탭만. 뷰어는 이 중 가리키거나 고른 것만 그린다(`DocumentViewer`).
  const drawParse = parseVisible({ panelTab: activePanelTab });
  const drawExtract = mode === "values" && activePanelTab === "results";
  const highlights = useMemo(() => {
    const parse = drawParse
      ? parseHighlightsFor(docPages, files, responseParse)
      : [];
    const extract = drawExtract ? extractHighlights : [];
    return mode === "values"
      ? [...extract, ...parse, ...citationHighlights]
      : parse;
  }, [
    docPages,
    files,
    responseParse,
    drawParse,
    drawExtract,
    mode,
    extractHighlights,
    citationHighlights,
  ]);
  // 파일 Parse 하이라이트는 Parse 탭이 열려 있을 때 현재 페이지 주변 묶음만 받는다.
  const { selectedPageIndex, selectedHighlightId, hoveredHighlightId } = state;
  // 측정용: 하이라이트를 가리키거나 고른 렌더의 커밋 끝. 부모의 layout effect 는 자식들 뒤에 돈다.
  useLayoutEffect(() => {
    markHighlightCommitted();
  }, [selectedHighlightId, hoveredHighlightId]);
  useFileHighlights({
    active: drawParse,
    docPages,
    selectedPageIndex,
    files,
    requestKey: state.requestKey,
    dispatch,
  });
  // 뷰어는 현재 페이지 주변 창만 받는다(큰 문서에서 하이라이트 수천 개를 매 렌더 순회하지 않게).
  const viewerHighlights = useMemo(
    () =>
      viewerHighlightsFor(
        highlights,
        selectedPageIndex,
        selectedHighlightId,
        hoveredHighlightId,
      ),
    [highlights, selectedPageIndex, selectedHighlightId, hoveredHighlightId],
  );
  const highlightsStatus = useMemo<HighlightsStatus>(
    () =>
      drawParse
        ? highlightsStatusFor(docPages, selectedPageIndex, files)
        : "idle",
    [drawParse, docPages, selectedPageIndex, files],
  );

  const value = useMemo<JobReviewContextValue>(
    () => ({
      state,
      dispatch,
      retry: () => setAttempt(n => n + 1),
      job,
      documents,
      docChanges,
      selected,
      docPages,
      imageUrls,
      highlights,
      viewerHighlights,
      highlightsStatus,
      extractHighlights,
      pairing,
      space,
      stepTabs,
      allStepTabs,
      jobStepTabCount: jobStepTabs.length,
      stepsFallback,
      activeStepTab,
      activeStepId,
      unlinkedResults,
      parseItems,
      instructView,
      issues,
      refreshFiles,
      save,
      reload,
      saving,
      completeReview,
      reopenReview,
    }),
    [
      state,
      job,
      documents,
      docChanges,
      selected,
      docPages,
      imageUrls,
      highlights,
      viewerHighlights,
      highlightsStatus,
      extractHighlights,
      pairing,
      space,
      stepTabs,
      allStepTabs,
      jobStepTabs,
      stepsFallback,
      activeStepTab,
      activeStepId,
      unlinkedResults,
      parseItems,
      instructView,
      issues,
      refreshFiles,
      save,
      reload,
      saving,
      completeReview,
      reopenReview,
    ],
  );

  return (
    <JobReviewContext.Provider value={value}>
      {children}
    </JobReviewContext.Provider>
  );
}
