import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  MovePagesDialog,
  type MovePagesDialogLabels,
  type MovePagesDialogProps,
  type MovePagesRequest,
  type MovePagesResult,
  type MovePagesTarget,
} from "@/components/studio-ui-kit/move-pages-dialog/move-pages-dialog";

const TEST_ID = "mp";

const labels: MovePagesDialogLabels = {
  title: "옮기기",
  description: "범위 설명",
  selectionDescription: "선택 설명",
  from: "처음",
  to: "끝쪽",
  target: "대상",
  documentOption: (index, label) => `#${index}:${label ?? "-"}`,
  newDocument: "새것",
  onlyNewDocument: "새것만",
  newDocumentLabel: "새 라벨",
  noLabel: "없음",
  position: "자리",
  positions: { end: "뒤", start: "앞", before: "사이" },
  beforePage: max => `순번 1..${max}`,
  invalidRange: total => `범위 1..${total}`,
  invalidBefore: total => `순번 오류 1..${total}`,
  targetMissing: "대상 없음",
  cancel: "닫기",
  move: "확인",
};

const TARGETS: readonly MovePagesTarget[] = [
  { documentId: "b", index: 1, label: "Invoice", pageCount: 3 },
  { documentId: "c", index: 3, label: null, pageCount: 1 },
];

interface Calls {
  requests: MovePagesRequest[];
  openChanges: boolean[];
}

type Overrides = Partial<
  Omit<MovePagesDialogProps, "open" | "onOpenChange" | "onMove">
>;

function setup(
  overrides: Overrides = {},
  outcomes: MovePagesResult[] = [{ ok: true }],
) {
  const calls: Calls = { requests: [], openChanges: [] };
  let count = 0;
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button
          type="button"
          data-testid="opener"
          onClick={() => setOpen(true)}
        >
          open
        </button>
        <MovePagesDialog
          open={open}
          onOpenChange={next => {
            calls.openChanges.push(next);
            setOpen(next);
          }}
          targets={TARGETS}
          labelChoices={["Invoice"]}
          defaultLabel={null}
          source={{ kind: "range", pageCount: 4, currentIndex: 2 }}
          onMove={request => {
            calls.requests.push(request);
            return outcomes[Math.min(count++, outcomes.length - 1)]!;
          }}
          labels={labels}
          testId={TEST_ID}
          {...overrides}
        />
      </>
    );
  }
  render(<Harness />);
  return calls;
}

const byId = (suffix: string) => screen.getByTestId(`${TEST_ID}-${suffix}`);
const queryById = (suffix: string) =>
  screen.queryByTestId(`${TEST_ID}-${suffix}`);
const input = (suffix: string) => byId(suffix) as HTMLInputElement;

async function retype(suffix: string, text: string) {
  await userEvent.clear(input(suffix));
  if (text !== "") await userEvent.type(input(suffix), text);
}

const submit = () => userEvent.click(byId("button-move"));

describe("MovePagesDialog(Core) 문구", () => {
  it("range 출처는 labels 의 제목·설명·칸 이름·위치 문구를 그린다", () => {
    setup();
    expect(screen.getByRole("heading")).toHaveTextContent("옮기기");
    expect(screen.getByText("범위 설명")).toBeInTheDocument();
    expect(screen.getByLabelText("처음")).toBe(input("input-from"));
    expect(screen.getByLabelText("끝쪽")).toBe(input("input-to"));
    expect(input("input-from")).toHaveValue("3");
    expect(byId("select-target")).toHaveTextContent("#2:Invoice");
    expect(screen.getByText("자리")).toBeInTheDocument();
    expect(screen.getByLabelText("뒤")).toBe(byId("radio-end"));
    expect(screen.getByLabelText("앞")).toBe(byId("radio-start"));
    expect(screen.getByLabelText("사이")).toBe(byId("radio-before"));
  });

  it("documentOption 은 1-based 번호와 라벨(없으면 null)을 받는다", async () => {
    setup();
    byId("select-target").focus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getAllByRole("option").map(option => option.textContent),
    ).toEqual(["#2:Invoice", "#4:-", "새것"]);
  });

  it("selection 출처는 다른 설명과 요약 줄을 보이고 범위 칸이 없다", () => {
    setup({ source: { kind: "selection", count: 2, summary: "두 장" } });
    expect(screen.getByText("선택 설명")).toBeInTheDocument();
    expect(byId("summary")).toHaveTextContent("두 장");
    expect(queryById("input-from")).toBeNull();
  });

  it("대상이 없으면 새것만 안내 줄과 라벨 select(없음 항목)", () => {
    setup({ targets: [] });
    expect(byId("only-new-document")).toHaveTextContent("새것만");
    expect(byId("label-select")).toHaveTextContent("없음");
  });

  it("'사이' 를 고르면 beforePage(장수 + 1) 이름의 순번 칸", async () => {
    setup();
    await userEvent.click(byId("radio-before"));
    expect(screen.getByLabelText("순번 1..4")).toBe(input("input-before"));
  });
});

