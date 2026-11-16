import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type {
  JsonObject,
  JsonPath,
  JsonValue,
  PairedHighlight,
  Result,
  ReviewStep,
} from "@/lib/review-model";
import ko from "@/messages/ko.json";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import { ContentTree, type ValueEdit } from "../content-tree";
import type { FieldError } from "../field-errors";

// 배열 표는 값 트리(`ContentTree`)가 객체 배열을 만나면 그린다. 표가 트리 context 를 읽으므로 표를
// 직접 그리지 않고 트리를 그린다. 칸·행은 `data-field-id`·`data-node-id` 와 입력 표식
// `data-field-input` 으로 찾는다(편집 뒤 포커스 예약과 Enter 다음 칸 이동이 쓰는 계약).

const T = ko.review.values.tree;
const RESULT_ID = "res_1";
const TABLE = "job-review-tree-table";

const SCHEMA: JsonObject = {
  type: "object",
  properties: {
    items: {
      type: "array",
      title: "품목",
      minItems: 1,
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", title: "품명", description: "품목 이름" },
          qty: { type: "number", title: "수량" },
          price: { type: ["number", "null"], title: "단가" },
          memo: { type: "string", title: "메모" },
          note: { type: "string", title: "비고" },
        },
      },
    },
  },
};

/** 항목 3 개. 0 번은 `memo` 가 없고(＋ 칸), 2 번은 키 순서가 schema 와 다르다. `note` 는 어느 항목에도 없다. */
function itemsOf(): JsonObject[] {
  return [
    { name: "사과", qty: 1, price: 100 },
    { name: "배", qty: 2, price: null, memo: "메모" },
    { price: 300, qty: 3, name: "감", memo: "" },
  ];
}

const STEP: ReviewStep = {
  config_id: "cfg_extract",
  name: "추출",
  type: "information-extract",
  schema: SCHEMA,
};

function resultOf(items: JsonValue[]): Result {
  return {
    id: RESULT_ID,
    step_id: "st_extract",
    base_version: 1,
    content: { items },
    state: "present",
    link: { kind: "none" },
  };
}

function highlightOf(pointer: string): PairedHighlight {
  return {
    id: `${RESULT_ID}#${pointer}`,
    pointer,
    _value: "",
    page: 1,
    coordinates: [],
    viewerIndex: 0,
    value: null,
  };
}

const fieldId = (pointer: string) => `${RESULT_ID}#${pointer}`;

