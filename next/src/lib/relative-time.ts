// 지난 시각을 "5분 전", "어제" 같은 locale 상대 서식으로 만든다. 문구는 만들지 않고 `Intl` 서식만 쓴다.

import { toTimestamp } from "./format";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 상대 서식으로 보이는 기간. 이보다 오래되면 날짜로 보인다. */
const RELATIVE_LIMIT = 7 * DAY;

/**
 * `value` 가 `now` 보다 얼마 전인지 locale 상대 서식으로. 1 분 안(또는 시계 차이로 미래)은 "지금", 7 일
 * 안은 분, 시간, 일 단위, 그보다 오래되면 날짜(`dateStyle: medium`). 읽을 수 없으면 `null`.
 */
export function formatRelativeTime(
  value: string | number | null | undefined,
  locale: string,
  now: number,
): string | null {
  const ms = toTimestamp(value);
  if (ms === null) return null;
  const elapsed = Math.max(0, now - ms);
  if (elapsed >= RELATIVE_LIMIT) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(ms),
    );
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < MINUTE) return rtf.format(0, "second");
  if (elapsed < HOUR)
    return rtf.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return rtf.format(-Math.floor(elapsed / HOUR), "hour");
  return rtf.format(-Math.floor(elapsed / DAY), "day");
}