describe("MovePagesDialog(Core) 검사와 onMove", () => {
  it("범위 오류는 invalidRange(pageCount) 문구, onMove 없음", async () => {
    const calls = setup();
    await retype("input-to", "5");
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("범위 1..4");
    expect(calls).toEqual({ requests: [], openChanges: [] });
  });

  it("순번 오류는 invalidBefore(장수 + 1) 문구", async () => {
    const calls = setup();
    await userEvent.click(byId("radio-before"));
    await retype("input-before", "5");
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("순번 오류 1..4");
    expect(calls.requests).toEqual([]);
  });

  it("range 출처 요청은 range 와 destination 을 담고 성공이면 닫는다", async () => {
    const calls = setup();
    await retype("input-from", "1");
    await submit();
    expect(calls).toEqual({
      requests: [
        {
          kind: "range",
          range: { from: 1, to: 3 },
          destination: { kind: "document", documentId: "b", position: "end" },
        },
      ],
      openChanges: [false],
    });
  });

  it("selection 출처 요청에는 range 가 없다", async () => {
    const calls = setup({
      source: { kind: "selection", count: 1, summary: "한 장" },
      initialTarget: "new-document",
      defaultLabel: " Memo ",
      labelChoices: null,
    });
    await submit();
    expect(calls.requests).toEqual([
      {
        kind: "selection",
        destination: { kind: "new-document", label: "Memo" },
      },
    ]);
    expect("range" in calls.requests[0]!).toBe(false);
  });

  it("요청 타입은 kind 로 갈린다: range 요청에는 range 가 꼭 있고 selection 요청에는 없다", () => {
    const destination = { kind: "new-document", label: null } as const;
    const requests: MovePagesRequest[] = [
      { kind: "range", range: { from: 1, to: 1 }, destination },
      { kind: "selection", destination },
    ];
    // @ts-expect-error -- range 요청에는 range 가 있어야 한다.
    const noRange: MovePagesRequest = { kind: "range", destination };
    const withRange: MovePagesRequest = {
      kind: "selection",
      // @ts-expect-error -- selection 요청에는 range 를 둘 수 없다.
      range: { from: 1, to: 1 },
      destination,
    };
    expect(
      [...requests, noRange, withRange].map(request => request.kind),
    ).toEqual(["range", "selection", "range", "selection"]);
  });

  it("실패면 message 를 그대로 보이고 닫지 않는다", async () => {
    const calls = setup({}, [{ ok: false, message: "안 됨" }]);
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent("안 됨");
    expect(calls.openChanges).toEqual([]);
  });

  it("다시 열면 처음 상태(재마운트)", async () => {
    setup();
    await retype("input-from", "9");
    await submit();
    await userEvent.click(byId("button-cancel"));
    await userEvent.click(screen.getByTestId("opener"));
    expect(input("input-from")).toHaveValue("3");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("MovePagesDialog(Core) 선택 props", () => {
  it("labelMaxLength 가 없으면 자유 입력에 maxLength 속성이 없다", () => {
    setup({ initialTarget: "new-document", labelChoices: null });
    expect(input("label-input")).not.toHaveAttribute("maxlength");
    expect(input("label-input")).toHaveAttribute("placeholder", "없음");
  });

  it("labelMaxLength 를 주면 maxLength 로 둔다", () => {
    setup({
      initialTarget: "new-document",
      labelChoices: null,
      labelMaxLength: 12,
    });
    expect(input("label-input")).toHaveAttribute("maxlength", "12");
  });

  it("testId 가 없으면 루트·하위 어디에도 data-testid 가 없다", () => {
    setup({ testId: undefined });
    expect(document.body.querySelectorAll("[data-testid]")).toHaveLength(1);
    expect(screen.getByTestId("opener")).toBeInTheDocument();
  });
});

describe("MovePagesDialog DOM 계약", () => {
  it('루트는 role="dialog" 이고 닫기 X 버튼이 없다', () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-testid", TEST_ID);
    expect(
      [...dialog.querySelectorAll("button:not([role=combobox])")].map(button =>
        button.getAttribute("data-testid"),
      ),
    ).toEqual([`${TEST_ID}-button-cancel`, `${TEST_ID}-button-move`]);
  });

  it("위치는 Core 가 그리는 native radio 3 개이고 같은 name 으로 묶인다(기본 end)", () => {
    setup();
    const radios = ["end", "start", "before"].map(
      choice => byId(`radio-${choice}`) as HTMLInputElement,
    );
    expect(radios.map(radio => radio.type)).toEqual([
      "radio",
      "radio",
      "radio",
    ]);
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);
    expect(radios[0]!.name).not.toBe("");
    expect(radios.map(radio => radio.checked)).toEqual([true, false, false]);
  });

  it("오류가 있으면 숫자 칸이 aria-invalid·aria-describedby 로 오류 줄을 가리킨다", async () => {
    setup();
    expect(input("input-from")).not.toHaveAttribute("aria-invalid");
    await retype("input-from", "0");
    await submit();
    const alert = screen.getByRole("alert");
    expect(input("input-from")).toHaveAttribute("aria-invalid", "true");
    expect(input("input-from")).toHaveAttribute("aria-describedby", alert.id);
  });

  it("testid 접미: 범위 모드 문서 대상", () => {
    setup();
    expect(
      [...screen.getByRole("dialog").querySelectorAll("[data-testid]")].map(
        node => node.getAttribute("data-testid")!.slice(TEST_ID.length + 1),
      ),
    ).toEqual([
      "input-from",
      "input-to",
      "select-target",
      "radio-end",
      "radio-start",
      "radio-before",
      "button-cancel",
      "button-move",
    ]);
  });
});
