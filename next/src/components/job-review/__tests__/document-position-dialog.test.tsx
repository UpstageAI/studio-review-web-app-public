import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import {
  DocumentPositionDialog,
  type DocumentPositionDialogProps,
} from "../document-position-dialog";

const TEST_ID = "job-review-document-position-dialog";

interface Calls {
  moves: number[];
  openChanges: boolean[];
}

type Overrides = Partial<
  Omit<DocumentPositionDialogProps, "open" | "onOpenChange" | "onMove">
>;

/** 열림 상태를 스스로 들고 있는 호출처. 바깥 버튼으로 다시 열 수 있다. */
function Harness({
  calls,
  initialOpen = true,
  ...overrides
}: Overrides & { calls: Calls; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        open
      </button>
      <DocumentPositionDialog
        open={open}
        onOpenChange={next => {
          calls.openChanges.push(next);
          setOpen(next);
        }}
        index={2}
        min={2}
        max={6}
        onMove={position => calls.moves.push(position)}
        {...overrides}
      />
    </>
  );
}

function setup(overrides: Overrides & { initialOpen?: boolean } = {}) {
  const calls: Calls = { moves: [], openChanges: [] };
  const view = renderWithIntl(<Harness calls={calls} {...overrides} />);
  return { ...view, calls };
}

const dialog = () => screen.queryByTestId(TEST_ID);
const input = () => screen.getByTestId(`${TEST_ID}-input`) as HTMLInputElement;
const move = () => screen.getByTestId(`${TEST_ID}-button-move`);
const cancel = () => screen.getByTestId(`${TEST_ID}-button-cancel`);

async function typeInto(text: string) {
  await userEvent.clear(input());
  if (text !== "") await userEvent.type(input(), text);
}

describe("DocumentPositionDialog 렌더", () => {
  it("열린 대화 상자의 DOM", () => {
    setup();
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it("닫혀 있으면 아무것도 그리지 않는다", () => {
    setup({ initialOpen: false });
    expect(dialog()).toBeNull();
  });

  it("제목·범위 설명을 보이고 닫기 X 버튼이 없다", () => {
    setup();
    const root = dialog()!;
    expect(root).toHaveAttribute("role", "dialog");
    expect(screen.getByRole("heading")).toHaveTextContent("문서 위치 지정");
    expect(root).toHaveTextContent(
      "문서 3의 새 위치를 같은 파일 그룹 안 2–6 사이로 적으세요.",
    );
    expect(
      [...root.querySelectorAll("button")].map(button =>
        button.getAttribute("data-testid"),
      ),
    ).toEqual([`${TEST_ID}-button-cancel`, `${TEST_ID}-button-move`]);
    expect(cancel()).toHaveTextContent("취소");
    expect(move()).toHaveTextContent("옮기기");
  });

  it("입력은 지금 위치(1-based)에서 시작하고 포커스를 받아 전체가 선택된다", () => {
    setup();
    expect(input()).toHaveValue("3");
    expect(input()).toHaveFocus();
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe(1);
  });

  it("입력은 설명 문장에 연결되고 처음에는 aria-invalid 가 없다", () => {
    setup();
    const description = screen.getByText(/문서 3의 새 위치/);
    expect(input()).toHaveAttribute("aria-describedby", description.id);
    expect(input()).not.toHaveAttribute("aria-invalid");
    // 대화 상자 루트도 같은 설명 문장을 먼저 가리킨다(뒤의 Radix 기본 설명 id 는 스냅샷이 고정).
    expect(dialog()!.getAttribute("aria-describedby")!.split(" ")[0]).toBe(
      description.id,
    );
    expect(screen.getByLabelText("위치")).toBe(input());
  });
});

describe("DocumentPositionDialog 검사", () => {
  it.each([
    ["범위 아래", "1"],
    ["범위 위", "7"],
    ["숫자 아님", "abc"],
    ["소수", "3.5"],
    ["빈 값", ""],
  ])("%s 이면 오류를 보이고 닫지 않는다", async (_name, text) => {
    const { calls } = setup();
    await typeInto(text);
    await userEvent.click(move());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("2부터 6 사이의 숫자를 적으세요.");
    expect(input()).toHaveAttribute("aria-invalid", "true");
    const description = screen.getByText(/문서 3의 새 위치/);
    expect(input()).toHaveAttribute(
      "aria-describedby",
      `${description.id} ${alert.id}`,
    );
    expect(calls).toEqual({ moves: [], openChanges: [] });
    expect(dialog()).not.toBeNull();
  });

  it("오류 상태 DOM", async () => {
    setup();
    await typeInto("9");
    await userEvent.click(move());
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it("입력을 바꾸면 오류가 지워진다", async () => {
    setup();
    await typeInto("9");
    await userEvent.click(move());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.type(input(), "{Backspace}");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input()).not.toHaveAttribute("aria-invalid");
  });

  it("앞뒤 공백은 허용한다", async () => {
    const { calls } = setup();
    await typeInto(" 5 ");
    await userEvent.click(move());
    expect(calls).toEqual({ moves: [5], openChanges: [false] });
  });
});

describe("DocumentPositionDialog 제출과 닫기", () => {
  it("다른 위치면 onMove(1-based) 를 한 번 부르고 닫는다", async () => {
    const { calls } = setup();
    await typeInto("6");
    await userEvent.click(move());
    expect(calls).toEqual({ moves: [6], openChanges: [false] });
    expect(dialog()).toBeNull();
  });

  it("Enter 로도 제출한다", async () => {
    const { calls } = setup();
    await typeInto("2{Enter}");
    expect(calls).toEqual({ moves: [2], openChanges: [false] });
  });

  it("지금 위치와 같으면 onMove 없이 닫는다", async () => {
    const { calls } = setup();
    await userEvent.click(move());
    expect(calls).toEqual({ moves: [], openChanges: [false] });
    expect(dialog()).toBeNull();
  });

  it("취소 버튼은 onMove 없이 닫는다", async () => {
    const { calls } = setup();
    await typeInto("5");
    await userEvent.click(cancel());
    expect(calls).toEqual({ moves: [], openChanges: [false] });
    expect(dialog()).toBeNull();
  });

  it("Esc 는 onMove 없이 닫는다", async () => {
    const { calls } = setup();
    await typeInto("5");
    await userEvent.keyboard("{Escape}");
    expect(calls).toEqual({ moves: [], openChanges: [false] });
    expect(dialog()).toBeNull();
  });

  it("닫았다 다시 열면 입력·오류가 처음 상태다", async () => {
    setup();
    await typeInto("9");
    await userEvent.click(move());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(cancel());
    expect(dialog()).toBeNull();
    await userEvent.click(screen.getByTestId("opener"));
    expect(input()).toHaveValue("3");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("닫히면 returnFocus 가 돌려준 요소로 포커스를 돌린다", async () => {
    const target = document.createElement("button");
    target.dataset.testid = "return-target";
    document.body.append(target);
    try {
      setup({ returnFocus: () => target });
      await userEvent.click(cancel());
      expect(target).toHaveFocus();
    } finally {
      target.remove();
    }
  });
});
