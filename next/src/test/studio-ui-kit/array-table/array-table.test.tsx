import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  ArrayTable,
  type ArrayTableCell,
  type ArrayTableColumn,
  type ArrayTableProps,
  type ArrayTableRow,
} from "@/components/studio-ui-kit/array-table/array-table";

const TEST_ID = "at";
const LABELS = { itemNumber: "번호", itemActions: "동작" };

const COLUMNS: ArrayTableColumn[] = [
  { key: "name", title: "품명", description: "품목 이름" },
  { key: "qty", title: "수량" },
];

function row(
  index: number,
  cells: Record<string, Partial<ArrayTableCell<string>> | undefined>,
  extra: Partial<ArrayTableRow<string>> = {},
): ArrayTableRow<string> {
  return {
    index,
    number: index + 1,
    nodeId: `node-${index}`,
    cells: Object.fromEntries(
      Object.entries(cells).map(([key, cell]) => [
        key,
        cell === undefined
          ? undefined
          : {
              value: "",
              fieldId: `field-${index}-${key}`,
              pointer: `/items/${index}/${key}`,
              ...cell,
            },
      ]),
    ),
    ...extra,
  };
}

const ROWS = [
  row(0, { name: { value: "사과" }, qty: { value: "1" } }),
  row(1, { name: { value: "배" }, qty: undefined }),
];

type Errors = Record<string, ((message: string | null) => void) | undefined>;

/** 가짜 편집기: native 입력. 칸마다 `onError` 를 모아 테스트가 부른다. */
function setup(overrides: Partial<ArrayTableProps<string>> = {}) {
  const errors: Errors = {};
  const view = render(
    <ArrayTable<string>
      columns={COLUMNS}
      rows={ROWS}
      labels={LABELS}
      testId={TEST_ID}
      renderCell={(r, column, cell, ctx) => {
        errors[`${r.index}/${column.key}`] = ctx.onError;
        return (
          <input
            id={ctx.id}
            defaultValue={cell.value}
            aria-invalid={ctx.invalid || undefined}
            aria-describedby={ctx.describedBy}
            data-testid={`input-${r.index}-${column.key}`}
          />
        );
      }}
      {...overrides}
    />,
  );
  return { ...view, errors };
}

const cellOf = (container: HTMLElement, index: number, key: string) =>
  container.querySelector(`[data-field-id="field-${index}-${key}"]`)!;

describe("ArrayTable 머리·행", () => {
  it("번호 열·열 머리(title 은 설명)·동작 열", () => {
    setup();
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map(head => head.textContent)).toEqual([
      "#번호",
      "품명",
      "수량",
      "동작",
    ]);
    expect(heads[1]).toHaveAttribute("title", "품목 이름");
    expect(heads[2]).not.toHaveAttribute("title");
  });

  it("행마다 번호와 data-node-id", () => {
    const { container } = setup();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-node-id", "node-0");
    expect(screen.getAllByRole("rowheader").map(h => h.textContent)).toEqual([
      "1",
      "2",
    ]);
  });

  it("칸은 sr-only label 이 편집기 id 를 가리킨다", () => {
    setup();
    const input = screen.getByTestId("input-0-name");
    expect(screen.getAllByLabelText("품명")[0]).toBe(input);
    expect(input.id).not.toBe("");
  });

  it("nodeId·fieldId·pointer 가 없으면 속성이 없다", () => {
    const { container } = setup({
      rows: [{ index: 0, number: 1, cells: { name: { value: "a" } } }],
    });
    expect(container.querySelector("tbody tr")).not.toHaveAttribute(
      "data-node-id",
    );
    const td = screen.getByTestId("input-0-name").closest("td")!;
    expect(td).not.toHaveAttribute("data-field-id");
    expect(td).not.toHaveAttribute("data-pointer");
  });
});