function cell(pointer: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-field-id="${fieldId(pointer)}"]`,
  );
  if (!element) throw new Error(`no cell ${pointer}`);
  return element;
}

function cellInput(pointer: string): HTMLInputElement {
  const input =
    cell(pointer).querySelector<HTMLInputElement>("[data-field-input]");
  if (!input) throw new Error(`no input in ${pointer}`);
  return input;
}

function row(pointer: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `tr[data-node-id="${fieldId(pointer)}"]`,
  );
  if (!element) throw new Error(`no row ${pointer}`);
  return element;
}

/** 지금 포커스가 있는 칸의 pointer(칸 밖이면 null). */
function focusedCell(): string | null {
  const id =
    document.activeElement
      ?.closest("[data-field-id]")
      ?.getAttribute("data-field-id") ?? null;
  return id === null ? null : id.slice(RESULT_ID.length + 1);
}

function setIn(root: JsonValue, path: JsonPath, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string, ...string[]];
  if (Array.isArray(root)) {
    const next = [...root];
    next[Number(head)] = setIn(next[Number(head)] ?? null, rest, value);
    return next;
  }
  const object = root as JsonObject;
  return { ...object, [head]: setIn(object[head] ?? null, rest, value) };
}

function getIn(root: JsonValue, path: JsonPath): JsonValue | undefined {
  let at: JsonValue | undefined = root;
  for (const key of path) {
    if (Array.isArray(at)) at = at[Number(key)];
    else if (at !== null && typeof at === "object")
      at = Object.hasOwn(at, key) ? (at as JsonObject)[key] : undefined;
    else return undefined;
  }
  return at;
}

/** 테스트 Harness 가 쓰는 만큼의 값 편집 적용. */
function applyEdit(content: JsonValue, edit: ValueEdit): JsonValue {
  const at = getIn(content, edit.path);
  switch (edit.kind) {
    case "set_key":
      return setIn(content, edit.path, {
        ...(at as JsonObject),
        [edit.key]: edit.value,
      });
    case "remove_key": {
      const next = { ...(at as JsonObject) };
      delete next[edit.key];
      return setIn(content, edit.path, next);
    }
    case "remove_item":
      return setIn(
        content,
        edit.path,
        (at as JsonValue[]).filter((_, index) => index !== edit.index),
      );
    case "move_item": {
      const items = [...(at as JsonValue[])];
      const [moved] = items.splice(edit.from, 1);
      items.splice(edit.to, 0, moved ?? null);
      return setIn(content, edit.path, items);
    }
    default:
      throw new Error(`unsupported edit ${edit.kind}`);
  }
}

interface SetupOptions {
  items?: JsonObject[];
  /** 처음(기계) 값의 항목. `null` 이면 처음 결과 없음. 기본은 `items` 와 같다. */
  base?: JsonObject[] | null;
  errors?: Record<string, FieldError>;
  highlights?: readonly string[];
  selected?: string | null;
  /** 필터가 켜졌을 때 보이는 노드 pointer. */
  visible?: readonly string[] | null;
  locked?: boolean;
}

interface Calls {
  applies: [string, JsonPath, JsonValue][];
  reverts: [string, JsonPath][];
  edits: ValueEdit[];
  selected: string[];
  hovered: (string | null)[];
}

/**
 * 값 트리를 그린다. `onApply`·`onEdit`·`onRevert` 는 기록하고 내용에 실제로 반영해 다시 그린다.
 * `setItems` 로 밖에서 내용을 바꾼다(다른 경로의 편집처럼).
 */
function setup(options: SetupOptions = {}) {
  const items = options.items ?? itemsOf();
  const base =
    options.base === null ? undefined : resultOf(options.base ?? items);
  const errors = new Map(Object.entries(options.errors ?? {}));
  const errorPointers = [...errors.keys()];
  const highlights = new Map(
    (options.highlights ?? []).map(pointer => [pointer, highlightOf(pointer)]),
  );
  const visibleNodes =
    options.visible === undefined || options.visible === null
      ? null
      : new Set(options.visible);
  const calls: Calls = {
    applies: [],
    reverts: [],
    edits: [],
    selected: [],
    hovered: [],
  };
  let setItems: (next: JsonValue[]) => void = () => {};

  function Harness() {
    const [content, setContent] = useState<JsonValue>({ items });
    setItems = next => setContent({ items: next });
    return (
      <div data-value-panel="">
        <ContentTree
          result={{ ...resultOf([]), content }}
          baseResult={base}
          step={STEP}
          locked={options.locked ?? false}
          highlights={highlights}
          selectedHighlightId={
            options.selected ? fieldId(options.selected) : null
          }
          errors={errors}
          errorPointers={errorPointers}
          visibleNodes={visibleNodes}
          onSelectHighlight={highlight => calls.selected.push(highlight.id)}
          onHoverHighlight={id => calls.hovered.push(id)}
          onApply={(resultId, path, value) => {
            calls.applies.push([resultId, path, value]);
            setContent(current => setIn(current, path, value));
          }}
          onRevert={(resultId, path) => {
            calls.reverts.push([resultId, path]);
            setContent(current =>
              setIn(current, path, getIn(base?.content ?? null, path) ?? null),
            );
          }}
          onEdit={(_, edit) => {
            calls.edits.push(edit);
            setContent(current => applyEdit(current, edit));
          }}
        />
      </div>
    );
  }

  const view = renderWithIntl(<Harness />);
  return {
    ...view,
    calls,
    table: () => screen.getByTestId(TABLE),
    setItems: (next: JsonValue[]) => act(() => setItems(next)),
  };
}

describe("배열 표 기본 모양", () => {
  it("열 머리는 schema 순서·제목·설명, 번호 열과 동작 열은 화면 낭독기 문구", () => {
    const { table } = setup();
    const heads = [...table().querySelectorAll("thead th")];
    expect(heads.map(head => head.textContent)).toEqual([
      `#${T.itemNumber}`,
      "품명",
      "수량",
      "단가",
      "메모",
      T.itemActions,
    ]);
    expect(heads[1]).toHaveAttribute("title", "품목 이름");
    expect(heads[2]).not.toHaveAttribute("title");
    expect(heads.every(head => head.getAttribute("scope") === "col")).toBe(
      true,
    );
    expect(table().querySelector("thead")).toHaveClass("sticky");
  });

  it("행은 data-node-id, 칸은 data-field-id·data-pointer 를 단다", () => {
    const { table } = setup();
    const rows = [...table().querySelectorAll("tbody tr")];
    expect(rows.map(tr => tr.getAttribute("data-node-id"))).toEqual([
      fieldId("/items/0"),
      fieldId("/items/1"),
      fieldId("/items/2"),
    ]);
    expect(
      rows.map(tr => tr.querySelector("th[scope=row]")?.textContent),
    ).toEqual(["1", "2", "3"]);
    // 2 번 항목은 키 순서가 달라도 열 순서로 그린다.
    expect(
      [...rows[2]!.querySelectorAll("td[data-field-id]")].map(td =>
        td.getAttribute("data-pointer"),
      ),
    ).toEqual([
      "/items/2/name",
      "/items/2/qty",
      "/items/2/price",
      "/items/2/memo",
    ]);
    expect(cell("/items/1/memo")).toHaveAttribute(
      "data-field-id",
      fieldId("/items/1/memo"),
    );
    expect(cell("/items/1/memo")).not.toHaveAttribute("data-selected");
    expect(cell("/items/1/memo")).not.toHaveAttribute("data-changed");
    expect(cell("/items/1/memo")).not.toHaveAttribute("title");
  });

  it("칸 입력은 열 이름을 sr-only label 로 갖고 data-field-input 표식을 단다", () => {
    setup();
    const input = cellInput("/items/0/qty");
    expect(screen.getAllByLabelText("수량")[0]).toBe(input);
    expect(input).toHaveAttribute(
      "data-testid",
      "job-review-field-input-value",
    );
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("행 끝 칸에 없는 필드 추가 메뉴(compact)와 행 메뉴를 둔다", () => {
    setup();
    const last = row("/items/0").lastElementChild!;
    expect(
      [...last.querySelectorAll("button")].map(button =>
        button.getAttribute("data-testid"),
      ),
    ).toEqual([
      "job-review-tree-button-add-field",
      "job-review-tree-button-menu",
    ]);
    expect(
      last.querySelector('[data-testid="job-review-tree-button-add-field"]'),
    ).toHaveAttribute("aria-label", T.addField.replace("{count}", "1"));
    expect(
      last.querySelector('[data-testid="job-review-tree-button-menu"]'),
    ).toHaveAttribute("aria-label", T.menu.replace("{field}", "1"));
  });

  it("칸 메뉴는 할 수 있는 조작이 있는 칸에만 있다(필수 품명 칸은 없음)", () => {
    setup();
    const menus = (pointer: string) =>
      cell(pointer).querySelectorAll(
        '[data-testid="job-review-tree-button-menu"]',
      ).length;
    expect(menus("/items/0/name")).toBe(0);
    expect(menus("/items/0/qty")).toBe(1);
    expect(menus("/items/0/price")).toBe(1);
    expect(
      cell("/items/0/price").querySelector(
        '[data-testid="job-review-tree-button-menu"]',
      ),
    ).toHaveAttribute("aria-label", T.menu.replace("{field}", "단가"));
  });

  it("스냅샷", () => {
    const { table } = setup();
    expect(snapshotHtml(table())).toMatchSnapshot();
  });
});

