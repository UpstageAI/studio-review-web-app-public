import {
  isExactNumber,
  isJsonObject,
  jsonEquals,
  parseJson,
  type JsonValue,
} from "./json";
import { documentsOf, results } from "./layout";
import { flattenPages, pageKey } from "./pages";
import { contentLeaves, toPointer } from "./schema";
import { isExtractStepType } from "./step-names";
import type { PageRef, ReviewDocument, ReviewJob, Result } from "./types";
import {
  buildPageSpace,
  isOwnFileRef,
  mergedToLocal,
  viewerIndex,
  type PageSpace,
} from "./viewer";

export type Coordinate = { readonly x: number; readonly y: number };

type Primitive = string | number | boolean;

/**
 * Studio UI Kit image-viewer 의 `HighlightValueWithId` 와 같은 모양. 모델이
 * `components/studio-ui-kit` 를 import 하지 않도록 필요한 필드만 복제한다.
 */
export type HighlightLike = {
  readonly id: string;
  readonly _value: Primitive | Primitive[];
  /** 뷰어 페이지(1-based). */
  readonly page: number;
  readonly coordinates: Coordinate[];
  readonly color?: string;
  readonly document_id?: string;
};

/** Extract 응답 provenance 의 leaf — `{_value, page, coordinates, …}` 객체 하나. */
export type ExtractLeaf = {
  /** 항목 `content` 안 같은 위치의 JSON Pointer. */
  readonly pointer: string;
  /** 병합 페이지 번호(`MERGED_PAGE_BASE` 기준). */
  readonly page: number;
  readonly coordinates: readonly Coordinate[];
  readonly value: JsonValue;
};