describe("ArrayTable 칸 상태", () => {
  it("selected·changed·dimmed 의 class 와 data 속성", () => {
    const { container } = setup({
      rows: [
        row(0, {
          name: { value: "a", selected: true, changed: true },
          qty: { value: "1", changed: true, dimmed: true },
        }),
      ],
    });
    const name = cellOf(container, 0, "name");
    const qty = cellOf(container, 0, "qty");
    expect(name).toHaveAttribute("data-selected", "true");
    expect(name).toHaveAttribute("data-changed", "true");
    expect(name).toHaveClass("bg-muted/70");
    expect(name).not.toHaveClass("bg-primary/5");
    expect(qty).not.toHaveAttribute("data-selected");
    expect(qty).toHaveClass("bg-primary/5", "opacity-50");
  });

  it("상태가 없으면 data 속성도 바탕 class 도 없다", () => {
    const { container } = setup();
    const name = cellOf(container, 0, "name");
    expect(name).not.toHaveAttribute("data-selected");
    expect(name).not.toHaveAttribute("data-changed");
    expect(name).not.toHaveAttribute("title");
    expect(name.className).toBe(
      "min-w-24 px-1 py-1 align-top transition-colors motion-reduce:transition-none",
    );
  });

  it("title 을 칸에 붙인다", () => {
    const { container } = setup({
      rows: [row(0, { name: { value: "a", title: "원본: b" } })],
    });
    expect(cellOf(container, 0, "name")).toHaveAttribute("title", "원본: b");
  });
});

