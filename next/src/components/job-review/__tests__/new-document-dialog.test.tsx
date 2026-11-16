import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import {
  NewDocumentDialog,
  type NewDocumentDialogProps,
} from "../new-document-dialog";
import type { StructureActions } from "../use-structure-actions";

const TEST_ID = "job-review-new-document";

type AddDocumentInput = Parameters<StructureActions["onAddDocument"]>[0];
type Outcome = ReturnType<StructureActions["onAddDocument"]>;

const FILE_OPTIONS = [
  { fileRef: "file-1", name: "a.pdf" },
  { fileRef: "file-2", name: "b.pdf" },
];

interface SetupOptions {
  labelChoices?: readonly string[] | null;
  /** 첫 범위 행의 글자(기본은 읽을 수 있는 "2"). */
  rangeText?: string;
  outcomes?: Outcome[];
}

function setup({
  labelChoices = ["Invoice", "Receipt"],
  rangeText = "2",
  outcomes = [{ ok: true, documentId: "doc-new" }],
}: SetupOptions = {}) {
  const creates: AddDocumentInput[] = [];
  const openChanges: boolean[] = [];
  let count = 0;
  const onCreate: NewDocumentDialogProps["onCreate"] = input => {
    creates.push(input);
    return outcomes[Math.min(count++, outcomes.length - 1)]!;
  };

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
        <NewDocumentDialog
          open={open}
          onOpenChange={value => {
            openChanges.push(value);
            setOpen(value);
          }}
          groupId="grp-1"
          fileOptions={FILE_OPTIONS}
          labelChoices={labelChoices}
          afterDocumentId="doc-a"
          initialRow={{ fileRef: "file-1", text: rangeText }}
          onCreate={onCreate}
        />
      </>
    );
  }

  const view = renderWithIntl(<Harness />);
  return { ...view, creates, openChanges };
}

const byId = (suffix: string) => screen.getByTestId(`${TEST_ID}-${suffix}`);
const queryById = (suffix: string) =>
  screen.queryByTestId(`${TEST_ID}-${suffix}`);
const dialog = () => screen.queryByTestId(`${TEST_ID}-dialog`);
const labelInput = () => byId("label-input") as HTMLInputElement;
const rangeInput = () => byId("ranges-input-range") as HTMLInputElement;
const alertText = () => screen.queryByRole("alert")?.textContent ?? null;
const submit = () => userEvent.click(byId("button-create"));

/** Radix Select 를 키보드로 열어 항목 목록을 돌려준다. */
async function openSelect() {
  byId("label-select").focus();
  await userEvent.keyboard("{Enter}");
  return screen.getAllByRole("option");
}

async function choose(optionSuffix: string) {
  await openSelect();
  await userEvent.click(byId(optionSuffix));
}

const INVALID_RANGES = '"1-3, 5" 처럼 읽을 수 있는 페이지 범위를 적으세요.';

describe("NewDocumentDialog DOM", () => {
  it("라벨 select(설정 라벨 있음)", () => {
    setup();
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });

  it("라벨 자유 입력(labelChoices null)", () => {
    setup({ labelChoices: null });
    expect(snapshotHtml(dialog())).toMatchSnapshot();
  });
});

describe("NewDocumentDialog 라벨 칸", () => {
  it("select 트리거는 w-full 이고 처음 값은 (라벨 없음)", () => {
    setup();
    const trigger = byId("label-select");
    expect(trigger).toHaveClass("w-full");
    expect(trigger).toHaveTextContent("(라벨 없음)");
    expect(queryById("label-input")).toBeNull();
    expect(screen.getByLabelText("라벨")).toBe(trigger);
  });

  it("select 항목은 (라벨 없음) 이 늘 맨 앞, 그 뒤 설정 라벨 순서", async () => {
    setup();
    const options = await openSelect();
    expect(options.map(option => option.textContent)).toEqual([
      "(라벨 없음)",
      "Invoice",
      "Receipt",
    ]);
    expect(options.map(option => option.getAttribute("data-testid"))).toEqual([
      `${TEST_ID}-option-no-label`,
      `${TEST_ID}-option-label-Invoice`,
      `${TEST_ID}-option-label-Receipt`,
    ]);
  });

  it("라벨을 고른 뒤에도 (라벨 없음) 항목이 남는다", async () => {
    setup();
    await choose("option-label-Receipt");
    expect(byId("label-select")).toHaveTextContent("Receipt");
    const options = await openSelect();
    expect(options.map(option => option.textContent)).toEqual([
      "(라벨 없음)",
      "Invoice",
      "Receipt",
    ]);
  });

  it("숨은 native select 의 없음 값은 \\u0000none", () => {
    setup();
    const native = dialog()!.querySelector("select")!;
    expect([...native.options].map(option => option.value)).toEqual([
      "\u0000none",
      "Invoice",
      "Receipt",
    ]);
    expect(native.value).toBe("\u0000none");
  });

  it("자유 입력 칸: 빈 값·placeholder·maxLength 200", () => {
    setup({ labelChoices: null });
    const input = labelInput();
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "(라벨 없음)");
    expect(input).toHaveAttribute("maxlength", "200");
    expect(input).not.toBeDisabled();
    expect(queryById("label-select")).toBeNull();
    expect(screen.getByLabelText("라벨")).toBe(input);
  });
});

