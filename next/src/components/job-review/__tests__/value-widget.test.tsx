import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ExactNumber, type JsonValue, type Widget } from "@/lib/review-model";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import { ValueWidget, type ValueWidgetProps } from "../value-widget";

const TEST_ID = "job-review-field";

interface Calls {
  commits: JsonValue[];
  errors: (string | null)[];
  editJson: number;
}

function setup(
  widget: Widget,
  value: JsonValue,
  overrides: Partial<ValueWidgetProps> = {},
) {
  const calls: Calls = { commits: [], errors: [], editJson: 0 };
  const props: ValueWidgetProps = {
    id: "field-1",
    widget,
    value,
    disabled: false,
    onCommit: next => calls.commits.push(next),
    onError: message => calls.errors.push(message),
    testId: TEST_ID,
    ...overrides,
  };
  const view = renderWithIntl(<ValueWidget {...props} />);
  const rerender = (next: Partial<ValueWidgetProps>) =>
    view.rerender(<ValueWidget {...props} {...next} />);
  return { ...view, calls, props, rerender };
}

/** 값 패널 안에 입력 여러 개를 둔다(Enter 뒤 다음 칸 포커스 확인용). */
function panel(...children: ReactElement[]) {
  return <div data-value-panel="">{children}</div>;
}

const TEXT: Widget = { kind: "text", multiline: false };
const MULTILINE: Widget = { kind: "text", multiline: true };
const NUMBER: Widget = { kind: "number", integer: false };
const INTEGER: Widget = { kind: "number", integer: true };
const BOOLEAN: Widget = { kind: "boolean" };
const ENUM_NULLABLE: Widget = {
  kind: "enum",
  options: ["apple", "banana", 3],
  nullable: true,
};
const ENUM_STRICT: Widget = {
  kind: "enum",
  options: ["apple", "banana"],
  nullable: false,
};
const JSON_WIDGET: Widget = { kind: "json" };
const LONG_TEXT: Widget = { kind: "text", multiline: true, long: true };

