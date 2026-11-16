import { fireEvent, render, screen } from "@testing-library/react";
import {
  ValueWidget,
  type ValueWidgetCodec,
  type ValueWidgetControlProps,
  type ValueWidgetDescriptor,
  type ValueWidgetLabels,
  type ValueWidgetPrimitive,
  type ValueWidgetProps,
} from "@/components/studio-ui-kit/value-widget/value-widget";

/** JSON 이 아닌 값 표현: 숫자를 `{ n }` 로 감싼다. */
interface Boxed {
  n: number;
}
type Value = Boxed | ValueWidgetPrimitive;

const isBoxed = (value: unknown): value is Boxed =>
  typeof value === "object" && value !== null && "n" in value;

const codec: ValueWidgetCodec<Boxed> = {
  toText: value =>
    value === null
      ? ""
      : typeof value === "string"
        ? value
        : isBoxed(value)
          ? `#${value.n}`
          : String(value),
  keyOf: value => (isBoxed(value) ? `n:${value.n}` : `p:${String(value)}`),
  equals: (a, b) =>
    isBoxed(a) && isBoxed(b) ? a.n === b.n : !isBoxed(a) && a === b,
  parseNumber(text, integer) {
    const n = Number(text.replace(/^#/, ""));
    if (text.trim() === "" || Number.isNaN(n)) {
      return { ok: false, reason: "invalid_number" };
    }
    if (integer && !Number.isInteger(n)) {
      return { ok: false, reason: "not_integer" };
    }
    return { ok: true, value: { n } };
  },
  parseScalar(text) {
    if (text.startsWith("{")) return { ok: false, reason: "not_scalar" };
    if (!text.startsWith("#")) return { ok: false, reason: "invalid_json" };
    return { ok: true, value: { n: Number(text.slice(1)) } };
  },
};

const labels: ValueWidgetLabels = {
  none: "NONE",
  true: "YES",
  false: "NO",
  nullPlaceholder: "NULL",
  emptyPlaceholder: "EMPTY",
  notInConfig: value => `${value} ?`,
  errors: {
    invalid_number: "E-number",
    not_integer: "E-integer",
    invalid_json: "E-json",
    not_scalar: "E-scalar",
  },
  longTextSummary: (bytes, count) => `${bytes}B/${count}`,
  longTextHint: "HINT",
  editJson: "EDIT",
};

const NUMBER: ValueWidgetDescriptor<Boxed> = { kind: "number", integer: true };
const TEXT: ValueWidgetDescriptor<Boxed> = { kind: "text", multiline: false };

function setup(
  descriptor: ValueWidgetDescriptor<Boxed>,
  value: Value,
  overrides: Partial<ValueWidgetProps<Boxed>> = {},
) {
  const commits: Value[] = [];
  const errors: (string | null)[] = [];
  const view = render(
    <ValueWidget<Boxed>
      id="v"
      descriptor={descriptor}
      value={value}
      codec={codec}
      onCommit={next => commits.push(next)}
      onError={message => errors.push(message)}
      labels={labels}
      testId="vw"
      {...overrides}
    />,
  );
  return { ...view, commits, errors };
}

describe("ValueWidget(Core) — host 와 무관한 값 표현", () => {
  it("codec 으로 글자를 만들고 숫자 입력을 codec 값으로 확정한다", () => {
    const { commits } = setup(NUMBER, { n: 3 });
    const input = screen.getByTestId("vw-input-value");
    expect(input).toHaveValue("#3");
    fireEvent.change(input, { target: { value: "#4" } });
    fireEvent.blur(input);
    expect(commits).toEqual([{ n: 4 }]);
  });

  it("codec 이 같다고 하면 확정하지 않는다", () => {
    const { commits } = setup(NUMBER, { n: 3 });
    const input = screen.getByTestId("vw-input-value");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(commits).toEqual([]);
  });

  it("파싱 실패 이유를 labels.errors 문구로 알린다", () => {
    const { errors, commits } = setup(NUMBER, { n: 3 });
    const input = screen.getByTestId("vw-input-value");
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.blur(input);
    expect(errors).toEqual(["E-integer", "E-number"]);
    expect(commits).toEqual([]);
  });

  it("json 은 parseScalar 결과로 확정하고 거부 이유를 알린다", () => {
    const { errors, commits } = setup({ kind: "json" }, { n: 1 });
    const input = screen.getByTestId("vw-input-value");
    fireEvent.change(input, { target: { value: "{}" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "#9" } });
    fireEvent.blur(input);
    expect(errors).toEqual(["E-scalar", null]);
    expect(commits).toEqual([{ n: 9 }]);
  });

  it("enum 은 codec key 로 항목을 고른다", () => {
    setup(
      { kind: "enum", options: [{ n: 1 }, { n: 2 }], nullable: false },
      { n: 2 },
    );
    expect(screen.getByTestId("vw-select-value")).toHaveTextContent("#2");
  });

  it("boolean·placeholder 문구는 labels 에서 온다", () => {
    setup({ kind: "boolean" }, null);
    expect(screen.getByText("NONE")).toBeInTheDocument();
  });

  it("긴 문자열 요약은 바이트 수와 글자 수를 labels.longTextSummary 에 넘긴다", () => {
    setup({ kind: "text", multiline: true, long: true }, "가😀", {
      onEditJson: () => {},
    });
    expect(screen.getByText("7B/2")).toBeInTheDocument();
    expect(screen.getByText("HINT")).toBeInTheDocument();
    expect(
      screen.getByTestId("vw-long-text-button-edit-json"),
    ).toHaveTextContent("EDIT");
  });
});

describe("ValueWidget(Core) — onSubmitNext·controlProps", () => {
  it("onSubmitNext 가 없으면 Enter 로 확정해도 포커스가 그대로다", () => {
    const { commits } = setup(TEXT, "a");
    const input = screen.getByTestId("vw-input-value");
    input.focus();
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commits).toEqual(["b"]);
    expect(document.activeElement).toBe(input);
  });

  it("onSubmitNext 는 Enter 확정에 성공한 뒤에만 입력 요소를 받아 불린다", () => {
    const targets: HTMLElement[] = [];
    setup(NUMBER, { n: 1 }, { onSubmitNext: from => targets.push(from) });
    const input = screen.getByTestId("vw-input-value");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(targets).toEqual([]);
    fireEvent.change(input, { target: { value: "#2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(targets).toEqual([input]);
  });

  it("controlProps 가 없으면 입력 요소에 추가 data 속성이 없다", () => {
    setup(TEXT, "a");
    const input = screen.getByTestId("vw-input-value");
    expect(
      [...input.attributes]
        .map(attribute => attribute.name)
        .filter(name => name.startsWith("data-") && name !== "data-slot")
        .sort(),
    ).toEqual(["data-testid"]);
  });

  it("controlProps 는 네 입력 요소에 붙고 data-testid 는 덮지 못한다", () => {
    const controlProps = { "data-host-input": "", "data-testid": "x" };
    const kinds: ValueWidgetDescriptor<Boxed>[] = [
      TEXT,
      { kind: "boolean" },
      { kind: "enum", options: [{ n: 1 }], nullable: true },
      { kind: "text", multiline: true, long: true },
    ];
    const ids = [
      "vw-input-value",
      "vw-switch-value",
      "vw-select-value",
      "vw-long-text-preview",
    ];
    kinds.forEach((descriptor, index) => {
      // @ts-expect-error -- 맵에는 data-testid 를 넣을 수 없다(넣어도 덮지 못하는지 본다).
      const { unmount } = setup(descriptor, "a", { controlProps });
      const control = screen.getByTestId(ids[index] ?? "");
      expect(control).toHaveAttribute("data-host-input", "");
      unmount();
    });
  });

  it("controlProps 에는 data-testid 를 넣을 수 없고, 타입을 우회해 넣어도 내부 testid 가 이긴다", () => {
    // @ts-expect-error -- 맵에는 data-testid 를 넣을 수 없다.
    const banned: ValueWidgetControlProps = { "data-testid": "x" };
    expect(banned).toBeDefined();
    const controlProps = {
      "data-host-input": "",
      "data-testid": "host",
    } as unknown as ValueWidgetControlProps;
    setup(TEXT, "a", { controlProps });
    const input = screen.getByTestId("vw-input-value");
    expect(input).toHaveAttribute("data-host-input", "");
    expect(screen.queryByTestId("host")).toBeNull();
  });

  it("testId 가 없으면 하위 testid 를 붙이지 않는다", () => {
    const { container } = setup(TEXT, "a", { testId: undefined });
    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});

/**
 * Studio UI Kit item 문서의 "DOM 계약" 중 `value-widget` HTML 속성: 숫자 입력만 `inputmode="decimal"`
 * (스모크 `values` 가 숫자 칸을 이 속성으로 가른다).
 */
const INPUT_MODE_CONTRACT: {
  name: string;
  descriptor: ValueWidgetDescriptor<Boxed>;
  value: Value;
  inputMode: string | null;
}[] = [
  { name: "정수", descriptor: NUMBER, value: { n: 1 }, inputMode: "decimal" },
  {
    name: "실수",
    descriptor: { kind: "number", integer: false },
    value: { n: 1 },
    inputMode: "decimal",
  },
  { name: "글자", descriptor: TEXT, value: "a", inputMode: null },
  {
    name: "json",
    descriptor: { kind: "json" },
    value: { n: 1 },
    inputMode: null,
  },
];

describe("ValueWidget(Core) DOM 계약", () => {
  it.each(INPUT_MODE_CONTRACT)(
    "$name 입력의 inputmode 는 $inputMode",
    ({ descriptor, value, inputMode }) => {
      setup(descriptor, value);
      expect(
        screen.getByTestId("vw-input-value").getAttribute("inputmode"),
      ).toBe(inputMode);
    },
  );

  it("여러 줄 입력(textarea)에는 inputmode 가 없다", () => {
    setup({ kind: "text", multiline: true }, "a");
    expect(screen.getByTestId("vw-textarea-value")).not.toHaveAttribute(
      "inputmode",
    );
  });
});