describe("NewDocumentDialog 제출 값", () => {
  it("select 로 고른 라벨을 보낸다", async () => {
    const { creates, openChanges } = setup();
    await choose("option-label-Invoice");
    await submit();
    expect(creates).toEqual([
      {
        groupId: "grp-1",
        label: "Invoice",
        sourceFiles: [{ file_ref: "file-1", page_ranges: [[2, 2]] }],
        afterDocumentId: "doc-a",
      },
    ]);
    expect(openChanges).toEqual([false]);
    expect(dialog()).toBeNull();
  });

  it("고르지 않으면 label null", async () => {
    const { creates } = setup();
    await submit();
    expect(creates.map(input => input.label)).toEqual([null]);
  });

  it("라벨을 골랐다가 (라벨 없음) 으로 돌리면 label null", async () => {
    const { creates } = setup();
    await choose("option-label-Receipt");
    await choose("option-no-label");
    expect(byId("label-select")).toHaveTextContent("(라벨 없음)");
    await submit();
    expect(creates.map(input => input.label)).toEqual([null]);
  });

  it.each([
    ["  Memo  ", "Memo"],
    ["Memo", "Memo"],
    ["   ", null],
    ["", null],
  ])("자유 입력 %j 은 다듬어 %j 로 보낸다", async (text, label) => {
    const { creates } = setup({ labelChoices: null });
    if (text !== "") await userEvent.type(labelInput(), text);
    expect(labelInput()).toHaveValue(text);
    await submit();
    expect(creates.map(input => input.label)).toEqual([label]);
  });
});

describe("NewDocumentDialog 오류와 라벨", () => {
  it("범위 오류는 라벨을 바꿔도 남고 범위를 고치면 사라진다(select)", async () => {
    const { creates } = setup({ rangeText: "" });
    await submit();
    expect(creates).toEqual([]);
    expect(alertText()).toBe(INVALID_RANGES);
    await choose("option-label-Receipt");
    expect(alertText()).toBe(INVALID_RANGES);
    await userEvent.type(rangeInput(), "1");
    expect(alertText()).toBeNull();
  });

  it("범위 오류는 라벨을 입력해도 남는다(자유 입력)", async () => {
    setup({ labelChoices: null, rangeText: "" });
    await submit();
    expect(alertText()).toBe(INVALID_RANGES);
    await userEvent.type(labelInput(), "Memo");
    expect(alertText()).toBe(INVALID_RANGES);
  });

  it("만들기 실패 사유는 라벨을 바꿔도 남는다", async () => {
    const { creates } = setup({
      outcomes: [{ ok: false, reason: "target_missing" }],
    });
    await submit();
    expect(creates).toHaveLength(1);
    expect(alertText()).toBe("옮길 자리를 찾지 못했습니다.");
    expect(dialog()).not.toBeNull();
    await choose("option-label-Invoice");
    expect(alertText()).toBe("옮길 자리를 찾지 못했습니다.");
  });
});

describe("NewDocumentDialog 다시 열기", () => {
  it("취소 뒤 다시 열면 라벨은 처음 상태(select)", async () => {
    const { openChanges } = setup();
    await choose("option-label-Receipt");
    await userEvent.click(byId("button-cancel"));
    expect(openChanges).toEqual([false]);
    expect(dialog()).toBeNull();
    await userEvent.click(screen.getByTestId("opener"));
    expect(byId("label-select")).toHaveTextContent("(라벨 없음)");
  });

  it("취소 뒤 다시 열면 라벨은 처음 상태(자유 입력)", async () => {
    setup({ labelChoices: null });
    await userEvent.type(labelInput(), "Memo");
    await userEvent.click(byId("button-cancel"));
    await userEvent.click(screen.getByTestId("opener"));
    expect(labelInput()).toHaveValue("");
  });
});
