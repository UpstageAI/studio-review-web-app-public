// 화면 표시용 값 서식. 문구는 만들지 않고 locale 서식만 적용한다.

/**
 * 시각 값을 locale 서식 문자열로 만든다. epoch 초·epoch 밀리초·ISO 문자열을 받는다.
 * 읽을 수 없으면 `null`. 시간대는 브라우저 기본값을 쓴다.
 */
export function formatDateTime(
  value: string | number | null | undefined,
  locale: string,
): string | null {
  const ms = toTimestamp(value);
  if (ms === null) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

// 10^12 미만의 숫자는 epoch 초로 본다(밀리초라면 1970 년 1 월 12 일 이전).
const EPOCH_MS_THRESHOLD = 1e12;

/**
 * 시각 값을 epoch 밀리초로 바꾼다. epoch 초·epoch 밀리초·ISO 문자열을 받고, 읽을 수 없으면 `null`.
 * 정렬처럼 시각을 숫자로 비교할 때 쓴다.
 */
export function toTimestamp(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  let ms: number;
  if (typeof value === "number") {
    ms = value < EPOCH_MS_THRESHOLD ? value * 1000 : value;
  } else if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    ms = n < EPOCH_MS_THRESHOLD ? n * 1000 : n;
  } else {
    ms = Date.parse(value);
  }
  if (!Number.isFinite(ms)) return null;
  return ms;
}

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/** 바이트 수를 locale 단위 서식(`1.5 MB`)으로. 음수·비유한 값은 `null`. */
export function formatBytes(
  bytes: number | null | undefined,
  locale: string,
): string | null {
  if (bytes === null || bytes === undefined) return null;
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: BYTE_UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/** 파일들의 페이지 수 합. 파일이 없거나 하나라도 페이지 수를 모르면 `null`. */
export function sumPages(
  files: readonly { num_pages?: number | null }[] | null | undefined,
): number | null {
  if (!files || files.length === 0) return null;
  let total = 0;
  for (const file of files) {
    if (typeof file.num_pages !== "number") return null;
    total += file.num_pages;
  }
  return total;
}
