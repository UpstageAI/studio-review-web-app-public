import type { Coordinate, HighlightLike } from "@/lib/review-model";

// Parse 요소 → 문서 뷰어 하이라이트 변환. 파일 응답(BFF 서버)과 Job 응답(브라우저)이 함께 쓴다.
// 요소를 읽는 방어 코드는 Studio UI Kit image-viewer 문서의 "Pipeline API 파일 응답으로 쓰기" 예제를 따른다.

/** Parse 하이라이트 `_value` 최대 길이(코드 포인트). 뷰어는 값을 그리지 않으므로 식별용으로만 남긴다. */
export const HIGHLIGHT_VALUE_MAX_LENGTH = 120;

/** Parse 요소 종류별 하이라이트 색. 앱 테마의 차트 색 토큰을 CSS 변수로 넘긴다. */
export const PARSE_CATEGORY_COLORS = {
  table: "var(--chart-1)",
  figure: "var(--chart-2)",
  heading: "var(--chart-3)",
  paragraph: "var(--chart-4)",
  other: "var(--chart-5)",
} as const;

export type ParseElement = {
  id?: unknown;
  page?: unknown;
  category?: unknown;
  content?: unknown;
  coordinates?: unknown;
  /** 그림 요소의 이미지(base64). Parse Step 이 `base64_encoding` 으로 요청한 종류에만 있다. */
  base64_encoding?: unknown;
  /** Job 응답 BFF 가 `base64_encoding` 을 떼어 두고 대신 넣은 같은 origin 의 그림 경로. */
  figure_url?: unknown;
};

/**
 * `<img src>` 로 써도 되는 `figure_url` 의 모양 — 이 앱의 figures BFF 경로만. Job 응답 본문의 다른 값은
 * upstream 이 보낸 것일 수 있으므로 패턴에 맞지 않으면 쓰지 않는다. 서버의 `figureUrl` 과 짝.
 */
export const FIGURE_URL_PATTERN =
  /^\/api\/search-collections\/[\w-]{1,128}\/source-jobs\/[\w-]{1,128}\/figures\/f\d{1,6}$/;

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** 요소 종류 → 하이라이트 색. */
export function categoryColor(category: unknown): string {
  if (typeof category !== "string") return PARSE_CATEGORY_COLORS.other;
  const name = category.toLowerCase();
  if (name === "table") return PARSE_CATEGORY_COLORS.table;
  if (name === "figure" || name === "chart" || name === "image") {
    return PARSE_CATEGORY_COLORS.figure;
  }
  if (name.startsWith("heading") || name === "title") {
    return PARSE_CATEGORY_COLORS.heading;
  }
  if (name === "paragraph" || name === "list") {
    return PARSE_CATEGORY_COLORS.paragraph;
  }
  return PARSE_CATEGORY_COLORS.other;
}

/** 파싱 결과 JSON 에서 요소 배열을 찾는다(배열 자체, `elements`, `content.elements`, `data`). */
export function elementsOf(payload: unknown): ParseElement[] {
  const root = record(payload);
  const list = [
    payload,
    root.elements,
    record(root.content).elements,
    root.data,
  ].find(Array.isArray);
  return (list ?? []) as ParseElement[];
}

/** 점이 셋 이상이고 모두 유한한 숫자인 좌표만. 아니면 `null`. */
export function readCoordinates(value: unknown): Coordinate[] | null {
  if (!Array.isArray(value)) return null;
  const out: Coordinate[] = [];
  for (const point of value) {
    const { x, y } = record(point);
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push({ x, y });
  }
  return out.length >= 3 ? out : null;
}

function truncate(text: string): string {
  const chars = Array.from(text);
  return chars.length > HIGHLIGHT_VALUE_MAX_LENGTH
    ? `${chars.slice(0, HIGHLIGHT_VALUE_MAX_LENGTH - 1).join("")}…`
    : text;
}

/**
 * markdown 이미지 표기와 그 뒤의 공백·줄바꿈. Document Parse 는 그림 자리에 `![image](/image/placeholder)`
 * 를 넣는데 `markdown` 뿐 아니라 `text` 에도 들어 있다(그림 요소, 표 셀 안의 그림). 글자가 아니므로 뺀다.
 */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)\s*/g;