describe("배열 표 빠진 칸", () => {
  it("항목에 없는 열의 칸은 ＋ 버튼이다", () => {
    setup();
    const add = row("/items/0").querySelector(
      '[data-testid="job-review-tree-table-button-add-cell"]',
    );
    expect(add).not.toBeNull();
    expect(add).toHaveAttribute(
      "aria-label",
      T.addCellField.replace("{field}", "메모"),
    );
    expect(add?.closest("td")).not.toHaveAttribute("data-field-id");
    expect(
      screen.getAllByTestId("job-review-tree-table-button-add-cell"),
    ).toHaveLength(1);
  });

  it("＋ 를 누르면 그 필드를 넣는 편집이 나가고 새 칸의 입력에 포커스가 간다", async () => {
    const { calls } = setup();
    await userEvent.click(
      screen.getByTestId("job-review-tree-table-button-add-cell"),
    );
    expect(calls.edits).toEqual([
      { kind: "set_key", path: ["items", "0"], key: "memo", value: "" },
    ]);
    await waitFor(() => expect(cellInput("/items/0/memo")).toHaveFocus());
    expect(
      screen.queryByTestId("job-review-tree-table-button-add-cell"),
    ).toBeNull();
  });
});

describe("배열 표 바뀐 칸", () => {
  it("바뀐 칸은 data-changed·옅은 바탕·원본 값 title·되돌리기 버튼", async () => {
    const base = itemsOf();
    const items = itemsOf();
    items[0]!.qty = 5;
    const { calls } = setup({ items, base });
    const changed = cell("/items/0/qty");
    expect(changed).toHaveAttribute("data-changed", "true");
    expect(changed).toHaveClass("bg-primary/5");
    expect(changed).toHaveAttribute(
      "title",
      T.original.replace("{value}", "1"),
    );
    const revert = changed.querySelector(
      '[data-testid="job-review-tree-table-button-revert"]',
    );
    expect(revert).toHaveAttribute(
      "aria-label",
      T.revertCell.replace("{field}", "수량"),
    );
    expect(cell("/items/0/name")).not.toHaveAttribute("data-changed");
    expect(
      screen.getAllByTestId("job-review-tree-table-button-revert"),
    ).toHaveLength(1);
    await userEvent.click(revert!);
    expect(calls.reverts).toEqual([[RESULT_ID, ["items", "0", "qty"]]]);
    expect(cell("/items/0/qty")).not.toHaveAttribute("data-changed");
    expect(
      screen.queryByTestId("job-review-tree-table-button-revert"),
    ).toBeNull();
  });

  it('원본 값이 null 이면 title 은 "null" 글자다(빈 값 문구는 빈 글자일 때)', () => {
    const base = itemsOf();
    const items = itemsOf();
    items[1]!.price = 7;
    setup({ items, base });
    expect(cell("/items/1/price")).toHaveAttribute(
      "title",
      T.original.replace("{value}", "null"),
    );
  });

  it("원본 값이 빈 글자면 title 은 빈 값 문구", () => {
    const base = itemsOf();
    const items = itemsOf();
    items[2]!.memo = "새 메모";
    setup({ items, base });
    expect(cell("/items/2/memo")).toHaveAttribute(
      "title",
      T.original.replace("{value}", ko.review.values.empty),
    );
  });

  it("원본에 없던 칸은 바뀐 칸이지만 title·되돌리기 버튼이 없다", () => {
    const base = itemsOf();
    delete base[1]!.memo;
    setup({ base });
    const added = cell("/items/1/memo");
    expect(added).toHaveAttribute("data-changed", "true");
    expect(added).toHaveClass("bg-primary/5");
    expect(added).not.toHaveAttribute("title");
    expect(
      added.querySelector(
        '[data-testid="job-review-tree-table-button-revert"]',
      ),
    ).toBeNull();
  });

  it("처음 결과가 없으면 모든 칸이 바뀐 칸이고 되돌리기 버튼은 없다", () => {
    setup({ base: null });
    expect(cell("/items/0/name")).toHaveAttribute("data-changed", "true");
    expect(
      screen.queryByTestId("job-review-tree-table-button-revert"),
    ).toBeNull();
  });

  it("바뀐 칸 스냅샷", () => {
    const base = itemsOf();
    const items = itemsOf();
    items[0]!.qty = 5;
    setup({ items, base });
    expect(snapshotHtml(row("/items/0"))).toMatchSnapshot();
  });
});

