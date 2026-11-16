import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { DropReason, PageRef } from "@/lib/review-model";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import {
  MovePagesDialog,
  type MovePagesDialogProps,
} from "../move-pages-dialog";
import type { MovePagesTarget } from "../move-pages-targets";
import type { MoveDestination, MovePagesInput } from "../use-structure-actions";

const TEST_ID = "job-review-move-pages-dialog";

type Outcome = { ok: true } | { ok: false; reason: DropReason };

interface Calls {
  rangeMoves: MovePagesInput[];
  selectionMoves: MoveDestination[];
  openChanges: boolean[];
}

const PAGES: readonly PageRef[] = [1, 2, 3, 4, 5].map(page => ({
  file_ref: "file-1",
  page,
}));

const TARGETS: readonly MovePagesTarget[] = [
  { documentId: "doc-b", index: 2, label: "Invoice", pageCount: 3 },
  { documentId: "doc-c", index: 4, label: null, pageCount: 1 },
];

type Common = Pick<
  MovePagesDialogProps,
  "targets" | "labelChoices" | "defaultLabel" | "initialTarget"
>;

interface SetupOptions extends Partial<Common> {
  /** 있으면 선택 모드(`selection`)로 그린다. */
  summary?: string;
  /** `onMove` 가 돌려줄 결과(차례대로, 모자라면 마지막 값). */
  outcomes?: Outcome[];
}

function setup({
  summary,
  outcomes = [{ ok: true }],
  ...common
}: SetupOptions = {}) {
  const calls: Calls = { rangeMoves: [], selectionMoves: [], openChanges: [] };
  let count = 0;
  const next = () => outcomes[Math.min(count++, outcomes.length - 1)]!;
  const base: Common = {
    targets: TARGETS,
    labelChoices: ["Invoice", "Receipt"],
    defaultLabel: "Invoice",
    ...common,
  };

  function Harness(props: Common) {
    const [open, setOpen] = useState(true);
    const onOpenChange = (value: boolean) => {
      calls.openChanges.push(value);
      setOpen(value);
    };
    return (
      <>
        <button
          type="button"
          data-testid="opener"
          onClick={() => setOpen(true)}
        >
          open
        </button>
        {summary === undefined ? (
          <MovePagesDialog
            open={open}
            onOpenChange={onOpenChange}
            {...props}
            documentId="doc-a"
            docPages={PAGES}
            currentIndex={1}
            onMove={input => {
              calls.rangeMoves.push(input);
              return next();
            }}
          />
        ) : (
          <MovePagesDialog
            open={open}
            onOpenChange={onOpenChange}
            {...props}
            selection={{
              count: 3,
              summary,
              onMove: destination => {
                calls.selectionMoves.push(destination);
                return next();
              },
            }}
          />
        )}
      </>
    );
  }

  const view = renderWithIntl(<Harness {...base} />);
  const rerender = (patch: Partial<Common>) =>
    view.rerender(<Harness {...base} {...patch} />);
  return { ...view, calls, rerender };
}

const byId = (suffix: string) => screen.getByTestId(`${TEST_ID}-${suffix}`);
const queryById = (suffix: string) =>
  screen.queryByTestId(`${TEST_ID}-${suffix}`);
const dialog = () => screen.queryByTestId(TEST_ID);
const input = (suffix: string) => byId(suffix) as HTMLInputElement;

async function retype(suffix: string, text: string) {
  await userEvent.clear(input(suffix));
  if (text !== "") await userEvent.type(input(suffix), text);
}

/** Radix Select 를 키보드로 열어 항목 목록을 돌려준다. */
async function openSelect(suffix: string) {
  byId(suffix).focus();
  await userEvent.keyboard("{Enter}");
  return screen.getAllByRole("option");
}

async function choose(selectSuffix: string, optionSuffix: string) {
  await openSelect(selectSuffix);
  await userEvent.click(byId(optionSuffix));
}

const submit = () => userEvent.click(byId("button-move"));
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;