describe("ArrayTable 오류·경고", () => {
  it("error 는 role=alert 문구와 편집기 invalid·describedBy", () => {
    setup({ rows: [row(0, { name: { value: "a", error: "필수" } })] });
    const message = screen.getByTestId(`${TEST_ID}-cell-error`);
    expect(message).toHaveAttribute("role", "alert");
    expect(message).toHaveTextContent("필수");
    const input = screen.getByTestId("input-0-name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", message.id);
    expect(message.id).toBe(`${input.id}-error`);
  });

  it("warning 은 오류가 없을 때만, role 없이", () => {
    setup({ rows: [row(0, { name: { value: "a", warning: "확인" } })] });
    const message = screen.getByTestId(`${TEST_ID}-cell-warning`);
    expect(message).not.toHaveAttribute("role");
    const input = screen.getByTestId("input-0-name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("aria-describedby", `${input.id}-warning`);
  });

  it("error 와 warning 이 같이 오면 error 만", () => {
    setup({
      rows: [row(0, { name: { value: "a", error: "오류", warning: "경고" } })],
    });
    expect(screen.getByTestId(`${TEST_ID}-cell-error`)).toHaveTextContent(
      "오류",
    );
    expect(screen.queryByTestId(`${TEST_ID}-cell-warning`)).toBeNull();
  });

  it("편집기 오류가 밖의 오류보다 먼저다", async () => {
    const { errors } = setup({
      rows: [row(0, { name: { value: "a", error: "밖" } })],
    });
    await act(() => errors["0/name"]!("숫자가 아님"));
    expect(screen.getByTestId(`${TEST_ID}-cell-error`)).toHaveTextContent(
      "숫자가 아님",
    );
  });

  it("편집기 오류는 그때의 값에 묶여, 값이 바뀌면 사라진다", async () => {
    const view = setup({ rows: [row(0, { name: { value: "a" } })] });
    await act(() => view.errors["0/name"]!("거부"));
    expect(screen.getByTestId(`${TEST_ID}-cell-error`)).toHaveTextContent(
      "거부",
    );
    view.rerender(
      <ArrayTable<string>
        columns={COLUMNS}
        rows={[row(0, { name: { value: "b" } })]}
        labels={LABELS}
        testId={TEST_ID}
        renderCell={(_r, _c, cell, ctx) => (
          <input id={ctx.id} defaultValue={cell.value} />
        )}
      />,
    );
    expect(screen.queryByTestId(`${TEST_ID}-cell-error`)).toBeNull();
  });

  it("valueEquals 로 같은 값이면 편집기 오류를 유지한다", async () => {
    const valueEquals = (a: string, b: string) =>
      a.toLowerCase() === b.toLowerCase();
    const view = setup({
      rows: [row(0, { name: { value: "a" } })],
      valueEquals,
    });
    await act(() => view.errors["0/name"]!("거부"));
    view.rerender(
      <ArrayTable<string>
        columns={COLUMNS}
        rows={[row(0, { name: { value: "A" } })]}
        labels={LABELS}
        testId={TEST_ID}
        valueEquals={valueEquals}
        renderCell={(_r, _c, cell, ctx) => (
          <input id={ctx.id} defaultValue={cell.value} />
        )}
      />,
    );
    expect(screen.getByTestId(`${TEST_ID}-cell-error`)).toHaveTextContent(
      "거부",
    );
  });

  it("onError(null) 이면 편집기 오류를 지운다", async () => {
    const view = setup({ rows: [row(0, { name: { value: "a" } })] });
    await act(() => view.errors["0/name"]!("거부"));
    await act(() => view.errors["0/name"]!(null));
    expect(screen.queryByTestId(`${TEST_ID}-cell-error`)).toBeNull();
  });

  it("renderRowError 가 내용을 주면 다음 줄에 colSpan = 열 + 2", () => {
    const { container } = setup({
      renderRowError: r => (r.index === 0 ? <span>항목 오류</span> : null),
    });
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    const td = rows[1]!.querySelector("td")!;
    expect(td).toHaveAttribute("colspan", String(COLUMNS.length + 2));
    expect(td).toHaveTextContent("항목 오류");
  });
});

describe("ArrayTable ＋·되돌리기 버튼", () => {
  it("cells 에 없는 열은 빈 칸, 기본 ＋ 버튼은 콜백과 문구가 다 있을 때만", () => {
    const added: [number, string][] = [];
    const { rerender } = setup({
      onAddCell: (index, key) => added.push([index, key]),
    });
    expect(screen.queryByTestId(`${TEST_ID}-button-add-cell`)).toBeNull();
    rerender(
      <ArrayTable<string>
        columns={COLUMNS}
        rows={ROWS}
        labels={{ ...LABELS, addCell: column => `${column} 넣기` }}
        testId={TEST_ID}
        renderCell={() => null}
        onAddCell={(index, key) => added.push([index, key])}
      />,
    );
    const button = screen.getByTestId(`${TEST_ID}-button-add-cell`);
    expect(button).toHaveAccessibleName("수량 넣기");
    fireEvent.click(button);
    expect(added).toEqual([[1, "qty"]]);
  });

  it("문구만 있고 콜백이 없으면 ＋ 버튼이 없다", () => {
    setup({ labels: { ...LABELS, addCell: c => c } });
    expect(screen.queryByTestId(`${TEST_ID}-button-add-cell`)).toBeNull();
  });

  it("renderAddCellButton 이 있으면 콜백 없이도 slot 을 그린다", () => {
    setup({
      renderAddCellButton: (r, column) => (
        <button type="button" data-testid="slot-add">
          {r.index}:{column.key}
        </button>
      ),
    });
    expect(screen.getByTestId("slot-add")).toHaveTextContent("1:qty");
    expect(screen.queryByTestId(`${TEST_ID}-button-add-cell`)).toBeNull();
  });

  it("revertable 칸에만 기본 되돌리기(콜백 + 문구)", () => {
    const reverted: [number, string][] = [];
    setup({
      rows: [
        row(0, {
          name: { value: "a", changed: true, revertable: true },
          qty: { value: "1", changed: true },
        }),
      ],
      labels: { ...LABELS, revertCell: column => `${column} 되돌리기` },
      onRevertCell: (index, key) => reverted.push([index, key]),
    });
    const buttons = screen.getAllByTestId(`${TEST_ID}-button-revert`);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("품명 되돌리기");
    fireEvent.click(buttons[0]!);
    expect(reverted).toEqual([[0, "name"]]);
  });

  it("되돌리기 콜백만 있으면 버튼이 없다", () => {
    setup({
      rows: [row(0, { name: { value: "a", revertable: true } })],
      onRevertCell: () => {},
    });
    expect(screen.queryByTestId(`${TEST_ID}-button-revert`)).toBeNull();
  });

  it("renderRevertButton 이 기본 버튼을 덮는다", () => {
    setup({
      rows: [row(0, { name: { value: "a", revertable: true } })],
      labels: { ...LABELS, revertCell: c => c },
      onRevertCell: () => {},
      renderRevertButton: () => <button type="button">slot</button>,
    });
    expect(screen.getByRole("button", { name: "slot" })).toBeInTheDocument();
    expect(screen.queryByTestId(`${TEST_ID}-button-revert`)).toBeNull();
  });

  it("disabled 면 기본 버튼 둘이 비활성", () => {
    setup({
      disabled: true,
      rows: [
        row(0, {
          name: { value: "a", revertable: true },
          qty: undefined,
        }),
      ],
      labels: { ...LABELS, addCell: c => c, revertCell: c => c },
      onAddCell: () => {},
      onRevertCell: () => {},
    });
    expect(screen.getByTestId(`${TEST_ID}-button-add-cell`)).toBeDisabled();
    expect(screen.getByTestId(`${TEST_ID}-button-revert`)).toBeDisabled();
  });
});

describe("ArrayTable slot·콜백", () => {
  it("renderCellActions 는 되돌리기 뒤, renderRowActions 는 행 끝 칸", () => {
    const { container } = setup({
      rows: [row(0, { name: { value: "a", revertable: true } })],
      renderRevertButton: () => <button type="button">되돌리기</button>,
      renderCellActions: (_r, column) => (
        <button type="button">{column.key} 메뉴</button>
      ),
      renderRowActions: r => <button type="button">{r.number} 행 메뉴</button>,
    });
    const cellButtons = cellOf(container, 0, "name").querySelectorAll("button");
    expect(Array.from(cellButtons).map(b => b.textContent)).toEqual([
      "되돌리기",
      "name 메뉴",
    ]);
    const cells = container.querySelectorAll("tbody tr > td");
    expect(cells[cells.length - 1]).toHaveTextContent("1 행 메뉴");
  });

  it("highlighted 칸만 focus·hover 콜백을 부른다", () => {
    const calls: string[] = [];
    const { container } = setup({
      rows: [
        row(0, {
          name: { value: "a", highlighted: true },
          qty: { value: "1" },
        }),
      ],
      onCellFocus: (index, key) => calls.push(`focus ${index} ${key}`),
      onCellHover: (index, key, hovered) =>
        calls.push(`hover ${index} ${key} ${hovered}`),
    });
    fireEvent.focus(screen.getByTestId("input-0-name"));
    fireEvent.pointerEnter(cellOf(container, 0, "name"));
    fireEvent.pointerLeave(cellOf(container, 0, "name"));
    fireEvent.focus(screen.getByTestId("input-0-qty"));
    fireEvent.pointerEnter(cellOf(container, 0, "qty"));
    expect(calls).toEqual([
      "focus 0 name",
      "hover 0 name true",
      "hover 0 name false",
    ]);
  });
});

describe("ArrayTable 루트", () => {
  it("testId 가 없으면 testid 가 하나도 없다", () => {
    const { container } = setup({
      testId: undefined,
      rows: [
        row(0, { name: { value: "a", error: "e", revertable: true } }),
        row(1, { name: { value: "b", warning: "w" }, qty: undefined }),
      ],
      labels: { ...LABELS, addCell: c => c, revertCell: c => c },
      onAddCell: () => {},
      onRevertCell: () => {},
    });
    const tagged = Array.from(
      container.querySelectorAll("[data-testid]"),
    ).filter(el => !el.getAttribute("data-testid")!.startsWith("input-"));
    expect(tagged).toHaveLength(0);
  });

  it("나머지 div props 는 루트로, 내부 testid·class 가 이긴다", () => {
    const { container } = setup({
      id: "root",
      className: "extra",
      ...({ "data-testid": "outer" } as object),
    });
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute("id", "root");
    expect(root).toHaveAttribute("data-testid", TEST_ID);
    expect(root.className).toBe(
      "relative max-h-[60vh] min-w-0 overflow-auto extra",
    );
  });
});

describe("ArrayTable DOM 계약", () => {
  const ROW_ATTRIBUTES = [["tr", "data-node-id", "node-0"]] as const;
  const CELL_ATTRIBUTES = [
    ["data-field-id", "field-0-name"],
    ["data-pointer", "/items/0/name"],
    ["data-selected", "true"],
    ["data-changed", "true"],
  ] as const;
  const TEST_ID_SUFFIXES = [
    "button-add-cell",
    "button-revert",
    "cell-error",
    "cell-warning",
  ] as const;

  it("행·칸 data 속성", () => {
    const { container } = setup({
      rows: [row(0, { name: { value: "a", selected: true, changed: true } })],
    });
    for (const [tag, name, value] of ROW_ATTRIBUTES) {
      expect(container.querySelector(`tbody ${tag}`)).toHaveAttribute(
        name,
        value,
      );
    }
    const td = screen.getByTestId("input-0-name").closest("td")!;
    for (const [name, value] of CELL_ATTRIBUTES) {
      expect(td).toHaveAttribute(name, value);
    }
  });

  it("루트 testid 는 루트 div, 하위는 접미", () => {
    const { container } = setup({
      rows: [
        row(0, { name: { value: "a", error: "e", revertable: true } }),
        row(1, { name: { value: "b", warning: "w" }, qty: undefined }),
      ],
      labels: { ...LABELS, addCell: c => c, revertCell: c => c },
      onAddCell: () => {},
      onRevertCell: () => {},
    });
    expect(container.firstElementChild).toHaveAttribute("data-testid", TEST_ID);
    expect(container.firstElementChild!.tagName).toBe("DIV");
    for (const suffix of TEST_ID_SUFFIXES) {
      expect(
        screen.getAllByTestId(`${TEST_ID}-${suffix}`).length,
      ).toBeGreaterThan(0);
    }
  });
});