describe("배열 표 선택·필터", () => {
  it("선택 칸은 data-selected·진한 바탕이 바뀐 칸 바탕보다 먼저다", () => {
    const base = itemsOf();
    const items = itemsOf();
    items[0]!.qty = 5;
    setup({ items, base, selected: "/items/0/qty" });
    const selected = cell("/items/0/qty");
    expect(selected).toHaveAttribute("data-selected", "true");
    expect(selected).toHaveAttribute("data-changed", "true");
    expect(selected).toHaveClass("bg-muted/70");
    expect(selected).not.toHaveClass("bg-primary/5");
    expect(cell("/items/0/name")).not.toHaveAttribute("data-selected");
  });

  it("필터 중에는 조건에 맞는 항목의 행만 그리고, 그 행의 맞지 않는 칸은 흐리게 둔다", () => {
    setup({
      visible: [
        "/items",
        "/items/0",
        "/items/0/name",
        "/items/2",
        "/items/2/qty",
      ],
    });
    const rows = [...screen.getByTestId(TABLE).querySelectorAll("tbody tr")];
    expect(rows.map(tr => tr.getAttribute("data-node-id"))).toEqual([
      fieldId("/items/0"),
      fieldId("/items/2"),
    ]);
    // 번호는 원래 위치다.
    expect(rows[1]!.querySelector("th")?.textContent).toBe("3");
    expect(cell("/items/0/name")).not.toHaveClass("opacity-50");
    expect(cell("/items/0/qty")).toHaveClass("opacity-50");
    expect(cell("/items/2/qty")).not.toHaveClass("opacity-50");
    expect(cell("/items/2/name")).toHaveClass("opacity-50");
  });
});

