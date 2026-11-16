import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { snapshotHtml } from "../../dom-snapshot";
import {
  PagePositionBar,
  type PagePositionBarLabels,
  type PagePositionBarProps,
} from "@/components/studio-ui-kit/page-position-bar/page-position-bar";
import type { PageMark } from "@/components/studio-ui-kit/page-position-bar/position";

const LABELS: PagePositionBarLabels = {
  label: "페이지 위치",
  previous: "이전 페이지",
  next: "다음 페이지",
  pageInput: "페이지 번호",
  pageCount: count => `/ ${count}`,
  track: "페이지 트랙",
  valueText: (page, total) => `${total}쪽 중 ${page}쪽`,
  marks: { changed: "바뀐 값", issue: "검증 문제", noImage: "이미지 없음" },
};

const TID = "bar";

type HarnessProps = Omit<PagePositionBarProps, "onIndexChange" | "labels"> & {
  calls: number[];
};

/** 실제 host 처럼 `onIndexChange` 결과를 `index` 로 되돌려 주는 제어형 래퍼. 호출은 `calls` 에 쌓는다. */
function Harness({ index: initial, calls, ...props }: HarnessProps) {
  const [index, setIndex] = useState(initial);
  return (
    <PagePositionBar
      {...props}
      index={index}
      labels={LABELS}
      testId={TID}
      onIndexChange={next => {
        calls.push(next);
        setIndex(next);
      }}
    />
  );
}

function renderBar(props: Partial<HarnessProps> = {}) {
  const calls: number[] = [];
  const result = render(
    <Harness index={0} count={30} calls={calls} {...props} />,
  );
  return { calls, ...result };
}

const byId = (suffix: string) => screen.getByTestId(`${TID}-${suffix}`);

