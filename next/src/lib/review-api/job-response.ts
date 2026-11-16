import {
  extractItemsFromResponse,
  isParseStepType,
  mergedToLocal,
  type Coordinate,
  type ExtractItem,
  type HighlightLike,
  type PageSpace,
} from "@/lib/review-model";
import { readInstructOutput, type InstructOutput } from "./instruct";
import {
  elementId,
  elementImage,
  elementTableHtml,
  elementText,
  elementsOf,
  parseElementKey,
  readCoordinates,
  record,
  toHighlights,
  type ParseElement,
} from "./parse-highlights";
import {
  validateRulesFromResponse,
  type ValidateRulesByStep,
} from "./validate-rules";

// Job 응답(`GET /api/search-collections/{id}/source-jobs/{jobId}/response`)에서 화면이 쓰는 것만 꺼낸다.
// - Extract 항목: 결과 값과 같은 경로의 좌표(추출값 하이라이트). 항목 JSON 은 숫자 보존 파서로 읽는다.
// - Parse 요소: Collection 경유 파일은 파일 응답에 Parse 요소가 비어 있어서, Job 의 Parse Step 출력에서 읽는다.
//   하이라이트와 함께 요소 목록(본문 글자, 그림 요소의 이미지, 표 요소의 `html`)도 꺼낸다. 그 밖의 `words`·`html`·
//   `markdown` 은 버린다(메모리).
// - Instruct 출력: markdown(또는 JSON) 본문·결정(enum)·인용·페이지 범위(`instruct.ts`).
// - Validate 규칙: Config 에 설정된 check 이름·심각도·조건 트리(`validate-rules.ts`).
// 좌표·페이지는 모두 그 Job 입력 전체의 병합 페이지 공간(`input_index` 순으로 이어 붙인 1-based 번호)이다.
// 화면 Parse id 는 파일 로컬 번호(`parse:{file_ref}:p{로컬 page}-{elementId}`)라 파일 하이라이트 API 와
// 같은 공간이다 — `parseHighlightsByFile` 과 목록(`parseItemsFor`)이 병합 번호를 로컬 번호로 바꿔 조립한다.

/** Parse 요소 목록 항목(보기용으로 줄인 것). */
export type ParseElementItem = {
  /** 응답 하이라이트(`JobResponseData.parse`)와 같은 `p{병합 page}-{elementId}`. 화면 id 가 아니다. */
  id: string;
  /** 원 요소 id(요소의 `id`, 없으면 페이지 안 순번). 화면 id 는 이것과 파일 로컬 page 로 만든다. */
  elementId: string;
  /** 병합 페이지(1-based). */
  page: number;
  category: string;
  /** `content.text`, 없으면 `markdown`(이미지 표기 제외), 없으면 `html` 의 태그를 지운 글자. */
  text: string;
  /** 그림 요소의 이미지 URL(BFF 의 `figure_url`, 없으면 `base64_encoding` 의 data URL). 없으면 `null`. */
  image: string | null;
  /**
   * 표 요소의 `content.html` 원문(표로 그릴 근거). 표가 아니거나 비었거나 길이 상한을 넘으면 `null`.
   * `text` 는 이 값과 무관하게 위 규칙 그대로다.
   */
  tableHtml: string | null;
  coordinates: Coordinate[] | null;
};

/** 응답에 실린 Step 순서(같은 Step 의 여러 message 는 한 번). */
export type ResponseStep = {
  stepId: string;
  stepType: string;
  /** 응답 `model`(Step 이름). 없으면 빈 문자열. */
  stepName: string;
};

export type JobResponseData = {
  extractItems: ExtractItem[];
  /** Parse 요소 하이라이트. `page` 는 병합 페이지, id 는 `p{병합 page}-{elementId}`. */
  parse: HighlightLike[];
  /** 첫 Parse 출력의 요소(병합 페이지 순). 하이라이트와 같은 출력·같은 id. */
  parseElements: ParseElementItem[];
  /** `parseElements` 를 낸 Parse Step. 없으면 `null`. */
  parseStepId: string | null;
  /** Instruct 출력(응답 순서). `index` 는 Step 안 순번. */
  instructOutputs: InstructOutput[];
  /** Validate Step 별 설정 규칙. */
  validateRules: ValidateRulesByStep;
  stepOrder: ResponseStep[];
};

/** 응답을 받지 못했거나 읽을 수 없을 때. */
export const EMPTY_JOB_RESPONSE: JobResponseData = {
  extractItems: [],
  parse: [],
  parseElements: [],
  parseStepId: null,
  instructOutputs: [],
  validateRules: {},
  stepOrder: [],
};

/** Parse Step 출력 항목(`content[i].text`)의 요소 배열. 읽지 못하면 빈 배열. */
function parseOutputElements(text: unknown): ReturnType<typeof elementsOf> {
  if (typeof text !== "string") return elementsOf(text);
  try {
    // 좌표·페이지만 쓰므로 숫자 정밀도가 필요 없다(본문이 커서 빠른 파서를 쓴다).
    return elementsOf(JSON.parse(text) as unknown);
  } catch {
    return [];
  }
}

