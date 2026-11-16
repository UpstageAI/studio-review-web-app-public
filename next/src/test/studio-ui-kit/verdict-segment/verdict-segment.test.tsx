import { fireEvent, render, screen } from "@testing-library/react";
import {
  VerdictSegment,
  type Verdict,
  type VerdictSegmentLabels,
  type VerdictSegmentProps,
} from "@/components/studio-ui-kit/verdict-segment/verdict-segment";

const labels: VerdictSegmentLabels = {
  group: "판정",
  verdicts: { green: "통과", yellow: "확인", red: "실패" },
  checks: "근거",
  passed: "통과함",
  failed: "실패함",
};

function renderSegment(overrides: Partial<VerdictSegmentProps> = {}) {
  const changes: Verdict[] = [];
  const result = render(
    <VerdictSegment
      value="yellow"
      onValueChange={value => changes.push(value)}
      labels={labels}
      testId="verdict"
      {...overrides}
    />,
  );
  return { ...result, changes };
}

function buttons(): HTMLElement[] {
  return screen.getAllByRole("radio");
}

describe("VerdictSegment — 버튼 속성(buttonProps)", () => {
  it("넘긴 data-* 속성을 세 칸 버튼 모두에 붙인다", () => {
    renderSegment({ buttonProps: { "data-host-input": "" } });
    expect(buttons()).toHaveLength(3);
    for (const button of buttons()) {
      expect(button).toHaveAttribute("data-host-input", "");
    }
    // 루트에는 붙이지 않는다.
    expect(screen.getByTestId("verdict")).not.toHaveAttribute(
      "data-host-input",
    );
  });

  it("넘기지 않으면 속성이 없다", () => {
    renderSegment();
    for (const button of buttons()) {
      expect(button).not.toHaveAttribute("data-host-input");
    }
  });

  it("data-verdict·data-testid 는 덮지 못하고 방향키 이동이 그대로다", () => {
    const { changes } = renderSegment({
      // @ts-expect-error -- 맵에는 data-testid 를 넣을 수 없다(넣어도 덮지 못하는지 본다).
      buttonProps: { "data-verdict": "red", "data-testid": "host" },
    });
    expect(buttons().map(button => button.dataset.verdict)).toEqual([
      "green",
      "yellow",
      "red",
    ]);
    expect(buttons().map(button => button.dataset.testid)).toEqual([
      "verdict-button-green",
      "verdict-button-yellow",
      "verdict-button-red",
    ]);
    fireEvent.keyDown(buttons()[1]!, { key: "ArrowRight" });
    expect(changes).toEqual(["red"]);
  });

  it("buttonProps 에는 data-testid 를 넣을 수 없고, 타입을 우회해 넣어도 내부 testid 가 이긴다", () => {
    // @ts-expect-error -- 맵에는 data-testid 를 넣을 수 없다(testId 로 넘긴다).
    const banned: VerdictSegmentProps["buttonProps"] = { "data-testid": "x" };
    expect(banned).toBeDefined();
    const buttonProps = {
      "data-host-input": "",
      "data-testid": "host",
    } as unknown as VerdictSegmentProps["buttonProps"];
    renderSegment({ buttonProps });
    for (const button of buttons()) {
      expect(button).toHaveAttribute("data-host-input", "");
    }
    expect(screen.queryByTestId("host")).toBeNull();
    expect(buttons().map(button => button.dataset.testid)).toEqual([
      "verdict-button-green",
      "verdict-button-yellow",
      "verdict-button-red",
    ]);
  });
});

describe("VerdictSegment — 값 바꾸기(onValueChange)", () => {
  it("다른 칸을 누르면 그 값으로 부르고, 이미 고른 칸을 다시 누르면 부르지 않는다", () => {
    const { changes } = renderSegment();
    fireEvent.click(screen.getByTestId("verdict-button-yellow"));
    expect(changes).toEqual([]);
    fireEvent.click(screen.getByTestId("verdict-button-red"));
    expect(changes).toEqual(["red"]);
  });
});

describe("VerdictSegment — 루트 속성 순서", () => {
  it("호출자가 넘긴 data-testid 는 testId 를 덮지 못한다", () => {
    renderSegment({ "data-testid": "host" } as Partial<VerdictSegmentProps>);
    expect(screen.queryByTestId("host")).toBeNull();
    expect(screen.getByTestId("verdict")).toBeInTheDocument();
  });
});

/**
 * Studio UI Kit item 문서의 "DOM 계약" 중 `verdict-segment` 행과 testid 접미. `data-verdict` 값은 위
 * "data-verdict·data-testid 는 덮지 못하고…" 가 본다.
 */
const DOM_CONTRACT = [
  { selector: "[data-verdict]", on: "칸 버튼" },
  { selector: '[data-testid="verdict-reason"]', on: "판정 근거 줄 `li`" },
] as const;

const CHECKS = [
  { name: "합계", severity: "error", passed: false, reason: "불일치" },
  { name: "날짜", passed: true },
];

describe("VerdictSegment DOM 계약", () => {
  it.each(DOM_CONTRACT)("$selector 가 $on 에 붙는다", ({ selector }) => {
    const { container } = renderSegment({ checks: CHECKS });
    expect(container.querySelector(selector)).not.toBeNull();
  });

  it("-reason 은 근거 한 줄마다 li 하나", () => {
    renderSegment({ checks: CHECKS });
    const reasons = screen.getAllByTestId("verdict-reason");
    expect(reasons.map(el => [el.tagName, el.textContent])).toEqual([
      ["LI", "✗합계 · error · 불일치"],
      ["LI", "✓날짜"],
    ]);
  });

  it("근거가 없거나 testId 가 없으면 -reason 이 없다", () => {
    const { unmount } = renderSegment({ checks: [] });
    expect(screen.queryAllByTestId("verdict-reason")).toHaveLength(0);
    unmount();
    const { container } = renderSegment({ checks: CHECKS, testId: undefined });
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });
});
