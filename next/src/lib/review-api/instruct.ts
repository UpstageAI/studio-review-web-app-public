import {
  isJsonObject,
  parseJson,
  type Coordinate,
  type JsonObject,
  type JsonValue,
  type PageRange,
} from "@/lib/review-model";
import { readCoordinates, record } from "./parse-highlights";

// Job 응답의 Instruct Step 출력(`output[]` message) 읽기. 화면은 보기만 한다(수정 불가).
// - `content[i].text`: 본문을 JSON 으로 직렬화한 값. markdown 본문(인용 표식 `【†n】`)이면 JSON 문자열
//   (`"## …\n…"`), `response_format` 이 있으면 JSON 객체 문자열. 직렬화하지 않은 평문도 받는다.
// - `content[i].additional_values`: JSON 문자열(또는 객체). `enum`(결정), `citations[]`, `page_ranges`(병합 페이지).
// `content[]` 항목 하나가 문서(페이지 범위) 하나의 출력이다.

/** Instruct 출력을 내는 Step 종류. */
export const INSTRUCT_STEP_TYPES: readonly string[] = [
  "instruct",
  "instruct-generate",
];

export function isInstructStepType(stepType: unknown): boolean {
  return typeof stepType === "string" && INSTRUCT_STEP_TYPES.includes(stepType);
}

/** 인용 하나. `page` 는 병합 페이지(1-based), 좌표는 그 페이지 기준 0~1. */
export type InstructCitation = {
  index: number;
  /** `"parse"`(Parse 요소) · `"extract"`(추출값) 등. 모르면 `null`. */
  sourceType: string | null;
  /** 출처 식별자. Parse 인용이면 Parse 요소 id. */
  sourceRef: string | null;
  page: number | null;
  coordinates: Coordinate[] | null;
};

export type InstructOutput = {
  stepId: string;
  /** 응답 `model`(Step 이름). 화면은 검수 문서 `steps[id].name` 을 먼저 쓴다. */
  stepName: string;
  /** 같은 Step 출력 안 순번(응답 순서, 0-based). */
  index: number;
  /** markdown 본문. 응답 `text` 가 JSON 문자열이면 푼 값, 아니면 원문. */
  text: string;
  /** 응답 `text` 가 JSON 객체·배열 문자열이면 그 값(숫자 보존). 아니면 `null`(markdown). */
  json: JsonValue | null;
  /** `additional_values.enum` 이 문자열일 때 그 결정(빈 문자열 = 미분류). */
  enumDecision: string | null;
  citations: InstructCitation[];
  /** 이 출력이 읽은 병합 페이지 범위. 없으면 빈 목록. */
  pageRanges: PageRange[];
  /** 원본 보기용 `additional_values`(인용·`previous_step_name` 은 뺀다). 남는 게 없으면 `null`. */
  extra: JsonObject | null;
};

function readJsonish(value: unknown): JsonValue | undefined {
  if (typeof value === "string") {
    try {
      return parseJson(value);
    } catch {
      return undefined;
    }
  }
  return value === undefined ? undefined : (value as JsonValue);
}

/**
 * 응답 `text` 를 본문으로 푼다(Studio 와 같은 규칙). JSON 문자열(`"…"`)이면 푼 문자열이 markdown 본문이고,
 * JSON 객체·배열이면 `response_format` 출력(`json`). 파싱이 안 되거나 숫자·boolean 같은 단일 값이면
 * 원문을 그대로 본문으로 본다.
 */
function readText(raw: string): { text: string; json: JsonValue | null } {
  const head = raw.trimStart()[0];
  if (head !== '"' && head !== "{" && head !== "[") {
    return { text: raw, json: null };
  }
  try {
    const value = parseJson(raw);
    if (typeof value === "string") return { text: value, json: null };
    if (typeof value === "object" && value !== null) {
      return { text: raw, json: value };
    }
  } catch {
    // JSON 이 아닌 평문(따옴표로 시작하는 문장 등)은 그대로 본문이다.
  }
  return { text: raw, json: null };
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function readCitations(value: unknown): InstructCitation[] {
  if (!Array.isArray(value)) return [];
  const out: InstructCitation[] = [];
  for (const raw of value) {
    const item = record(raw);
    const index = readNumber(item.index);
    if (index === null || !Number.isInteger(index)) continue;
    const page = readNumber(item.page);
    const sourceRef = item.source_ref;
    out.push({
      index,
      sourceType:
        typeof item.source_type === "string" ? item.source_type : null,
      sourceRef:
        typeof sourceRef === "string"
          ? sourceRef
          : typeof sourceRef === "number" && Number.isFinite(sourceRef)
            ? String(sourceRef)
            : null,
      page: isPositiveInteger(page) ? page : null,
      coordinates: readCoordinates(item.coordinates),
    });
  }
  return out;
}

function readPageRanges(value: unknown): PageRange[] {
  if (!Array.isArray(value)) return [];
  const out: PageRange[] = [];
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 2) continue;
    const [first, last] = range as unknown[];
    if (!isPositiveInteger(first) || !isPositiveInteger(last)) continue;
    if (first > last) continue;
    out.push([first, last]);
  }
  return out;
}

const HIDDEN_EXTRA_KEYS = ["citations", "previous_step_name"];

function readExtra(value: JsonValue | undefined): JsonObject | null {
  if (!isJsonObject(value)) return null;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN_EXTRA_KEYS.includes(key)) continue;
    out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Instruct Step message 하나 → `content[]` 항목마다 출력 하나. Instruct 가 아니거나 모양이
 * 틀리면 빈 목록. `index` 는 이 message 안 순번이다(같은 Step 의 여러 message 는 호출하는 쪽이 잇는다).
 */
export function readInstructOutput(message: unknown): InstructOutput[] {
  const row = record(message);
  if (!isInstructStepType(row.step_type)) return [];
  if (typeof row.step_id !== "string" || !Array.isArray(row.content)) {
    return [];
  }
  const stepId = row.step_id;
  const stepName = typeof row.model === "string" ? row.model : "";
  const out: InstructOutput[] = [];
  for (const raw of row.content) {
    const item = record(raw);
    const { text, json } = readText(
      typeof item.text === "string" ? item.text : "",
    );
    const additional = readJsonish(item.additional_values);
    const values = isJsonObject(additional) ? additional : {};
    out.push({
      stepId,
      stepName,
      index: out.length,
      text,
      json,
      enumDecision: typeof values.enum === "string" ? values.enum : null,
      citations: readCitations(values.citations),
      pageRanges: readPageRanges(values.page_ranges),
      extra: readExtra(additional),
    });
  }
  return out;
}