function withoutImages(value: string): string {
  return value.replace(MARKDOWN_IMAGE, "").trim();
}

/**
 * 요소 본문: `text`, 없으면 `markdown`, 없으면 `html` 의 태그를 지운 글자. 이미지 표기는 어디에 있든 뺀다.
 * Studio 의 Parse 결과 Text 보기와 같이 `text` 를 먼저 쓴다.
 */
export function elementText(content: unknown): string {
  const { text, markdown, html } = record(content);
  if (typeof text === "string") {
    const rest = withoutImages(text);
    if (rest) return rest;
  }
  if (typeof markdown === "string") {
    const rest = withoutImages(markdown);
    if (rest) return rest;
  }
  if (typeof html === "string") {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

/** 표로 그릴 `content.html` 의 최대 길이(UTF-16 단위). 넘으면 표로 그리지 않고 글자로 둔다(렌더 비용 상한). */
export const PARSE_TABLE_HTML_MAX_LENGTH = 200_000;

/**
 * 표 요소(`category === "table"`)의 `content.html` 원문. 비어 있거나 길이 상한을 넘거나 표가 아니면 `null`.
 * 원문을 그대로 돌려주며, 그릴 때는 허용 목록 변환기를 거친다.
 */
export function elementTableHtml(element: ParseElement): string | null {
  if (element.category !== "table") return null;
  const { html } = record(element.content);
  if (typeof html !== "string" || html === "") return null;
  return html.length > PARSE_TABLE_HTML_MAX_LENGTH ? null : html;
}

/** base64 앞머리로 이미지 종류를 가린다. 모르면 Studio 와 같이 JPEG 로 본다. */
function imageMimeType(base64: string): string {
  if (base64.startsWith("iVBOR")) return "image/png";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}

/**
 * 요소의 그림을 `<img src>` 에 바로 쓸 URL 로. BFF 가 넣은 `figure_url`(패턴에 맞을 때만)을 먼저 쓰고,
 * 없으면 응답에 남은 `base64_encoding` 을 data URL 로(파일 응답 등 BFF 를 거치지 않은 요소). 둘 다 없으면 `null`.
 * Studio 의 Parse 결과 미리보기가 figure 를 그리는 방식과 같다.
 */
export function elementImage(element: ParseElement): string | null {
  const { figure_url: figureUrl, base64_encoding: base64 } = element;
  if (typeof figureUrl === "string" && FIGURE_URL_PATTERN.test(figureUrl)) {
    return figureUrl;
  }
  if (typeof base64 !== "string" || base64 === "") return null;
  return `data:${imageMimeType(base64)};base64,${base64}`;
}

/** 요소 id(숫자·문자열). 없으면 같은 페이지 안 순번. */
export function elementId(element: ParseElement, index: number): string {
  const { id } = element;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof id === "string" && id !== "") return id;
  return String(index);
}

/**
 * 페이지 안 요소 키 `p{page}-{elementId}`. 화면 Parse id(`parse:{file_ref}:{키}`)의 뒷부분이며
 * 파일 하이라이트 API 는 `page` 에 파일 로컬 번호를 넣는다.
 */
export function parseElementKey(page: number, id: string): string {
  return `p${page}-${id}`;
}

/**
 * 요소 배열 → 뷰어 하이라이트. 점이 셋 미만이거나 숫자가 아닌 좌표는 뺀다.
 * `page` 는 넘긴 값 그대로(1-based), id 는 `parseElementKey(page, elementId)`.
 */
export function toHighlights(
  elements: readonly ParseElement[],
  page: number,
): HighlightLike[] {
  return elements.flatMap((element, index) => {
    const coordinates = readCoordinates(element.coordinates);
    if (!coordinates) return [];
    return [
      {
        id: parseElementKey(page, elementId(element, index)),
        _value: truncate(elementText(element.content)),
        page,
        coordinates,
        color: categoryColor(element.category),
      },
    ];
  });
}
