import {
  DEFAULT_MAX_JSON_BYTES,
  serializeReviewDocument,
  stringifyJson,
  type ReviewDocument,
} from "@/lib/review-model";

// 전체 JSON 다운로드·파일 읽기(브라우저 전용).

/** 텍스트를 파일로 내려받는다. Blob URL 은 클릭을 넘긴 뒤 바로 해제한다. */
export function downloadText(
  name: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${type};charset=utf-8` }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // 같은 task 안에서 해제하면 일부 브라우저가 다운로드를 시작하지 못한다.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** `review-{jobId}-original.json`·`review-{jobId}-edited.json`. 파일명에 못 쓰는 글자는 `_`. */
export function reviewFileName(
  jobId: string,
  kind: "original" | "edited",
): string {
  const safe = jobId.replace(/[^A-Za-z0-9._-]/g, "_") || "job";
  return `review-${safe}-${kind}.json`;
}

/** 편집본을 다운로드·편집용 JSON 텍스트(들여쓰기)로. */
export function editedText(doc: ReviewDocument): string {
  return stringifyJson(serializeReviewDocument(doc), { pretty: true });
}

/** 열 수 있는 JSON 파일 크기 상한(`parseJson` 기본 상한과 같다). */
export const MAX_JSON_FILE_BYTES = DEFAULT_MAX_JSON_BYTES;

/** 이 크기를 넘으면 편집이 느릴 수 있다고 알린다. */
export const LARGE_JSON_BYTES = 2 * 1024 * 1024;

export type JsonFileRead =
  | { ok: true; name: string; text: string }
  | { ok: false; reason: "too_large" | "unreadable" };

/** 고른 파일을 텍스트로 읽는다. 상한을 넘으면 읽지 않는다. */
export async function readJsonFile(file: File): Promise<JsonFileRead> {
  if (file.size > MAX_JSON_FILE_BYTES)
    return { ok: false, reason: "too_large" };
  try {
    return { ok: true, name: file.name, text: await file.text() };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
