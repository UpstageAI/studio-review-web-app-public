import "server-only";

// Job 응답 본문에서 Parse 그림 요소의 `base64_encoding` 을 떼어 내고 그 자리에 `figure_url` 을 넣는다.
// 본문은 `JSON.parse` 하지 않는다 — 큰 정수 등 숫자 토큰을 바이트 그대로 브라우저에 넘겨야 하므로
// 정규식으로 `"base64_encoding":"…"` 쌍만 바꾼다. Parse 출력은 보통 message `text` 안의 JSON 문자열이라
// 따옴표가 `\"` 로 이스케이프돼 있고, 그 형태(앞뒤 백슬래시)를 그대로 보존한다.

/** Job 응답 본문 상한. 넘으면 읽지 않고 502 `response_too_large`. */
export const JOB_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;

/** 그림 키(`f1` …). 라우트 param 과 `figure_url` 의 마지막 조각이 이 모양이어야 한다. */
export const FIGURE_KEY_PATTERN = /^f\d{1,6}$/;

const FIGURE_KEY_MAX = 999_999;

/**
 * `"base64_encoding":"<base64>"` 쌍. 그룹 1 이 `\` 이면 JSON 문자열 안의 JSON(Parse `text`) 형태이고
 * 비어 있으면 객체 형태다. 그룹 2 는 키와 값 사이(공백 포함), 그룹 3 은 base64 값(이스케이프된 `\/` 의
 * 백슬래시 포함). 값은 base64 문자 집합만 받으므로 다른 글자가 섞인 값은 바뀌지 않고 남는다
 * (브라우저가 기존처럼 data URL 로 그린다).
 */
export const FIGURE_PAIR =
  /(\\?)"base64_encoding\1"(\s*:\s*)\1"([A-Za-z0-9+/=\\]*)\1"/g;

export type ExtractedFigure = {
  key: string;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
};

export type ExtractFiguresResult = {
  /** `base64_encoding` 이 `figure_url` 로 바뀐 본문. 바꾼 것이 없으면 입력 그대로. */
  text: string;
  /** 떼어 낸 그림(등장 순서, 키 `f1` 부터). */
  figures: ExtractedFigure[];
};

/** 브라우저가 그림을 받을 BFF 경로. `lib/review-api/parse-highlights.ts` 의 `FIGURE_URL_PATTERN` 과 짝. */
export function figureUrl(
  collectionId: string,
  jobId: string,
  figureKey: string,
): string {
  return `/api/search-collections/${encodeURIComponent(collectionId)}/source-jobs/${encodeURIComponent(jobId)}/figures/${figureKey}`;
}

/** 이미지 바이트 앞머리로 종류를 가린다. 모르면 Studio 와 같이 JPEG 로 본다. */
export function sniffImageType(bytes: Uint8Array): string {
  const at = (index: number) => bytes[index];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return "image/png";
  }
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) {
    return "image/gif";
  }
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

/** base64 → 바이트. Buffer 풀을 공유하지 않도록 새 ArrayBuffer 로 복사한다. 비면 길이 0. */
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, "base64");
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  return bytes;
}

/**
 * 본문의 `base64_encoding` 값을 모두 떼어 `figure_url` 로 바꾼다. 빈 값·디코드 결과가 0 바이트인 값은
 * 그대로 둔다. 같은 본문을 다시 돌리면 같은 순서로 같은 키가 나온다.
 */
export function extractFigures(
  text: string,
  ids: { collectionId: string; jobId: string },
): ExtractFiguresResult {
  const figures: ExtractedFigure[] = [];
  const replaced = text.replace(
    FIGURE_PAIR,
    (match, escape: string, separator: string, encoded: string) => {
      const base64 = encoded.replaceAll("\\", "");
      if (base64 === "" || figures.length >= FIGURE_KEY_MAX) return match;
      const bytes = decodeBase64(base64);
      if (bytes.byteLength === 0) return match;
      const key = `f${figures.length + 1}`;
      figures.push({ key, bytes, contentType: sniffImageType(bytes) });
      const url = figureUrl(ids.collectionId, ids.jobId, key);
      return `${escape}"figure_url${escape}"${separator}${escape}"${url}${escape}"`;
    },
  );
  return { text: figures.length === 0 ? text : replaced, figures };
}