function toFinite(value: JsonValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isExactNumber(value)) {
    const parsed = Number(value.raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCoordinates(value: JsonValue | undefined): Coordinate[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out: Coordinate[] = [];
  for (const point of value) {
    if (!isJsonObject(point)) return null;
    const x = toFinite(point.x);
    const y = toFinite(point.y);
    if (x === null || y === null) return null;
    out.push({ x, y });
  }
  return out;
}

/**
 * provenance 트리(`additional_values`)에서 `_value`·`page`·`coordinates`(3 점 이상)를
 * 가진 객체를 모은다. `_value` 가 있는 객체 아래로는 내려가지 않는다.
 */
export function collectExtractLeaves(
  additionalValues: JsonValue,
): ExtractLeaf[] {
  const out: ExtractLeaf[] = [];
  const walk = (node: JsonValue, path: string[]) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    if (!isJsonObject(node)) return;
    if (Object.hasOwn(node, "_value")) {
      const page = toFinite(node.page);
      const coordinates = readCoordinates(node.coordinates);
      if (page !== null && Number.isInteger(page) && coordinates) {
        out.push({
          pointer: toPointer(path),
          page,
          coordinates,
          value: node._value ?? null,
        });
      }
      return;
    }
    for (const key of Object.keys(node))
      walk(node[key] ?? null, [...path, key]);
  };
  walk(additionalValues, []);
  return out;
}

/** Job 응답 Extract 메시지의 결과 항목 하나(`output[].content[index]`). */
export type ExtractItem = {
  readonly stepId: string;
  /** 응답 `output[].id`(결과 id). */
  readonly outputId: string;
  /** `content[]` 안 위치. */
  readonly index: number;
  readonly content: JsonValue;
  readonly leaves: readonly ExtractLeaf[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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
 * Job 응답(`GET …/source-jobs/{jobId}/response` 본문)에서 Extract 항목을 꺼낸다.
 * `text` 는 항목 JSON 문자열, `additional_values` 는 JSON 문자열(또는 객체)이다.
 * 둘 다 숫자 보존 파서로 읽는다. 읽을 수 없는 항목은 건너뛴다.
 */
export function extractItemsFromResponse(response: unknown): ExtractItem[] {
  const output = asRecord(response)?.output;
  if (!Array.isArray(output)) return [];
  const out: ExtractItem[] = [];
  for (const raw of output) {
    const message = asRecord(raw);
    if (!message || !isExtractStepType(message.step_type)) continue;
    const stepId = message.step_id;
    const outputId = message.id;
    if (typeof stepId !== "string" || !Array.isArray(message.content)) continue;
    message.content.forEach((rawItem, index) => {
      const item = asRecord(rawItem);
      const content = readJsonish(item?.text);
      if (content === undefined) return;
      const provenance = readJsonish(item?.additional_values);
      out.push({
        stepId,
        outputId: typeof outputId === "string" ? outputId : "",
        index,
        content,
        leaves:
          provenance === undefined ? [] : collectExtractLeaves(provenance),
      });
    });
  }
  return out;
}

function resultPageKeys(job: ReviewJob, result: Result): Set<string> {
  const keys = new Set<string>();
  if (result.link.kind !== "documents") return keys;
  const linked = new Set(result.link.document_ids);
  for (const { document } of documentsOf(job)) {
    if (!linked.has(document.document_id)) continue;
    try {
      for (const page of flattenPages(document)) keys.add(pageKey(page));
    } catch {
      // 범위가 잘못된 문서는 페이지 판정에 쓰지 않는다.
    }
  }
  return keys;
}

function fitsPages(
  item: ExtractItem,
  space: PageSpace | null,
  keys: ReadonlySet<string>,
): boolean {
  if (!space) return false;
  return item.leaves.every(leaf => {
    const ref = mergedToLocal(space, leaf.page);
    return ref !== null && keys.has(pageKey(ref));
  });
}

/**
 * v11 Extract 결과 ↔ Job 응답 항목 짝짓기. 응답 항목에는 v11 결과 id 가 없지만 메시지
 * `id` 가 결과 id 와 같을 때가 있다.
 * 1) 같은 Step 의 항목 중 `content` 가 의미 동치인 것(메시지 id 가 결과 id 와 같은 항목을
 * 먼저), 2) 둘 이상이고 id 로 정하지 못하면 좌표 페이지가
 * 결과의 연결 문서 페이지 안에 드는 것, 3) 그래도 둘 이상이면 응답 순서대로 아직
 * 안 쓴 첫 항목. 동치 항목이 없고 결과가 목록이면 원소별로 나뉜 항목을 합친다
 * (`splitItemsFor`). 다른 Job 에서 복사된 결과(`source.job_id` 가 다름)는 좌표 공간이
 * 달라 짝짓지 않는다. 짝이 없으면 결과 id 가 Map 에 없다.
 */
export function pairExtractItems(
  doc: ReviewDocument,
  job: ReviewJob,
  items: readonly ExtractItem[],
  space: PageSpace | null = buildPageSpace(job),
): Map<string, ExtractItem> {
  const paired = new Map<string, ExtractItem>();
  const used = new Set<ExtractItem>();
  for (const result of results(job)) {
    const step = Object.hasOwn(doc.steps, result.step_id)
      ? doc.steps[result.step_id]
      : undefined;
    if (!isExtractStepType(step?.type)) continue;
    if (result.source && result.source.job_id !== job.id) continue;
    const candidates = items.filter(
      item =>
        !used.has(item) &&
        item.stepId === result.step_id &&
        jsonEquals(item.content, result.content),
    );
    // 응답 메시지 id 가 결과 id(occurrence)와 같으면 그것을 먼저 고른다.
    let chosen =
      candidates.find(item => item.outputId === result.id) ?? candidates[0];
    if (candidates.length > 1 && chosen?.outputId !== result.id) {
      const keys = resultPageKeys(job, result);
      chosen = candidates.find(item => fitsPages(item, space, keys)) ?? chosen;
    }
    if (chosen) {
      used.add(chosen);
      paired.set(result.id, chosen);
      continue;
    }
    const split = splitItemsFor(result, items, used);
    if (split) {
      for (const item of split.parts) used.add(item);
      paired.set(result.id, split.combined);
    }
  }
  return paired;
}

/**
 * 목록 결과는 응답에서 원소마다 항목 하나로 나뉘어 온다(결과 `[a, b]` ↔ 항목 `a`·`b`).
 * 같은 Step·같은 메시지의 항목이 순서대로 결과 원소와 동치면 하나로 합친다
 * (leaf 경로 앞에 원소 index 를 붙인다). 결과 id 와 같은 메시지를 먼저 본다.
 */
function splitItemsFor(
  result: Result,
  items: readonly ExtractItem[],
  used: ReadonlySet<ExtractItem>,
): { combined: ExtractItem; parts: readonly ExtractItem[] } | null {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const groups = new Map<string, ExtractItem[]>();
  for (const item of items) {
    if (used.has(item) || item.stepId !== result.step_id) continue;
    const group = groups.get(item.outputId);
    if (group) group.push(item);
    else groups.set(item.outputId, [item]);
  }
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => Number(b === result.id) - Number(a === result.id),
  );
  for (const [, group] of ordered) {
    const parts = [...group].sort((a, b) => a.index - b.index);
    if (parts.length !== content.length) continue;
    if (!parts.every((item, i) => jsonEquals(item.content, content[i]))) {
      continue;
    }
    const first = parts[0] as ExtractItem;
    return {
      parts,
      combined: {
        stepId: first.stepId,
        outputId: first.outputId,
        index: first.index,
        content,
        leaves: parts.flatMap((item, i) =>
          item.leaves.map(leaf => ({
            ...leaf,
            pointer: `/${i}${leaf.pointer}`,
          })),
        ),
      },
    };
  }
  return null;
}

export type PairedHighlight = HighlightLike & {
  /** `${resultId}#${pointer}`. */
  readonly id: string;
  readonly pointer: string;
  /** 현재 문서 안 뷰어 위치(0-based). `page` 는 이 값 + 1. */
  readonly viewerIndex: number;
  /** 결과의 현재 값(편집 반영). */
  readonly value: JsonValue;
};

function primitive(value: JsonValue): Primitive {
  if (isExactNumber(value)) return value.raw;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return "";
}

/**
 * 결과의 leaf 마다 짝 항목의 좌표를 현재 문서의 뷰어 페이지로 옮긴다. 경로는
 * JSON Pointer 일치로 찾고(항목 하나짜리 배열 결과는 `/0` 을 뗀 경로도 본다), 현재 문서에 없는 페이지·다른 Job 의 파일·공간을
 * 모를 때(`space` null)는 내지 않는다.
 */
export function pairHighlights(
  jobId: string,
  result: Result,
  item: ExtractItem,
  space: PageSpace | null,
  docPages: readonly PageRef[],
): PairedHighlight[] {
  if (!space) return [];
  const byPointer = new Map(item.leaves.map(leaf => [leaf.pointer, leaf]));
  // 결과가 항목 하나짜리 배열이면 provenance 가 배열 없이 그 항목만 담을 때가 있다
  // (`[{a}]` ↔ `{a: {_value…}}`). 그때는 `/0` 을 떼고 찾는다.
  const singleWrapped =
    Array.isArray(result.content) && result.content.length === 1;
  const out: PairedHighlight[] = [];
  for (const { path, value } of contentLeaves(result.content)) {
    const pointer = toPointer(path);
    const leaf =
      byPointer.get(pointer) ??
      (singleWrapped && path[0] === "0"
        ? byPointer.get(toPointer(path.slice(1)))
        : undefined);
    if (!leaf) continue;
    const ref = mergedToLocal(space, leaf.page);
    if (!ref || !isOwnFileRef(jobId, ref.file_ref)) continue;
    const index = viewerIndex(docPages, ref);
    if (index < 0) continue;
    out.push({
      id: `${result.id}#${pointer}`,
      pointer,
      viewerIndex: index,
      page: index + 1,
      coordinates: leaf.coordinates.map(point => ({ x: point.x, y: point.y })),
      _value: primitive(value),
      value,
    });
  }
  return out;
}