describe("ValueWidget 종류별 렌더", () => {
  it("text 는 input 하나를 그린다", () => {
    const { container } = setup(TEXT, "hello");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveValue("hello");
    expect(input).toHaveAttribute("id", "field-1");
    expect(input).toHaveAttribute("data-field-input", "");
    expect(input).not.toHaveAttribute("inputmode");
    expect(input).not.toHaveClass("font-mono");
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("multiline 은 rows=3 textarea 를 그린다", () => {
    const { container } = setup(MULTILINE, "line 1\nline 2");
    const textarea = screen.getByTestId(`${TEST_ID}-textarea-value`);
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("rows", "3");
    expect(textarea).toHaveValue("line 1\nline 2");
    expect(textarea).toHaveAttribute("data-field-input", "");
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("number 는 inputmode=decimal 과 font-mono 를 둔다", () => {
    const { container } = setup(NUMBER, 12.5);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    expect(input).toHaveValue("12.5");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveClass("font-mono");
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("integer 도 같은 number 입력칸이다", () => {
    const { container } = setup(INTEGER, 7);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    expect(input).toHaveValue("7");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("boolean 은 switch 와 예/아니요/(없음) 문구를 그린다", () => {
    const { container, rerender } = setup(BOOLEAN, true);
    const toggle = screen.getByTestId(`${TEST_ID}-switch-value`);
    expect(toggle).toHaveAttribute("role", "switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("data-field-input", "");
    expect(screen.getByText("예")).toBeInTheDocument();
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();

    rerender({ value: false });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("아니요")).toBeInTheDocument();

    rerender({ value: null });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("(없음)")).toBeInTheDocument();
  });

  it("enum 은 select 트리거에 현재 값을 보인다", () => {
    const { container } = setup(ENUM_NULLABLE, "banana");
    const trigger = screen.getByTestId(`${TEST_ID}-select-value`);
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("id", "field-1");
    expect(trigger).toHaveAttribute("data-field-input", "");
    expect(trigger).toHaveTextContent("banana");
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("enum 이 null 이면 (없음) 을 보인다", () => {
    setup(ENUM_NULLABLE, null);
    expect(screen.getByTestId(`${TEST_ID}-select-value`)).toHaveTextContent(
      "(없음)",
    );
  });

  it("json 은 font-mono input 에 JSON 표기를 넣는다", () => {
    const { container } = setup(JSON_WIDGET, 42);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    expect(input).toHaveValue("42");
    expect(input).toHaveClass("font-mono");
    expect(input).not.toHaveAttribute("inputmode");
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("판정·객체·배열 위젯은 json 입력칸으로 떨어진다(문자열 값은 따옴표 없이 보인다)", () => {
    for (const kind of ["verdict", "object", "array"] as const) {
      const { unmount } = setup({ kind }, "x");
      const input = screen.getByTestId(`${TEST_ID}-input-value`);
      expect(input).toHaveValue("x");
      expect(input).toHaveClass("font-mono");
      unmount();
    }
  });

  it("long text 는 크기·글자 수 요약, 앞 200 글자 미리보기, JSON 으로 편집 버튼을 그린다", async () => {
    const text = "가".repeat(10_001);
    const { container, calls } = setup(LONG_TEXT, text, {
      onEditJson: () => {
        calls.editJson += 1;
      },
    });
    const root = screen.getByTestId(`${TEST_ID}-long-text`);
    expect(root).toHaveTextContent("긴 텍스트 (29.3kB, 10,001자)");
    const preview = screen.getByTestId(`${TEST_ID}-long-text-preview`);
    expect(preview.tagName).toBe("PRE");
    expect(preview).toHaveAttribute("id", "field-1");
    expect(preview).toHaveAttribute("tabindex", "0");
    expect(preview).toHaveAttribute("data-field-input", "");
    expect(preview.textContent).toBe(`${"가".repeat(200)}…`);
    expect(root).toHaveTextContent(
      '너무 길어 여기서는 고칠 수 없습니다. "JSON 으로 편집" 으로 고치세요.',
    );
    const button = screen.getByTestId(`${TEST_ID}-long-text-button-edit-json`);
    expect(button).toHaveTextContent("JSON 으로 편집");
    await userEvent.click(button);
    expect(calls.editJson).toBe(1);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(snapshotHtml(container.firstElementChild)).toMatchSnapshot();
  });

  it("long text 는 서로게이트 쌍을 한 글자로 센다", () => {
    setup(LONG_TEXT, "😀".repeat(5_001));
    expect(screen.getByTestId(`${TEST_ID}-long-text`)).toHaveTextContent(
      "5,001자",
    );
    expect(screen.getByTestId(`${TEST_ID}-long-text-preview`).textContent).toBe(
      `${"😀".repeat(200)}…`,
    );
  });

  it("long text 는 onEditJson 이 없으면 버튼을 숨기고, disabled 면 버튼을 막는다", () => {
    const { rerender } = setup(LONG_TEXT, "x".repeat(10_001));
    expect(
      screen.queryByTestId(`${TEST_ID}-long-text-button-edit-json`),
    ).toBeNull();
    rerender({ onEditJson: () => {}, disabled: true });
    expect(
      screen.getByTestId(`${TEST_ID}-long-text-button-edit-json`),
    ).toBeDisabled();
  });
});

describe("ValueWidget 텍스트 확정", () => {
  it("blur 때 바뀐 값을 한 번 확정하고 오류를 지운다", async () => {
    const { calls } = setup(TEXT, "hello");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.clear(input);
    await userEvent.type(input, "world");
    expect(calls.commits).toEqual([]);
    act(() => input.blur());
    expect(calls.commits).toEqual(["world"]);
    expect(calls.errors).toEqual([null]);
  });

  it("Enter 로 확정한다", async () => {
    const { calls } = setup(TEXT, "a");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.type(input, "b{Enter}");
    expect(calls.commits).toEqual(["ab"]);
  });

  it("값이 같으면 onCommit 을 부르지 않고 오류만 지운다", async () => {
    const { calls } = setup(TEXT, "same");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.type(input, "{Enter}");
    act(() => input.blur());
    expect(calls.commits).toEqual([]);
    expect(calls.errors).toEqual([null, null]);
  });

  it("다른 표기라도 JSON 값이 같으면 onCommit 을 부르지 않는다(숫자 1.0 = 1)", async () => {
    const { calls } = setup(NUMBER, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.type(input, ".0{Enter}");
    expect(calls.commits).toEqual([]);
    expect(calls.errors).toEqual([null]);
  });

  it("Esc 는 입력을 원래 값으로 되돌리고 확정하지 않는다", async () => {
    const { calls } = setup(TEXT, "keep");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.type(input, "XYZ");
    expect(input).toHaveValue("keepXYZ");
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveValue("keep");
    expect(calls.errors).toEqual([null]);
    act(() => input.blur());
    expect(calls.commits).toEqual([]);
  });

  it("IME 조합 중 Enter 는 확정하지 않는다", () => {
    const { calls } = setup(TEXT, "");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    fireEvent.change(input, { target: { value: "한" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(calls.commits).toEqual([]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.commits).toEqual(["한"]);
  });

  it("여러 줄은 Enter 로 줄을 바꾸고 ⌘/Ctrl+Enter 로 확정한다", async () => {
    const { calls } = setup(MULTILINE, "a");
    const textarea = screen.getByTestId(`${TEST_ID}-textarea-value`);
    await userEvent.type(textarea, "{Enter}b");
    expect(textarea).toHaveValue("a\nb");
    expect(calls.commits).toEqual([]);
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(calls.commits).toEqual(["a\nb"]);
    await userEvent.type(textarea, "c");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    // 부모가 값을 바꾸지 않았으므로 원래 값 "a" 기준으로 다시 확정한다.
    expect(calls.commits).toEqual(["a\nb", "ac"]);
  });

  it("바깥에서 값이 바뀌면 입력 중인 글자를 버리고 새 값을 보인다", async () => {
    const { rerender } = setup(TEXT, "old");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.type(input, "!");
    expect(input).toHaveValue("old!");
    rerender({ value: "new" });
    expect(input).toHaveValue("new");
  });

  it("null 은 '값 없음', 빈 문자열은 '빈 값' placeholder 를 보인다", () => {
    const { rerender } = setup(TEXT, null);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "값 없음");
    rerender({ value: "" });
    expect(input).toHaveAttribute("placeholder", "빈 값");
    rerender({ value: "x" });
    expect(input).not.toHaveAttribute("placeholder");
  });

  it("null 값에서 아무것도 입력하지 않고 확정하면 부르지 않고, 지우고 확정하면 빈 문자열이 된다", async () => {
    const { calls, rerender } = setup(TEXT, null);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    act(() => input.blur());
    expect(calls.commits).toEqual([]);
    rerender({ value: "x" });
    await userEvent.clear(input);
    act(() => input.blur());
    expect(calls.commits).toEqual([""]);
  });
});

describe("ValueWidget 숫자·JSON 오류", () => {
  it("숫자로 읽을 수 없으면 invalid_number 문구를 알리고 확정하지 않는다", async () => {
    const { calls } = setup(NUMBER, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.clear(input);
    await userEvent.type(input, "1,234{Enter}");
    expect(calls.commits).toEqual([]);
    expect(calls.errors.at(-1)).toBe(
      "숫자로 읽을 수 없습니다. 1234.5 처럼 쉼표 없이 입력하세요.",
    );
    expect(input).toHaveValue("1,234");
    // 실패한 Enter 는 포커스를 옮기지 않는다.
    expect(input).toHaveFocus();
  });

  it("정수 schema 에 소수를 넣으면 not_integer 문구를 알린다", async () => {
    const { calls } = setup(INTEGER, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.clear(input);
    await userEvent.type(input, "1.5");
    act(() => input.blur());
    expect(calls.commits).toEqual([]);
    expect(calls.errors.at(-1)).toBe("정수만 입력할 수 있습니다.");
  });

  it("오류 뒤 고쳐서 확정하면 오류를 지우고 숫자로 확정한다", async () => {
    const { calls } = setup(INTEGER, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.clear(input);
    await userEvent.type(input, "x{Enter}");
    await userEvent.clear(input);
    await userEvent.type(input, " 42 {Enter}");
    expect(calls.commits).toEqual([42]);
    expect(calls.errors).toEqual([
      "숫자로 읽을 수 없습니다. 1234.5 처럼 쉼표 없이 입력하세요.",
      null,
    ]);
  });

  it("긴 소수·큰 정수는 원문을 지키는 ExactNumber 로 확정한다", async () => {
    const { calls } = setup(NUMBER, 0);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.clear(input);
    await userEvent.type(input, "0.12345678901234567890{Enter}");
    expect(calls.commits).toHaveLength(1);
    const committed = calls.commits[0];
    expect(committed).toBeInstanceOf(ExactNumber);
    expect((committed as ExactNumber).raw).toBe("0.12345678901234567890");
  });

  it("ExactNumber 값은 원문 그대로 입력칸에 보인다", () => {
    setup(NUMBER, new ExactNumber("12345678901234567890"));
    expect(screen.getByTestId(`${TEST_ID}-input-value`)).toHaveValue(
      "12345678901234567890",
    );
  });

  it("JSON 으로 읽을 수 없으면 invalid_json 문구를 알린다", async () => {
    const { calls } = setup(JSON_WIDGET, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.clear(input);
    await userEvent.type(input, "not json{Enter}");
    expect(calls.commits).toEqual([]);
    expect(calls.errors.at(-1)).toBe("JSON 값으로 읽을 수 없습니다.");
  });

  it("JSON 객체·배열은 not_scalar 문구를 알린다", () => {
    const { calls } = setup(JSON_WIDGET, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    fireEvent.change(input, { target: { value: "[1, 2]" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: '{"a": 1}' } });
    fireEvent.blur(input);
    expect(calls.commits).toEqual([]);
    expect(calls.errors).toEqual([
      "객체나 배열은 입력할 수 없습니다. 값 하나만 입력하세요.",
      "객체나 배열은 입력할 수 없습니다. 값 하나만 입력하세요.",
    ]);
  });

  it("JSON 스칼라는 파싱한 값으로 확정한다(문자열·null·true)", () => {
    const { calls } = setup(JSON_WIDGET, 1);
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    for (const text of ['"text"', "null", "true"]) {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    expect(calls.commits).toEqual(["text", null, true]);
  });
});

describe("ValueWidget 선택 위젯", () => {
  it("switch 를 누르면 반대 값으로 확정한다", async () => {
    const { calls, rerender } = setup(BOOLEAN, false);
    const toggle = screen.getByTestId(`${TEST_ID}-switch-value`);
    await userEvent.click(toggle);
    expect(calls.commits).toEqual([true]);
    rerender({ value: null });
    await userEvent.click(toggle);
    expect(calls.commits).toEqual([true, true]);
  });

  it("switch 는 disabled 면 눌러도 확정하지 않는다", async () => {
    const { calls } = setup(BOOLEAN, false, { disabled: true });
    const toggle = screen.getByTestId(`${TEST_ID}-switch-value`);
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(calls.commits).toEqual([]);
  });

  it("enum 목록은 nullable 이면 (없음) 을 맨 앞에 두고 고른 값을 확정한다", async () => {
    const { calls } = setup(ENUM_NULLABLE, "apple");
    const trigger = screen.getByTestId(`${TEST_ID}-select-value`);
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const options = screen.getAllByRole("option");
    expect(options.map(option => option.textContent)).toEqual([
      "(없음)",
      "apple",
      "banana",
      "3",
    ]);
    await userEvent.click(screen.getByRole("option", { name: "3" }));
    expect(calls.commits).toEqual([3]);
  });

  it("enum 에서 (없음) 을 고르면 null 을 확정한다", async () => {
    const { calls } = setup(ENUM_NULLABLE, "apple");
    screen.getByTestId(`${TEST_ID}-select-value`).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("option", { name: "(없음)" }));
    expect(calls.commits).toEqual([null]);
  });

  it("enum 에서 지금 값을 다시 고르면 확정하지 않는다", async () => {
    const { calls } = setup(ENUM_NULLABLE, "apple");
    screen.getByTestId(`${TEST_ID}-select-value`).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("option", { name: "apple" }));
    expect(calls.commits).toEqual([]);
  });

  it("nullable 이 아닌 enum 은 (없음) 이 없고, 설정에 없는 값은 '(설정에 없음)' 항목으로 보인다", async () => {
    setup(ENUM_STRICT, "cherry");
    const trigger = screen.getByTestId(`${TEST_ID}-select-value`);
    expect(trigger).toHaveTextContent("cherry (설정에 없음)");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getAllByRole("option").map(option => option.textContent),
    ).toEqual(["cherry (설정에 없음)", "apple", "banana"]);
  });

  it("nullable 이 아닌 enum 도 값이 null 이면 (없음) 항목을 둔다", async () => {
    setup(ENUM_STRICT, null);
    screen.getByTestId(`${TEST_ID}-select-value`).focus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getAllByRole("option").map(option => option.textContent),
    ).toEqual(["(없음)", "apple", "banana"]);
  });

  it("enum 은 disabled 면 트리거를 막는다", () => {
    setup(ENUM_NULLABLE, "apple", { disabled: true });
    expect(screen.getByTestId(`${TEST_ID}-select-value`)).toBeDisabled();
  });
});

describe("ValueWidget 공통 속성", () => {
  it("invalid·describedBy 를 aria 속성으로 둔다", () => {
    const cases: [Widget, JsonValue, string][] = [
      [TEXT, "a", `${TEST_ID}-input-value`],
      [MULTILINE, "a", `${TEST_ID}-textarea-value`],
      [BOOLEAN, true, `${TEST_ID}-switch-value`],
      [ENUM_NULLABLE, "apple", `${TEST_ID}-select-value`],
    ];
    for (const [widget, value, testId] of cases) {
      const { unmount, rerender } = setup(widget, value, {
        invalid: true,
        describedBy: "field-1-error",
      });
      const control = screen.getByTestId(testId);
      expect(control).toHaveAttribute("aria-invalid", "true");
      expect(control).toHaveAttribute("aria-describedby", "field-1-error");
      rerender({ invalid: false, describedBy: undefined });
      expect(control).not.toHaveAttribute("aria-invalid");
      expect(control).not.toHaveAttribute("aria-describedby");
      unmount();
    }
  });

  it("controlClassName 을 입력칸·여러 줄·선택 트리거에 더하고 switch 에는 더하지 않는다", () => {
    const cases: [Widget, JsonValue, string, boolean][] = [
      [TEXT, "a", `${TEST_ID}-input-value`, true],
      [NUMBER, 1, `${TEST_ID}-input-value`, true],
      [MULTILINE, "a", `${TEST_ID}-textarea-value`, true],
      [ENUM_NULLABLE, "apple", `${TEST_ID}-select-value`, true],
      [BOOLEAN, true, `${TEST_ID}-switch-value`, false],
    ];
    for (const [widget, value, testId, applied] of cases) {
      const { unmount } = setup(widget, value, {
        controlClassName: "h-7 cell-control",
      });
      const control = screen.getByTestId(testId);
      if (applied) expect(control).toHaveClass("cell-control", "h-7");
      else expect(control).not.toHaveClass("cell-control");
      unmount();
    }
  });

  it("disabled 면 입력칸을 막는다", () => {
    setup(TEXT, "a", { disabled: true });
    expect(screen.getByTestId(`${TEST_ID}-input-value`)).toBeDisabled();
  });

  it("data-field-input 을 입력칸·여러 줄·switch·선택 트리거·긴 텍스트 미리보기에 둔다", () => {
    const widgets: [Widget, JsonValue][] = [
      [TEXT, "a"],
      [MULTILINE, "a"],
      [BOOLEAN, true],
      [ENUM_NULLABLE, "apple"],
      [LONG_TEXT, "x".repeat(10_001)],
    ];
    const marked = widgets.map(([widget, value]) => {
      const { container, unmount } = setup(widget, value);
      const found = [...container.querySelectorAll("[data-field-input]")].map(
        element => element.getAttribute("data-testid"),
      );
      unmount();
      return found;
    });
    expect(marked).toEqual([
      [`${TEST_ID}-input-value`],
      [`${TEST_ID}-textarea-value`],
      [`${TEST_ID}-switch-value`],
      [`${TEST_ID}-select-value`],
      [`${TEST_ID}-long-text-preview`],
    ]);
  });
});

describe("ValueWidget Enter 뒤 다음 칸 포커스", () => {
  function noop() {}

  it("값 패널 안에서 Enter 로 확정하면 다음 [data-field-input] 으로 포커스를 옮긴다(막힌 칸은 건너뜀)", async () => {
    // 포커스 이동이 같은 이벤트 안에서 blur 를 일으키고, 그 blur 는 아직 다시 그려지기 전 입력으로
    // 한 번 더 확정한다. 부모가 값을 바꾸지 않는 이 테스트에서는 같은 값이 두 번 온다.
    const commits: JsonValue[] = [];
    const base = {
      onCommit: (value: JsonValue) => commits.push(value),
      onError: noop,
    };
    renderWithIntl(
      panel(
        <ValueWidget
          key="a"
          {...base}
          id="a"
          widget={TEXT}
          value="a"
          disabled={false}
          testId="first"
        />,
        <ValueWidget
          key="b"
          {...base}
          id="b"
          widget={TEXT}
          value="b"
          disabled
          testId="locked"
        />,
        <ValueWidget
          key="c"
          {...base}
          id="c"
          widget={BOOLEAN}
          value={false}
          disabled={false}
          testId="third"
        />,
      ),
    );
    const first = screen.getByTestId("first-input-value");
    await userEvent.type(first, "!{Enter}");
    expect(commits).toEqual(["a!", "a!"]);
    expect(screen.getByTestId("third-switch-value")).toHaveFocus();
  });

  it("값이 같아 확정할 것이 없어도 Enter 는 다음 칸으로 간다", async () => {
    renderWithIntl(
      panel(
        <ValueWidget
          key="a"
          id="a"
          widget={NUMBER}
          value={1}
          disabled={false}
          onCommit={noop}
          onError={noop}
          testId="first"
        />,
        <ValueWidget
          key="b"
          id="b"
          widget={MULTILINE}
          value="b"
          disabled={false}
          onCommit={noop}
          onError={noop}
          testId="second"
        />,
      ),
    );
    screen.getByTestId("first-input-value").focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("second-textarea-value")).toHaveFocus();
  });

  it("값 패널 밖이면 Enter 뒤에도 포커스가 그대로다", async () => {
    setup(TEXT, "a");
    const input = screen.getByTestId(`${TEST_ID}-input-value`);
    await userEvent.type(input, "{Enter}");
    expect(input).toHaveFocus();
  });
});