/** 트랙 폭을 300px(left 100)로 고정한다. jsdom 은 레이아웃이 없어 0 을 돌려준다. */
function fixTrackRect(track: HTMLElement) {
  track.getBoundingClientRect = () =>
    ({
      left: 100,
      right: 400,
      top: 0,
      bottom: 24,
      width: 300,
      height: 24,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("PagePositionBar", () => {
  it("루트 DOM 스냅샷(표식 세 종류, 중간 위치)", () => {
    const marks: PageMark[] = [
      { index: 2, kind: "changed" },
      { index: 3, kind: "changed" },
      { index: 5, kind: "issue" },
      { index: 7, kind: "noImage" },
      { index: 8, kind: "noImage" },
    ];
    renderBar({ index: 4, count: 10, marks });
    expect(snapshotHtml(screen.getByTestId(TID))).toMatchSnapshot();
  });

  it("◀ ▶ 클릭은 한 쪽씩 옮긴다", () => {
    const { calls } = renderBar({ index: 5 });
    fireEvent.click(byId("button-next"));
    fireEvent.click(byId("button-next"));
    fireEvent.click(byId("button-previous"));
    expect(calls).toEqual([6, 7, 6]);
    expect(byId("input-page")).toHaveValue("7");
  });

  it("끝에 닿은 버튼은 disabled 가 아니라 aria-disabled 로 막혀 포커스가 남는다", () => {
    const { calls } = renderBar({ index: 1, count: 3 });
    const previous = byId("button-previous");
    expect(previous).not.toHaveAttribute("aria-disabled");

    previous.focus();
    fireEvent.click(previous);
    expect(calls).toEqual([0]);
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(previous).not.toBeDisabled();
    expect(previous).toHaveClass("cursor-not-allowed", "opacity-50");
    expect(previous).toHaveFocus();

    fireEvent.click(previous);
    expect(calls).toEqual([0]);

    fireEvent.click(byId("button-next"));
    fireEvent.click(byId("button-next"));
    const next = byId("button-next");
    expect(calls).toEqual([0, 1, 2]);
    expect(next).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(next);
    expect(calls).toEqual([0, 1, 2]);
  });

  it("번호 입력은 Enter 로 확정하고 범위 밖·숫자 아님은 무시하며 현재 위치로 되돌린다", () => {
    const { calls } = renderBar({ index: 0, count: 30 });
    const input = byId("input-page");
    expect(input).toHaveValue("1");

    fireEvent.change(input, { target: { value: " 12 " } });
    expect(input).toHaveValue(" 12 ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([11]);
    expect(input).toHaveValue("12");

    fireEvent.change(input, { target: { value: "31" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([11]);
    expect(input).toHaveValue("12");

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([11]);
    expect(input).toHaveValue("12");
  });

  it("같은 페이지 번호를 확정하면 onIndexChange 를 부르지 않는다", () => {
    const { calls } = renderBar({ index: 4 });
    const input = byId("input-page");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls).toEqual([]);
  });

  it("번호 입력의 Esc·포커스 이탈은 확정하지 않고 현재 위치로 되돌린다", () => {
    const { calls } = renderBar({ index: 2 });
    const input = byId("input-page");

    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("3");

    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("3");
    expect(calls).toEqual([]);
  });

  it("편집 중 위치가 바뀌면 입력은 새 위치를 보인다", () => {
    const { calls } = renderBar({ index: 2 });
    const input = byId("input-page");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.click(byId("button-next"));
    expect(calls).toEqual([3]);
    expect(input).toHaveValue("4");
  });

  it("트랙 키보드: 화살표 한 쪽, PageUp/Down 10 쪽, Home/End 양끝, 범위 밖은 자른다", () => {
    const { calls } = renderBar({ index: 15, count: 30 });
    const track = byId("slider-track");
    for (const key of [
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
      "PageDown",
      "PageUp",
      "End",
      "Home",
    ]) {
      fireEvent.keyDown(track, { key });
    }
    expect(calls).toEqual([16, 17, 16, 15, 25, 15, 29, 0]);

    fireEvent.keyDown(track, { key: "PageUp" });
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(calls).toEqual([16, 17, 16, 15, 25, 15, 29, 0]);

    fireEvent.keyDown(track, { key: "End" });
    fireEvent.keyDown(track, { key: "PageDown" });
    expect(calls).toEqual([16, 17, 16, 15, 25, 15, 29, 0, 29]);
  });

  it("트랙 키보드: pageStep 을 넘기면 PageUp/Down 이 그 쪽수만큼 옮긴다", () => {
    const { calls } = renderBar({ index: 15, count: 30, pageStep: 4 });
    const track = byId("slider-track");
    fireEvent.keyDown(track, { key: "PageDown" });
    fireEvent.keyDown(track, { key: "PageUp" });
    fireEvent.keyDown(track, { key: "PageUp" });
    expect(calls).toEqual([19, 15, 11]);
  });

  it("트랙 키보드: 수식어 조합과 모르는 키는 무시하고 기본 동작을 막지 않는다", () => {
    const { calls } = renderBar({ index: 5 });
    const track = byId("slider-track");
    expect(fireEvent.keyDown(track, { key: "ArrowDown", altKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(track, { key: "ArrowDown", ctrlKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(track, { key: "ArrowDown", metaKey: true })).toBe(
      true,
    );
    expect(fireEvent.keyDown(track, { key: "a" })).toBe(true);
    expect(calls).toEqual([]);
    expect(fireEvent.keyDown(track, { key: "ArrowDown" })).toBe(false);
    expect(calls).toEqual([6]);
  });

  it("트랙은 slider 접근성 값을 1-based 로 알린다", () => {
    renderBar({ index: 4, count: 10 });
    const track = screen.getByRole("slider", { name: "페이지 트랙" });
    expect(track).toHaveAttribute("aria-valuemin", "1");
    expect(track).toHaveAttribute("aria-valuemax", "10");
    expect(track).toHaveAttribute("aria-valuenow", "5");
    expect(track).toHaveAttribute("aria-valuetext", "10쪽 중 5쪽");
    expect(track).toHaveAttribute("tabindex", "0");
  });

  it("표식은 종류별 연속 구간 하나로 합쳐 종류별 testid 와 title 로 그린다", () => {
    renderBar({
      index: 0,
      count: 10,
      marks: [
        { index: 1, kind: "changed" },
        { index: 2, kind: "changed" },
        { index: 6, kind: "changed" },
        { index: 4, kind: "issue" },
        { index: 9, kind: "noImage" },
        { index: 10, kind: "noImage" },
      ],
    });
    const changed = screen.getAllByTestId(`${TID}-mark-changed`);
    expect(changed).toHaveLength(2);
    expect(changed[0]).toHaveStyle({ left: "10%", width: "20%" });
    expect(changed[0]).toHaveAttribute("title", "바뀐 값");
    expect(changed[0]).toHaveClass("bg-primary");
    expect(changed[1]).toHaveStyle({ left: "60%", width: "10%" });

    const issue = screen.getByTestId(`${TID}-mark-issue`);
    expect(issue).toHaveAttribute("title", "검증 문제");
    expect(issue).toHaveClass("bg-destructive");

    const noImage = screen.getAllByTestId(`${TID}-mark-no-image`);
    expect(noImage).toHaveLength(1);
    expect(noImage[0]).toHaveStyle({ left: "90%", width: "10%" });
    expect(noImage[0]).toHaveAttribute("title", "이미지 없음");

    const order = [...byId("slider-track").querySelectorAll("[data-testid]")]
      .map(el => el.getAttribute("data-testid"))
      .filter(id => id?.startsWith(`${TID}-mark-`));
    expect(order).toEqual([
      "bar-mark-no-image",
      "bar-mark-issue",
      "bar-mark-changed",
      "bar-mark-changed",
    ]);
  });

  it("pointer 로 누르고 끌면 그 자리 페이지로 옮기고, 놓은 뒤 움직임은 무시한다", () => {
    const { calls } = renderBar({ index: 0, count: 30 });
    const track = byId("slider-track");
    fixTrackRect(track);

    fireEvent.pointerDown(track, { clientX: 250, button: 0, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 399, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(track, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 250, pointerId: 1 });

    // 150/300 → 15, 299/300 → 29, 오른쪽 밖 → 29(같은 값이라 부르지 않음), 왼쪽 밖 → 0
    expect(calls).toEqual([15, 29, 0]);
  });

  it("pointer 오른쪽 버튼은 무시하고, 트랙 폭이 0 이면 현재 위치를 쓴다", () => {
    const { calls } = renderBar({ index: 3, count: 30 });
    const track = byId("slider-track");
    fireEvent.pointerDown(track, { clientX: 250, button: 2, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 });
    expect(calls).toEqual([]);

    // jsdom 기본 rect(width 0) — 현재 위치와 같아 onIndexChange 가 불리지 않는다.
    fireEvent.pointerDown(track, { clientX: 250, button: 0, pointerId: 1 });
    expect(calls).toEqual([]);
  });

  it("disabled 면 버튼·입력이 막히고 트랙은 포커스·키보드·pointer 를 받지 않는다", () => {
    const { calls } = renderBar({ index: 5, disabled: true });
    expect(byId("button-previous")).toBeDisabled();
    expect(byId("button-next")).toBeDisabled();
    expect(byId("input-page")).toBeDisabled();

    const track = byId("slider-track");
    fixTrackRect(track);
    expect(track).toHaveAttribute("tabindex", "-1");
    expect(track).toHaveAttribute("aria-disabled", "true");
    expect(track).toHaveClass("cursor-not-allowed", "opacity-50");

    fireEvent.keyDown(track, { key: "End" });
    fireEvent.pointerDown(track, { clientX: 250, button: 0, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 300, pointerId: 1 });
    expect(calls).toEqual([]);
  });

  it("페이지가 없으면 입력은 비고 막히며 트랙 값은 0 쪽으로 읽힌다", () => {
    const { calls } = renderBar({ index: 0, count: 0 });
    expect(byId("input-page")).toHaveValue("");
    expect(byId("input-page")).toBeDisabled();
    const track = byId("slider-track");
    expect(track).toHaveAttribute("aria-valuemax", "1");
    expect(track).toHaveAttribute("aria-valuenow", "1");
    expect(track).toHaveAttribute("aria-valuetext", "0쪽 중 0쪽");
    fireEvent.keyDown(track, { key: "End" });
    expect(calls).toEqual([]);
    expect(byId("button-previous")).toHaveAttribute("aria-disabled", "true");
    expect(byId("button-next")).toHaveAttribute("aria-disabled", "true");
  });
});
