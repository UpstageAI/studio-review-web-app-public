import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseJson } from "@/lib/review-model";
import { snapshotHtml } from "@/test/dom-snapshot";
import { InstructStructured } from "../instruct-structured";

const TEST_ID = "job-review-instruct-structured";

const LABELS = {
  nullValue: "(null)",
  emptyText: "(빈 글자)",
  emptyList: "(빈 목록)",
  emptyObject: "(빈 객체)",
};

/** 안전 범위를 넘는 정수(`12345678901234567890`)는 `ExactNumber` 로 원문 표기가 남는다. */
const VALUE = parseJson(
  JSON.stringify({
    summary: "요약 본문【†1】",
    items: [{ name: "볼트", qty: 2 }, "둘째 항목", ["안쪽", 3]],
    nested: { inner: { deep: "깊은 글자" }, flag: false },
  }).replace('"qty":2', '"qty":12345678901234567890'),
);

const EDGE_VALUE = parseJson(
  '{"none":null,"blank":"  ","list":[],"object":{},"count":0,"ok":true}',
);

function setup(value = VALUE) {
  const texts: string[] = [];
  const view = render(
    <InstructStructured
      value={value}
      renderText={text => {
        texts.push(text);
        return <span data-text="">{text}</span>;
      }}
      labels={LABELS}
    />,
  );
  return { ...view, texts };
}

describe("InstructStructured", () => {
  it("객체·배열·중첩·빈 값·숫자·불리언을 그린다", () => {
    setup();
    expect(snapshotHtml(screen.getByTestId(TEST_ID))).toMatchSnapshot();
  });

  it("빈 값은 labels 문구로, 숫자·불리언은 JSON 표기로 그린다", () => {
    setup(EDGE_VALUE);
    const values = Array.from(
      screen.getByTestId(TEST_ID).querySelectorAll("dd"),
    ).map(dd => dd.textContent);
    expect(values).toEqual([
      "(null)",
      "(빈 글자)",
      "(빈 목록)",
      "(빈 객체)",
      "0",
      "true",
    ]);
  });

  it("문자열만 renderText 로 그리고 인자는 원문 그대로다", () => {
    const { texts } = setup();
    expect(texts).toEqual([
      "요약 본문【†1】",
      "볼트",
      "둘째 항목",
      "안쪽",
      "깊은 글자",
    ]);
  });

  it("안전 범위를 넘는 정수는 원문 표기 그대로 보인다", () => {
    setup();
    expect(screen.getByTestId(TEST_ID).textContent).toContain(
      "12345678901234567890",
    );
  });

  it("빈 객체 하나면 그 문구만 보인다", () => {
    setup(parseJson("{}"));
    expect(screen.getByTestId(TEST_ID).textContent).toBe("(빈 객체)");
  });
});