describe("MovePagesDialog DOM", () => {
  it("범위 모드 기본: 대상 문서와 위치 radio", () => {
    setup();
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it("범위 모드 새 문서: 라벨 select(설정 밖 기본 라벨이 앞)", () => {
    setup({ initialTarget: "new-document", defaultLabel: "Memo" });
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it("새 문서 라벨 자유 입력(labelChoices null)", () => {
    setup({ initialTarget: "new-document", labelChoices: null });
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it("선택 모드: 요약 줄과 새 문서", () => {
    setup({
      summary: "3장 · 문서 2: 1, 3쪽 · 문서 5: 2쪽",
      initialTarget: "new-document",
    });
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });
});

describe("MovePagesDialog 렌더", () => {
  it("범위 모드는 제목·설명·시작/끝 칸을 보이고 닫기 X 버튼이 없다", () => {
    setup();
    expect(screen.getByRole("heading")).toHaveTextContent("페이지 옮기기");
    expect(dialog()).toHaveTextContent(
      "이 문서의 페이지 범위와 옮길 곳을 고르세요.",
    );
    expect(queryById("summary")).toBeNull();
    expect(
      [...dialog()!.querySelectorAll("button:not([role=combobox])")].map(
        button => button.getAttribute("data-testid"),
      ),
    ).toEqual([`${TEST_ID}-button-cancel`, `${TEST_ID}-button-move`]);
    expect(byId("button-cancel")).toHaveTextContent("취소");
    expect(byId("button-move")).toHaveTextContent("옮기기");
  });

  it("시작·끝은 보고 있는 페이지(1-based)에서 시작하고 포커스 때 전체를 고른다", async () => {
    setup();
    expect(input("input-from")).toHaveValue("2");
    expect(input("input-to")).toHaveValue("2");
    // 누르면 전체가 골라져 입력이 기존 값을 바꾼다.
    await userEvent.type(input("input-to"), "3");
    expect(input("input-to")).toHaveValue("3");
    await userEvent.click(input("input-from"));
    expect(input("input-from").selectionStart).toBe(0);
    expect(input("input-from").selectionEnd).toBe(1);
    expect(screen.getByLabelText("시작 페이지")).toBe(input("input-from"));
    expect(screen.getByLabelText("끝 페이지")).toBe(input("input-to"));
  });

  it("선택 모드는 다른 설명과 요약 줄을 보이고 범위 칸이 없다", () => {
    setup({ summary: "2장 · 문서 1: 1, 2쪽" });
    expect(dialog()).toHaveTextContent(
      "고른 페이지를 옮길 곳을 고르세요. 새 문서를 고르면 라벨을 정해 분리합니다.",
    );
    expect(byId("summary")).toHaveTextContent("2장 · 문서 1: 1, 2쪽");
    expect(queryById("input-from")).toBeNull();
    expect(queryById("input-to")).toBeNull();
  });

  it("대상 select 는 첫 대상 문서를 고르고 항목은 문서 번호·라벨(없으면 (라벨 없음))과 새 문서다", async () => {
    setup();
    expect(byId("select-target")).toHaveTextContent("문서 3 (Invoice)");
    expect(queryById("only-new-document")).toBeNull();
    const options = await openSelect("select-target");
    expect(options.map(option => option.textContent)).toEqual([
      "문서 3 (Invoice)",
      "문서 5 ((라벨 없음))",
      "새 문서 (원본 문서 바로 뒤)",
    ]);
    expect(options.map(option => option.getAttribute("data-testid"))).toEqual([
      `${TEST_ID}-option-doc-b`,
      `${TEST_ID}-option-doc-c`,
      `${TEST_ID}-option-new-document`,
    ]);
  });

  it("대상 문서가 없으면 새 문서를 고르고 안내 줄을 보인다", async () => {
    setup({ targets: [] });
    expect(byId("select-target")).toHaveTextContent(
      "새 문서 (원본 문서 바로 뒤)",
    );
    expect(byId("only-new-document")).toHaveTextContent(
      "같은 파일 그룹에 다른 문서가 없어 새 문서로 분리합니다.",
    );
    const options = await openSelect("select-target");
    expect(options.map(option => option.getAttribute("data-testid"))).toEqual([
      `${TEST_ID}-option-new-document`,
    ]);
  });

  it("문서 대상이면 위치 radio 3 개(기본 끝)를 보이고 라벨 칸이 없다", () => {
    setup();
    const radios = ["end", "start", "before"].map(
      choice => byId(`radio-${choice}`) as HTMLInputElement,
    );
    expect(radios.map(radio => radio.checked)).toEqual([true, false, false]);
    expect(radios.map(radio => radio.closest("label")!.textContent)).toEqual([
      "끝",
      "앞",
      "특정 페이지 앞",
    ]);
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);
    expect(queryById("input-before")).toBeNull();
    expect(queryById("label-select")).toBeNull();
    expect(queryById("label-input")).toBeNull();
  });

  it("'특정 페이지 앞' 을 고르면 1 에서 시작하는 순번 칸이 대상 문서 장수 + 1 을 보인다", async () => {
    setup();
    await userEvent.click(byId("radio-before"));
    expect(input("input-before")).toHaveValue("1");
    expect(screen.getByLabelText("옮길 문서 안 순번 (1–4)")).toBe(
      input("input-before"),
    );
  });

  it("새 문서 라벨 select 는 (라벨 없음) 을 늘 두고 설정 밖 기본 라벨을 맨 앞에 더한다", async () => {
    setup({ initialTarget: "new-document", defaultLabel: "Memo" });
    expect(byId("label-select")).toHaveTextContent("Memo");
    expect(queryById("radio-end")).toBeNull();
    const options = await openSelect("label-select");
    expect(options.map(option => option.textContent)).toEqual([
      "(라벨 없음)",
      "Memo",
      "Invoice",
      "Receipt",
    ]);
    expect(options.map(option => option.getAttribute("data-testid"))).toEqual([
      `${TEST_ID}-option-no-label`,
      `${TEST_ID}-option-label-Memo`,
      `${TEST_ID}-option-label-Invoice`,
      `${TEST_ID}-option-label-Receipt`,
    ]);
  });

  it("기본 라벨이 설정 안이면 더하지 않고, 없으면 (라벨 없음) 을 보인다", async () => {
    setup({ initialTarget: "new-document", defaultLabel: null });
    expect(byId("label-select")).toHaveTextContent("(라벨 없음)");
    const options = await openSelect("label-select");
    expect(options.map(option => option.textContent)).toEqual([
      "(라벨 없음)",
      "Invoice",
      "Receipt",
    ]);
  });

  it("자유 입력 라벨은 기본 라벨로 시작하고 길이 상한 200 과 placeholder 를 둔다", () => {
    setup({ initialTarget: "new-document", labelChoices: null });
    const label = input("label-input");
    expect(label).toHaveValue("Invoice");
    expect(label).toHaveAttribute("maxlength", "200");
    expect(label).toHaveAttribute("placeholder", "(라벨 없음)");
    expect(screen.getByLabelText("새 문서 라벨")).toBe(label);
  });

  it("대상을 바꿨다 돌아와도 고른 라벨이 남는다", async () => {
    setup();
    await choose("select-target", "option-new-document");
    await choose("label-select", "option-label-Receipt");
    expect(byId("label-select")).toHaveTextContent("Receipt");
    await choose("select-target", "option-doc-c");
    expect(queryById("label-select")).toBeNull();
    expect(byId("radio-end")).toBeInTheDocument();
    await choose("select-target", "option-new-document");
    expect(byId("label-select")).toHaveTextContent("Receipt");
  });
});

describe("MovePagesDialog 검사", () => {
  it.each([
    ["시작이 0", "0", "2"],
    ["끝이 문서 밖", "2", "6"],
    ["시작이 끝보다 큼", "4", "3"],
    ["숫자 아님", "a", "2"],
    ["빈 값", "", "2"],
  ])("%s 이면 범위 오류를 보이고 부르지 않는다", async (_name, from, to) => {
    const { calls } = setup();
    await retype("input-from", from);
    await retype("input-to", to);
    await submit();
    expect(alertText()).toBe("1부터 5 사이의 범위를 적으세요.");
    expect(input("input-from")).toHaveAttribute("aria-invalid", "true");
    expect(input("input-from")).toHaveAttribute(
      "aria-describedby",
      screen.getByRole("alert").id,
    );
    expect(calls.rangeMoves).toEqual([]);
    expect(calls.openChanges).toEqual([]);
  });

  it("오류 상태 DOM", async () => {
    setup();
    await retype("input-to", "9");
    await submit();
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it.each([
    ["0", "0"],
    ["대상 장수 + 2", "5"],
    ["숫자 아님", "x"],
  ])(
    "'특정 페이지 앞' 순번이 %s 이면 순번 오류를 보인다",
    async (_name, text) => {
      const { calls } = setup();
      await userEvent.click(byId("radio-before"));
      await retype("input-before", text);
      await submit();
      expect(alertText()).toBe("1부터 4 사이의 페이지를 적으세요.");
      expect(calls.rangeMoves).toEqual([]);
    },
  );

  it("범위 오류가 대상·순번 오류보다 먼저다", async () => {
    setup();
    await userEvent.click(byId("radio-before"));
    await retype("input-before", "9");
    await retype("input-from", "9");
    await submit();
    expect(alertText()).toBe("1부터 5 사이의 범위를 적으세요.");
  });

  it("고른 대상 문서가 목록에서 사라지면 target_missing 문구를 보인다", async () => {
    const { calls, rerender } = setup();
    rerender({ targets: [TARGETS[1]!] });
    await submit();
    expect(alertText()).toBe("옮길 자리를 찾지 못했습니다.");
    expect(calls.rangeMoves).toEqual([]);
  });

  it.each([
    ["시작 칸", () => userEvent.type(input("input-from"), "1")],
    ["radio", () => userEvent.click(byId("radio-start"))],
    ["대상 select", () => choose("select-target", "option-doc-c")],
  ])("%s 을 바꾸면 오류가 지워진다", async (_name, change) => {
    setup();
    await retype("input-to", "9");
    await submit();
    expect(alertText()).not.toBeNull();
    await change();
    expect(alertText()).toBeNull();
    expect(input("input-from")).not.toHaveAttribute("aria-invalid");
  });

  it("라벨 칸을 바꿔도 오류가 지워진다", async () => {
    setup({
      initialTarget: "new-document",
      labelChoices: null,
      outcomes: [{ ok: false, reason: "group_mismatch" }],
    });
    await submit();
    expect(alertText()).not.toBeNull();
    await userEvent.type(input("label-input"), "x");
    expect(alertText()).toBeNull();
  });
});

describe("MovePagesDialog 제출", () => {
  it("범위 모드 문서 대상(끝)", async () => {
    const { calls } = setup();
    await retype("input-to", "4");
    await submit();
    expect(calls.rangeMoves).toEqual([
      {
        documentId: "doc-a",
        from: 2,
        to: 4,
        destination: { kind: "document", documentId: "doc-b", position: "end" },
      },
    ]);
    expect(calls.openChanges).toEqual([false]);
    expect(dialog()).toBeNull();
  });

  it("범위 모드 문서 대상(앞, 다른 문서)", async () => {
    const { calls } = setup();
    await choose("select-target", "option-doc-c");
    await userEvent.click(byId("radio-start"));
    await submit();
    expect(calls.rangeMoves.map(item => item.destination)).toEqual([
      { kind: "document", documentId: "doc-c", position: "start" },
    ]);
  });

  it("범위 모드 문서 대상(특정 페이지 앞, 장수 + 1 까지)", async () => {
    const { calls } = setup();
    await userEvent.click(byId("radio-before"));
    await retype("input-before", " 4 ");
    await submit();
    expect(calls.rangeMoves.map(item => item.destination)).toEqual([
      {
        kind: "document",
        documentId: "doc-b",
        position: { beforePage: 4 },
      },
    ]);
  });

  it("새 문서 라벨 select 의 값을 보낸다", async () => {
    const { calls } = setup({ initialTarget: "new-document" });
    await choose("label-select", "option-label-Receipt");
    await submit();
    expect(calls.rangeMoves.map(item => item.destination)).toEqual([
      { kind: "new-document", label: "Receipt" },
    ]);
  });

  it("새 문서 (라벨 없음) 은 label null 로 보낸다", async () => {
    const { calls } = setup({ initialTarget: "new-document" });
    await choose("label-select", "option-no-label");
    expect(byId("label-select")).toHaveTextContent("(라벨 없음)");
    await submit();
    expect(calls.rangeMoves.map(item => item.destination)).toEqual([
      { kind: "new-document", label: null },
    ]);
  });

  it.each([
    ["  Memo  ", "Memo"],
    ["   ", null],
    ["", null],
  ])("자유 입력 라벨 %j 은 다듬어 %j 로 보낸다", async (text, label) => {
    const { calls } = setup({
      initialTarget: "new-document",
      labelChoices: null,
    });
    await retype("label-input", text);
    await submit();
    expect(calls.rangeMoves.map(item => item.destination)).toEqual([
      { kind: "new-document", label },
    ]);
  });

  it("선택 모드는 destination 만 넘긴다", async () => {
    const { calls } = setup({ summary: "3장" });
    await submit();
    expect(calls.selectionMoves).toEqual([
      { kind: "document", documentId: "doc-b", position: "end" },
    ]);
    expect(calls.rangeMoves).toEqual([]);
    expect(calls.openChanges).toEqual([false]);
  });

  it("선택 모드 새 문서", async () => {
    const { calls } = setup({
      summary: "3장",
      initialTarget: "new-document",
      defaultLabel: null,
    });
    await submit();
    expect(calls.selectionMoves).toEqual([
      { kind: "new-document", label: null },
    ]);
  });

  it("알려진 실패 사유는 그 문구를 보이고 닫지 않는다", async () => {
    const { calls } = setup({
      outcomes: [{ ok: false, reason: "group_mismatch" }],
    });
    await submit();
    expect(alertText()).toBe(
      "페이지는 같은 파일 그룹 안에서만 옮길 수 있습니다.",
    );
    expect(calls.rangeMoves).toHaveLength(1);
    expect(calls.openChanges).toEqual([]);
    expect(dialog()).not.toBeNull();
  });

  it("모르는 실패 사유는 generic 문구에 코드를 넣는다", async () => {
    setup({
      summary: "3장",
      outcomes: [{ ok: false, reason: "future_reason" as DropReason }],
    });
    await submit();
    expect(alertText()).toBe("이 변경을 적용하지 못했습니다(future_reason).");
  });

  it("실패 뒤 다시 제출해 성공하면 닫는다", async () => {
    const { calls } = setup({
      outcomes: [{ ok: false, reason: "index_out_of_range" }, { ok: true }],
    });
    await submit();
    expect(alertText()).toBe("더 옮길 수 없습니다.");
    await submit();
    expect(calls.rangeMoves).toHaveLength(2);
    expect(calls.openChanges).toEqual([false]);
  });
});

describe("MovePagesDialog 닫기", () => {
  it("취소 버튼은 부르지 않고 닫는다", async () => {
    const { calls } = setup();
    await userEvent.click(byId("button-cancel"));
    expect(calls.rangeMoves).toEqual([]);
    expect(calls.openChanges).toEqual([false]);
    expect(dialog()).toBeNull();
  });

  it("Esc 는 부르지 않고 닫는다", async () => {
    const { calls } = setup();
    input("input-from").focus();
    await userEvent.keyboard("{Escape}");
    expect(calls.rangeMoves).toEqual([]);
    expect(calls.openChanges).toEqual([false]);
    expect(dialog()).toBeNull();
  });

  it("닫았다 다시 열면 입력·대상·위치·라벨·오류가 처음 상태다", async () => {
    setup();
    await retype("input-from", "3");
    await choose("select-target", "option-new-document");
    await choose("label-select", "option-label-Receipt");
    await choose("select-target", "option-doc-c");
    await userEvent.click(byId("radio-before"));
    await retype("input-before", "9");
    await submit();
    expect(alertText()).not.toBeNull();
    await userEvent.click(byId("button-cancel"));
    await userEvent.click(screen.getByTestId("opener"));
    expect(input("input-from")).toHaveValue("2");
    expect(input("input-to")).toHaveValue("2");
    expect(byId("select-target")).toHaveTextContent("문서 3 (Invoice)");
    expect((byId("radio-end") as HTMLInputElement).checked).toBe(true);
    expect(queryById("input-before")).toBeNull();
    expect(alertText()).toBeNull();
    await choose("select-target", "option-new-document");
    expect(byId("label-select")).toHaveTextContent("Invoice");
  });
});
