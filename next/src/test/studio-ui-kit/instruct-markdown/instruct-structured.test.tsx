import { render, screen } from "@testing-library/react";
import {
  InstructStructured,
  type InstructStructuredLabels,
} from "@/components/studio-ui-kit/instruct-markdown/instruct-structured";

const labels: InstructStructuredLabels = {
  nullValue: "(null)",
  emptyText: "(empty text)",
  emptyList: "(empty list)",
  emptyObject: "(empty object)",
};

class Big {
  constructor(readonly raw: string) {}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Big);

function setup(value: unknown, testId?: string) {
  const texts: string[] = [];
  const scalars: unknown[] = [];
  const records: unknown[] = [];
  const view = render(
    <InstructStructured
      value={value}
      renderText={text => {
        texts.push(text);
        return <span data-text="">{text}</span>;
      }}
      formatScalar={item => {
        scalars.push(item);
        return item instanceof Big ? item.raw : JSON.stringify(item);
      }}
      isRecord={(item): item is Record<string, unknown> => {
        records.push(item);
        return isRecord(item);
      }}
      labels={labels}
      testId={testId}
      className="extra"
      aria-label="structured"
    />,
  );
  return { ...view, texts, scalars, records };
}

describe("InstructStructured", () => {
  it("객체는 dt/dd, 배열은 번호 목록, 문자열은 renderText 로 그린다", () => {
    const { container, texts } = setup(
      { title: "제목", items: ["가", { k: 1 }] },
      "s",
    );
    const root = screen.getByTestId("s");
    expect(root.className).toBe("min-w-0 text-sm extra");
    expect(root.getAttribute("aria-label")).toBe("structured");
    expect(
      Array.from(container.querySelectorAll("dt")).map(dt => dt.textContent),
    ).toEqual(["title", "items", "k"]);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(texts).toEqual(["제목", "가"]);
  });

  it("isRecord 가 아니라고 한 객체는 formatScalar 로 그린다", () => {
    const big = new Big("12345678901234567890");
    const { scalars, records, container } = setup({ n: big, ok: true });
    expect(records).toContain(big);
    expect(scalars).toEqual([big, true]);
    expect(
      Array.from(container.querySelectorAll("dd")).map(dd => dd.textContent),
    ).toEqual(["12345678901234567890", "true"]);
  });

  it("빈 값은 labels 문구로 그린다", () => {
    const { container } = setup({ a: null, b: " ", c: [], d: {} });
    expect(
      Array.from(container.querySelectorAll("dd")).map(dd => dd.textContent),
    ).toEqual(["(null)", "(empty text)", "(empty list)", "(empty object)"]);
  });

  it("testId 가 없으면 testid 속성이 없다", () => {
    const { container } = setup("글자");
    expect(container.firstElementChild?.hasAttribute("data-testid")).toBe(
      false,
    );
  });
});