describe("배열 표 하이라이트", () => {
  it("하이라이트가 있는 칸은 포커스로 고르고 가리키면 hover 를 알린다", () => {
    const { calls } = setup({ highlights: ["/items/0/name"] });
    act(() => cellInput("/items/0/name").focus());
    expect(calls.selected).toEqual([fieldId("/items/0/name")]);
    fireEvent.pointerEnter(cell("/items/0/name"));
    fireEvent.pointerLeave(cell("/items/0/name"));
    expect(calls.hovered).toEqual([fieldId("/items/0/name"), null]);
  });

  it("하이라이트가 없는 칸은 아무것도 부르지 않는다", () => {
    const { calls } = setup({ highlights: ["/items/0/name"] });
    act(() => cellInput("/items/0/qty").focus());
    fireEvent.pointerEnter(cell("/items/0/qty"));
    fireEvent.pointerLeave(cell("/items/0/qty"));
    expect(calls.selected).toEqual([]);
    expect(calls.hovered).toEqual([]);
  });
});

describe("배열 표 칸 오류", () => {
  const ERROR: FieldError = { message: "수량 오류", severity: "error" };
  const WARNING: FieldError = { message: "품명 경고", severity: "warning" };

  it("오류는 role=alert 문구로, 입력에 aria-invalid·aria-describedby 로 잇는다", () => {
    setup({ errors: { "/items/1/qty": ERROR } });
    const message = screen.getByTestId("job-review-tree-table-cell-error");
    expect(message).toHaveAttribute("role", "alert");
    expect(message).toHaveTextContent("수량 오류");
    expect(cell("/items/1/qty")).toContainElement(message);
    const input = cellInput("/items/1/qty");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(message.id).toBe(`${input.id}-error`);
  });

  it("경고는 흐린 문구로 잇고 aria-invalid 는 없다", () => {
    setup({ errors: { "/items/2/name": WARNING } });
    const message = screen.getByTestId("job-review-tree-table-cell-warning");
    expect(message).not.toHaveAttribute("role");
    expect(message).toHaveClass("text-muted-foreground");
    const input = cellInput("/items/2/name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-warning`);
    expect(message.id).toBe(`${input.id}-warning`);
  });

  it("위젯이 거부한 입력의 오류가 밖에서 온 오류보다 먼저다", async () => {
    const { calls } = setup({ errors: { "/items/0/qty": ERROR } });
    const input = cellInput("/items/0/qty");
    await userEvent.clear(input);
    await userEvent.type(input, "12abc{Enter}");
    const messages = screen.getAllByTestId("job-review-tree-table-cell-error");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveTextContent(ko.review.values.invalid_number);
    expect(calls.applies).toEqual([]);
  });

  it("위젯 오류는 경고를 가린다", async () => {
    setup({
      errors: { "/items/0/qty": { message: "경고", severity: "warning" } },
    });
    expect(
      screen.getByTestId("job-review-tree-table-cell-warning"),
    ).toBeInTheDocument();
    const input = cellInput("/items/0/qty");
    await userEvent.clear(input);
    await userEvent.type(input, "x{Enter}");
    expect(
      screen.queryByTestId("job-review-tree-table-cell-warning"),
    ).toBeNull();
    expect(
      screen.getByTestId("job-review-tree-table-cell-error"),
    ).toHaveTextContent(ko.review.values.invalid_number);
  });

  it("위젯 오류는 다음 항목으로 넘어가지 않는다(오류 낸 항목을 지우면 그 자리 항목에 없음)", async () => {
    const { setItems } = setup();
    const input = cellInput("/items/0/qty");
    await userEvent.clear(input);
    await userEvent.type(input, "12abc{Enter}");
    expect(
      screen.getByTestId("job-review-tree-table-cell-error"),
    ).toBeInTheDocument();
    expect(cellInput("/items/0/qty")).toHaveAttribute("aria-invalid", "true");
    setItems(itemsOf().slice(1));
    expect(screen.queryByTestId("job-review-tree-table-cell-error")).toBeNull();
    expect(cellInput("/items/0/qty")).not.toHaveAttribute("aria-invalid");
    expect(cellInput("/items/0/qty")).toHaveValue("2");
  });

  it("같은 값의 항목이 그 자리에 오면 오류가 남는다(값에 묶은 한계)", async () => {
    const items = itemsOf();
    items[1]!.qty = 1;
    const { setItems } = setup({ items });
    const input = cellInput("/items/0/qty");
    await userEvent.clear(input);
    await userEvent.type(input, "12abc{Enter}");
    setItems(items.slice(1));
    expect(
      screen.getByTestId("job-review-tree-table-cell-error"),
    ).toBeInTheDocument();
  });

  it("항목 오류는 다음 행에 표 너비(colSpan = 열 + 2)로 그린다", () => {
    setup({
      errors: { "/items/1": { message: "항목 오류", severity: "error" } },
    });
    const next = row("/items/1").nextElementSibling!;
    expect(next).not.toHaveAttribute("data-node-id");
    const td = next.querySelector("td")!;
    expect(td).toHaveAttribute("colspan", "6");
    expect(
      td.querySelector('[data-testid="job-review-field-group-error"]'),
    ).toHaveTextContent("항목 오류");
    expect(row("/items/0").nextElementSibling).toBe(row("/items/1"));
  });

  it("오류·경고 스냅샷", () => {
    setup({
      errors: {
        "/items/1/qty": ERROR,
        "/items/2/name": WARNING,
        "/items/1": { message: "항목 오류", severity: "error" },
      },
    });
    expect(snapshotHtml(screen.getByTestId(TABLE))).toMatchSnapshot();
  });
});

describe("배열 표 잠금", () => {
  it("잠기면 입력·＋·되돌리기·메뉴 버튼이 모두 비활성이다", () => {
    const base = itemsOf();
    const items = itemsOf();
    items[0]!.qty = 5;
    setup({ items, base, locked: true });
    const table = screen.getByTestId(TABLE);
    const inputs = [...table.querySelectorAll("[data-field-input]")];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every(input => input.hasAttribute("disabled"))).toBe(true);
    const buttons = [...table.querySelectorAll("button")];
    expect(
      new Set(buttons.map(button => button.getAttribute("data-testid"))),
    ).toEqual(
      new Set([
        "job-review-tree-table-button-add-cell",
        "job-review-tree-table-button-revert",
        "job-review-tree-button-menu",
        "job-review-tree-button-add-field",
      ]),
    );
    expect(buttons.every(button => button.hasAttribute("disabled"))).toBe(true);
  });
});

