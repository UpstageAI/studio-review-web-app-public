import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { snapshotHtml } from "@/test/dom-snapshot";
import {
  InstructCitationContext,
  type InstructCitationValue,
} from "../instruct-citation-context";
import { InstructMarkdown } from "../instruct-markdown";

const CHIP = "job-review-instruct-citation";

const TEXT = [
  "## 요약",
  "첫 문장입니다.【†1】",
  "둘째 줄은 `코드` 와 [외부 링크](https://example.com/a) 를 담습니다.[†2]",
  "",
  "| 항목 | 값 |",
  "| --- | --- |",
  "| 합계 | 100 |",
  "",
  "![도장](https://example.com/stamp.png)",
].join("\n");

interface Calls {
  citations: number[];
  hovers: (number | null)[];
}

/** 인용 3 은 위치가 없다(누를 수 없음). */
function citationValue(
  calls: Calls,
  selected: number | null,
): InstructCitationValue {
  return {
    citationState: index => ({
      disabled: index === 3,
      selected: index === selected,
    }),
    onCitation: index => calls.citations.push(index),
    onCitationHover: index => calls.hovers.push(index),
    labels: {
      citation: index => `인용 ${index}`,
      noLocation: "위치 없음",
      image: alt => `그림: ${alt}`,
    },
  };
}

function setup(text = TEXT, selected: number | null = null) {
  const calls: Calls = { citations: [], hovers: [] };
  const element = (value: InstructCitationValue) => (
    <TooltipProvider delayDuration={200}>
      <InstructCitationContext value={value}>
        <InstructMarkdown text={text} />
      </InstructCitationContext>
    </TooltipProvider>
  );
  const view = render(element(citationValue(calls, selected)));
  return {
    ...view,
    calls,
    select: (next: number | null) =>
      view.rerender(element(citationValue(calls, next))),
  };
}

const chips = () => screen.getAllByTestId(CHIP);
const chip = (index: number) =>
  chips().find(
    element => element.getAttribute("data-citation") === String(index),
  )!;
const root = (container: HTMLElement) => container.firstElementChild;

describe("InstructMarkdown", () => {
  // 본문은 지연 로드라 첫 렌더는 fallback 이다. 모듈 로드를 한 번 끝내 두면 이후 렌더는 동기로 본문을 그린다.
  beforeAll(async () => {
    const { unmount } = setup();
    await screen.findAllByTestId(CHIP);
    unmount();
  });

  it("인용 표식 두 형식·GFM 표·줄바꿈·코드·외부 링크·이미지를 그린다", () => {
    const { container } = setup();
    expect(snapshotHtml(root(container))).toMatchSnapshot();
  });

  it("선택된 칩과 위치 없는 칩을 그린다", () => {
    const { container } = setup("가【†1】 나【†2】 다【†3】", 2);
    expect(snapshotHtml(root(container))).toMatchSnapshot();
  });

  it("두 형식의 인용 표식이 모두 칩이 된다", () => {
    setup();
    expect(chips().map(element => element.textContent)).toEqual(["1", "2"]);
    expect(screen.queryByText(/†/)).toBeNull();
  });

  it("칩 속성: data-citation·data-selected·aria-pressed·aria-label", () => {
    setup("가【†1】 나【†2】 다【†3】", 2);
    expect(chip(1).getAttribute("aria-pressed")).toBe("false");
    expect(chip(1).hasAttribute("data-selected")).toBe(false);
    expect(chip(2).getAttribute("aria-pressed")).toBe("true");
    expect(chip(2).getAttribute("data-selected")).toBe("true");
    expect(chip(2).getAttribute("aria-label")).toBe("인용 2");
    expect(chip(3).getAttribute("aria-disabled")).toBe("true");
    expect(chip(3).hasAttribute("aria-pressed")).toBe(false);
    expect(chip(3).hasAttribute("data-selected")).toBe(false);
  });

  it("칩을 누르면 onCitation(index)", () => {
    const { calls } = setup();
    fireEvent.click(chip(2));
    expect(calls.citations).toEqual([2]);
  });

  it("위치 없는 칩은 눌러도·가리켜도 부르지 않는다", () => {
    const { calls } = setup("다【†3】", 3);
    fireEvent.click(chip(3));
    fireEvent.mouseEnter(chip(3));
    fireEvent.focus(chip(3));
    expect(calls).toEqual({ citations: [], hovers: [] });
  });

  it("가리키거나 초점을 받으면 onCitationHover(index), 떠나면 null", () => {
    const { calls } = setup();
    fireEvent.mouseEnter(chip(1));
    fireEvent.mouseLeave(chip(1));
    fireEvent.focus(chip(2));
    fireEvent.blur(chip(2));
    expect(calls.hovers).toEqual([1, null, 2, null]);
  });

  it("선택이 바뀌어도 칩 DOM 노드는 그대로다(다시 마운트하지 않음)", () => {
    const { select } = setup();
    const before = chips();
    select(1);
    const after = chips();
    expect(after).toHaveLength(before.length);
    after.forEach((element, index) => expect(element).toBe(before[index]));
    expect(after[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("외부 링크는 새 창에서 noopener noreferrer 로 연다", () => {
    setup();
    const link = screen.getByRole("link", { name: "외부 링크" });
    expect(link.getAttribute("href")).toBe("https://example.com/a");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("이미지는 불러오지 않고 대체 글자를 보인다", () => {
    const { container } = setup();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("그림: 도장")).not.toBeNull();
  });

  it("원시 HTML 은 요소로 그리지 않는다", () => {
    const { container } = setup(
      '앞 <script>alert(1)</script><b onclick="x()">굵게</b> 뒤',
    );
    expect(container.querySelectorAll("script, b, [onclick]")).toHaveLength(0);
  });

  it("안전하지 않은 링크 주소는 지운다", () => {
    setup("[누름](javascript:alert(1))");
    const link = screen.getByText("누름").closest("a")!;
    expect(link.getAttribute("href")).toBe("");
  });
});