type ParseOutput = {
  stepId: string | null;
  /** 병합 페이지 → 그 페이지 요소(응답 순서). 페이지 오름차순. */
  pages: [number, ParseElement[]][];
};

/** 요소가 하나라도 있는 첫 Parse 출력. 페이지가 정수가 아닌 요소는 뺀다. */
function firstParseOutput(response: unknown): ParseOutput | null {
  const output = record(response).output;
  if (!Array.isArray(output)) return null;
  for (const raw of output) {
    const message = record(raw);
    if (!isParseStepType(message.step_type)) continue;
    if (!Array.isArray(message.content)) continue;
    const elements = message.content.flatMap(item =>
      parseOutputElements(record(item).text),
    );
    if (elements.length === 0) continue;
    const byPage = new Map<number, ParseElement[]>();
    for (const element of elements) {
      const { page } = element;
      if (typeof page !== "number" || !Number.isInteger(page)) continue;
      const list = byPage.get(page);
      if (list) list.push(element);
      else byPage.set(page, [element]);
    }
    return {
      stepId: typeof message.step_id === "string" ? message.step_id : null,
      pages: [...byPage.entries()].sort(([a], [b]) => a - b),
    };
  }
  return null;
}

function highlightsOf(parse: ParseOutput | null): HighlightLike[] {
  return (parse?.pages ?? []).flatMap(([page, elements]) =>
    toHighlights(elements, page),
  );
}

function elementItemsOf(parse: ParseOutput | null): ParseElementItem[] {
  return (parse?.pages ?? []).flatMap(([page, elements]) =>
    elements.map((element, index) => {
      const id = elementId(element, index);
      return {
        id: parseElementKey(page, id),
        elementId: id,
        page,
        category: typeof element.category === "string" ? element.category : "",
        text: elementText(element.content),
        image: elementImage(element),
        tableHtml: elementTableHtml(element),
        coordinates: readCoordinates(element.coordinates),
      };
    }),
  );
}

/** Job 응답의 Parse Step 출력 → 병합 페이지 기준 하이라이트. 첫 Parse 출력만 쓴다. */
export function parseHighlightsFromResponse(
  response: unknown,
): HighlightLike[] {
  return highlightsOf(firstParseOutput(response));
}

/** Job 응답의 Instruct 출력 전부. 같은 Step 의 여러 message 는 `index` 를 이어 붙인다. */
export function instructOutputsFromResponse(
  response: unknown,
): InstructOutput[] {
  const output = record(response).output;
  if (!Array.isArray(output)) return [];
  const counts = new Map<string, number>();
  return output.flatMap(message =>
    readInstructOutput(message).map(item => {
      const index = counts.get(item.stepId) ?? 0;
      counts.set(item.stepId, index + 1);
      return { ...item, index };
    }),
  );
}

/** 응답 `output[]` 의 Step 순서. */
export function stepOrderFromResponse(response: unknown): ResponseStep[] {
  const output = record(response).output;
  if (!Array.isArray(output)) return [];
  const out: ResponseStep[] = [];
  for (const raw of output) {
    const message = record(raw);
    const stepId = message.step_id;
    if (typeof stepId !== "string" || stepId === "") continue;
    if (out.some(step => step.stepId === stepId)) continue;
    out.push({
      stepId,
      stepType: typeof message.step_type === "string" ? message.step_type : "",
      stepName: typeof message.model === "string" ? message.model : "",
    });
  }
  return out;
}

/** Job 응답 본문(JSON) → 화면이 쓰는 것. 모양이 틀리면 빈 목록. */
export function readJobResponse(response: unknown): JobResponseData {
  const parse = firstParseOutput(response);
  return {
    extractItems: extractItemsFromResponse(response),
    parse: highlightsOf(parse),
    parseElements: elementItemsOf(parse),
    parseStepId: parse?.stepId ?? null,
    instructOutputs: instructOutputsFromResponse(response),
    validateRules: validateRulesFromResponse(response),
    stepOrder: stepOrderFromResponse(response),
  };
}

/**
 * 병합 페이지 기준 Parse 하이라이트를 파일별·파일 로컬 페이지별로 나눈다.
 * 결과는 `{ [file_ref]: 하이라이트[로컬 page - 1][] }` 이고 `page` 는 파일 로컬 1-based, id 도
 * `p{로컬 page}-{elementId}` 로 다시 조립한다(파일 하이라이트 API 와 같은 id).
 * 공간을 모르거나(`null`) 공간 밖 페이지는 버린다.
 */
export function parseHighlightsByFile(
  parse: readonly HighlightLike[],
  space: PageSpace | null,
): Record<string, HighlightLike[][]> {
  const out: Record<string, HighlightLike[][]> = {};
  if (!space) return out;
  for (const highlight of parse) {
    const ref = mergedToLocal(space, highlight.page);
    if (!ref) continue;
    const pages = (out[ref.file_ref] ??= []);
    while (pages.length < ref.page) pages.push([]);
    const mergedKey = parseElementKey(highlight.page, "");
    const id = highlight.id.startsWith(mergedKey)
      ? parseElementKey(ref.page, highlight.id.slice(mergedKey.length))
      : highlight.id;
    pages[ref.page - 1]?.push({ ...highlight, id, page: ref.page });
  }
  return out;
}
