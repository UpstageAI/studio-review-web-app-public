import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../relative-time";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("읽을 수 없으면 null", () => {
    expect(formatRelativeTime(null, "en", NOW)).toBeNull();
    expect(formatRelativeTime("nope", "en", NOW)).toBeNull();
  });

  it("1 분 안과 미래(시계 차이)는 지금", () => {
    expect(formatRelativeTime(ago(30_000), "en", NOW)).toBe("now");
    expect(formatRelativeTime(ago(-5 * MINUTE), "en", NOW)).toBe("now");
  });

  it("분, 시간, 일 단위로 나눈다", () => {
    expect(formatRelativeTime(ago(5 * MINUTE), "en", NOW)).toBe(
      "5 minutes ago",
    );
    expect(formatRelativeTime(ago(3 * HOUR + 10 * MINUTE), "en", NOW)).toBe(
      "3 hours ago",
    );
    expect(formatRelativeTime(ago(DAY + HOUR), "en", NOW)).toBe("yesterday");
    expect(formatRelativeTime(ago(3 * DAY), "en", NOW)).toBe("3 days ago");
  });

  it("locale 서식을 쓴다", () => {
    expect(formatRelativeTime(ago(5 * MINUTE), "ko", NOW)).toBe("5분 전");
    expect(formatRelativeTime(ago(DAY + HOUR), "ko", NOW)).toBe("어제");
  });

  it("7 일 넘게 지나면 날짜로 보인다", () => {
    const value = ago(10 * DAY);
    expect(formatRelativeTime(value, "en", NOW)).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
        new Date(value),
      ),
    );
  });

  it("epoch 초도 받는다", () => {
    expect(formatRelativeTime((NOW - 2 * HOUR) / 1000, "en", NOW)).toBe(
      "2 hours ago",
    );
  });
});