describe("배열 표 칸 편집", () => {
  it("Enter 로 확정하면 onApply 가 두 번 불리고(같은 값) 같은 행 다음 칸으로 포커스가 간다", async () => {
    const { calls } = setup();
    const input = cellInput("/items/0/name");
    await userEvent.clear(input);
    await userEvent.type(input, "청사과{Enter}");
    expect(calls.applies).toEqual([
      [RESULT_ID, ["items", "0", "name"], "청사과"],
      [RESULT_ID, ["items", "0", "name"], "청사과"],
    ]);
    expect(focusedCell()).toBe("/items/0/qty");
    expect(cellInput("/items/0/name")).toHaveValue("청사과");
  });

  it("행의 마지막 입력에서 Enter 면 다음 행 첫 칸으로 간다(＋ 칸·메뉴 버튼은 건너뜀)", async () => {
    setup();
    act(() => cellInput("/items/0/price").focus());
    await userEvent.keyboard("{Enter}");
    expect(focusedCell()).toBe("/items/1/name");
    act(() => cellInput("/items/1/memo").focus());
    await userEvent.keyboard("{Enter}");
    expect(focusedCell()).toBe("/items/2/name");
  });

  it("Esc 는 입력을 되돌리고 확정하지 않는다", async () => {
    const { calls } = setup();
    const input = cellInput("/items/1/memo");
    await userEvent.type(input, "XYZ");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("메모");
    act(() => input.blur());
    expect(calls.applies).toEqual([]);
  });

  it("포커스를 잃으면 한 번 확정하고 포커스는 옮기지 않는다", async () => {
    const { calls } = setup();
    const input = cellInput("/items/1/memo");
    await userEvent.type(input, "!");
    act(() => input.blur());
    expect(calls.applies).toEqual([
      [RESULT_ID, ["items", "1", "memo"], "메모!"],
    ]);
  });

  it("IME 조합 중 Enter 는 확정하지 않는다", () => {
    const { calls } = setup();
    const input = cellInput("/items/1/memo");
    fireEvent.change(input, { target: { value: "한" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(calls.applies).toEqual([]);
    expect(focusedCell()).toBeNull();
  });

  it("숫자 칸은 숫자로 확정한다", async () => {
    const { calls } = setup();
    const qty = cellInput("/items/0/qty");
    await userEvent.clear(qty);
    await userEvent.type(qty, "7");
    act(() => qty.blur());
    expect(calls.applies).toEqual([[RESULT_ID, ["items", "0", "qty"], 7]]);
  });
});

describe("배열 표 메뉴", () => {
  it("행 메뉴: 위·아래·삭제, 고르면 항목 편집이 나간다", async () => {
    const { calls } = setup();
    const trigger = row(
      "/items/1",
    ).lastElementChild!.querySelector<HTMLElement>(
      '[data-testid="job-review-tree-button-menu"]',
    )!;
    await userEvent.click(trigger);
    expect(
      screen
        .getAllByRole("menuitem")
        .map(item => [item.getAttribute("data-testid"), item.textContent]),
    ).toEqual([
      ["job-review-tree-menu-up", T.moveUp],
      ["job-review-tree-menu-down", T.moveDown],
      ["job-review-tree-menu-remove-item", T.removeItem],
    ]);
    await userEvent.click(
      screen.getByTestId("job-review-tree-menu-remove-item"),
    );
    expect(calls.edits).toEqual([
      { kind: "remove_item", path: ["items"], index: 1 },
    ]);
    expect(
      [...screen.getByTestId(TABLE).querySelectorAll("tbody tr")].length,
    ).toBe(2);
  });

  it("항목 수가 minItems 이하면 삭제가 비활성이고 문구에 최소 수가 붙는다", async () => {
    setup({ items: [itemsOf()[0]!] });
    const trigger = row(
      "/items/0",
    ).lastElementChild!.querySelector<HTMLElement>(
      '[data-testid="job-review-tree-button-menu"]',
    )!;
    await userEvent.click(trigger);
    const remove = screen.getByTestId("job-review-tree-menu-remove-item");
    expect(remove).toHaveTextContent(T.removeItemMin.replace("{min}", "1"));
    expect(remove).toHaveAttribute("data-disabled");
  });

  it("칸 메뉴: 비우기·필드 삭제, 비우기를 고르면 null 을 적용한다", async () => {
    const { calls } = setup();
    await userEvent.click(
      cell("/items/0/price").querySelector<HTMLElement>(
        '[data-testid="job-review-tree-button-menu"]',
      )!,
    );
    expect(
      screen
        .getAllByRole("menuitem")
        .map(item => item.getAttribute("data-testid")),
    ).toEqual([
      "job-review-tree-menu-clear",
      "job-review-tree-menu-remove-field",
    ]);
    await userEvent.click(screen.getByTestId("job-review-tree-menu-clear"));
    expect(calls.applies).toEqual([[RESULT_ID, ["items", "0", "price"], null]]);
  });

  it("칸 메뉴의 필드 삭제는 그 키를 지우는 편집을 내고 칸이 ＋ 칸이 된다", async () => {
    const { calls } = setup();
    await userEvent.click(
      cell("/items/1/memo").querySelector<HTMLElement>(
        '[data-testid="job-review-tree-button-menu"]',
      )!,
    );
    await userEvent.click(
      screen.getByTestId("job-review-tree-menu-remove-field"),
    );
    expect(calls.edits).toEqual([
      { kind: "remove_key", path: ["items", "1"], key: "memo" },
    ]);
    expect(
      row("/items/1").querySelector(
        '[data-testid="job-review-tree-table-button-add-cell"]',
      ),
    ).not.toBeNull();
  });

  it("필드 추가 메뉴는 열에 없는 schema 필드를 내고 고르면 그 키를 넣는다(열이 생긴다)", async () => {
    const { calls } = setup();
    await userEvent.click(
      row("/items/2").querySelector<HTMLElement>(
        '[data-testid="job-review-tree-button-add-field"]',
      )!,
    );
    const options = screen.getAllByTestId("job-review-tree-menu-add-field");
    expect(options.map(option => option.textContent)).toEqual(["비고"]);
    await userEvent.click(options[0]!);
    expect(calls.edits).toEqual([
      { kind: "set_key", path: ["items", "2"], key: "note", value: "" },
    ]);
    await waitFor(() => expect(cellInput("/items/2/note")).toHaveFocus());
    expect(
      [...screen.getByTestId(TABLE).querySelectorAll("thead th")].map(
        head => head.textContent,
      ),
    ).toContain("비고");
  });
});

describe("배열 표 그리는 항목", () => {
  it("객체가 아닌 항목이 섞이면 표가 아니라 항목별로 그린다", () => {
    setup({ items: [itemsOf()[0]!, "x" as unknown as JsonObject] });
    expect(screen.queryByTestId(TABLE)).toBeNull();
  });
});
