import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  DocumentPositionDialog,
  type DocumentPositionDialogLabels,
  type DocumentPositionDialogProps,
} from "@/components/studio-ui-kit/structure-editor/document-position-dialog";

const TEST_ID = "dp";

const labels: DocumentPositionDialogLabels = {
  title: "위치",
  description: (index, first, last) => `문서 ${index} → ${first}..${last}`,
  position: "번호",
  invalid: (first, last) => `${first}..${last} 만`,
  cancel: "닫기",
  move: "확인",
};

interface Calls {
  moves: number[];
  openChanges: boolean[];
}

type Overrides = Partial<
  Omit<DocumentPositionDialogProps, "open" | "onOpenChange" | "onMove">
>;

function Harness({ calls, ...overrides }: Overrides & { calls: Calls }) {
  const [open, setOpen] = useState(true);
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
        labels={labels}
        testId={TEST_ID}
        {...overrides}
      />
    </>
  );
}

function setup(overrides: Overrides = {}) {
  const calls: Calls = { moves: [], openChanges: [] };
  render(<Harness calls={calls} {...overrides} />);
  return calls;
}

const input = () => screen.getByTestId(`${TEST_ID}-input`) as HTMLInputElement;

async function submitText(text: string) {
  await userEvent.clear(input());
  if (text !== "") await userEvent.type(input(), text);
  await userEvent.click(screen.getByTestId(`${TEST_ID}-button-move`));
}

describe("DocumentPositionDialog(Core) 문구", () => {
  it("labels 로 제목·설명(1-based 지금 위치와 구간)·입력 이름·버튼을 그린다", () => {
    setup();
    expect(screen.getByRole("heading")).toHaveTextContent("위치");
    expect(screen.getByText("문서 3 → 2..6")).toBeInTheDocument();
    expect(screen.getByLabelText("번호")).toBe(input());
    expect(screen.getByTestId(`${TEST_ID}-button-cancel`)).toHaveTextContent(
      "닫기",
    );
    expect(screen.getByTestId(`${TEST_ID}-button-move`)).toHaveTextContent(
      "확인",
    );
  });
});

describe("DocumentPositionDialog(Core) 검사와 onMove", () => {
  it.each(["1", "7", "x", ""])(
    "구간 밖·숫자 아님(%j)은 labels.invalid 문구를 보이고 닫지 않는다",
    async text => {
      const calls = setup();
      await submitText(text);
      expect(screen.getByRole("alert")).toHaveTextContent("2..6 만");
      expect(input()).toHaveAttribute("aria-invalid", "true");
      expect(calls).toEqual({ moves: [], openChanges: [] });
    },
  );

  it("다른 위치는 onMove(1-based) 한 번 뒤 닫는다", async () => {
    const calls = setup();
    await submitText(" 5 ");
    expect(calls).toEqual({ moves: [5], openChanges: [false] });
    expect(screen.queryByTestId(TEST_ID)).toBeNull();
  });

  it("지금 위치와 같으면 onMove 없이 닫는다", async () => {
    const calls = setup();
    await submitText("3");
    expect(calls).toEqual({ moves: [], openChanges: [false] });
  });

  it("다시 열면 입력이 지금 위치에서 다시 시작한다(재마운트)", async () => {
    setup();
    await userEvent.clear(input());
    await userEvent.type(input(), "9");
    await userEvent.click(screen.getByTestId(`${TEST_ID}-button-cancel`));
    await userEvent.click(screen.getByTestId("opener"));
    expect(input()).toHaveValue("3");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("returnFocus 가 돌려준 요소로 닫힌 뒤 포커스를 옮긴다", async () => {
    const target = document.createElement("button");
    document.body.append(target);
    setup({ returnFocus: () => target });
    await userEvent.click(screen.getByTestId(`${TEST_ID}-button-cancel`));
    expect(target).toHaveFocus();
    target.remove();
  });
});

describe("DocumentPositionDialog(Core) testId", () => {
  it("testId 가 없으면 루트·하위 어디에도 data-testid 가 없다", () => {
    setup({ testId: undefined });
    expect(document.body.querySelectorAll("[data-testid]")).toHaveLength(1);
    expect(screen.getByTestId("opener")).toBeInTheDocument();
  });

  it("testId 가 있으면 루트와 -input·-button-cancel·-button-move", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-testid", TEST_ID);
    expect(
      [...dialog.querySelectorAll("[data-testid]")].map(node =>
        node.getAttribute("data-testid"),
      ),
    ).toEqual([
      `${TEST_ID}-input`,
      `${TEST_ID}-button-cancel`,
      `${TEST_ID}-button-move`,
    ]);
  });
});

describe("DocumentPositionDialog DOM 계약", () => {
  it('루트는 role="dialog" 이고 aria-describedby 첫 토큰이 설명 문장, 닫기 X 버튼이 없다', () => {
    setup();
    const dialog = screen.getByRole("dialog");
    const description = screen.getByText("문서 3 → 2..6");
    expect(dialog.getAttribute("aria-describedby")!.split(" ")[0]).toBe(
      description.id,
    );
    expect(dialog.querySelectorAll("button")).toHaveLength(2);
  });

  it("입력은 설명 문장을, 오류가 있으면 오류(role=alert)도 aria-describedby 로 가리킨다", async () => {
    setup();
    const description = screen.getByText("문서 3 → 2..6");
    expect(input()).toHaveAttribute("aria-describedby", description.id);
    expect(input()).not.toHaveAttribute("aria-invalid");
    await submitText("0");
    const alert = screen.getByRole("alert");
    expect(input()).toHaveAttribute(
      "aria-describedby",
      `${description.id} ${alert.id}`,
    );
  });

  it("입력은 autoFocus 로 포커스를 받고 값 전체가 선택된다", () => {
    setup();
    expect(input()).toHaveFocus();
    expect([input().selectionStart, input().selectionEnd]).toEqual([0, 1]);
  });
});
