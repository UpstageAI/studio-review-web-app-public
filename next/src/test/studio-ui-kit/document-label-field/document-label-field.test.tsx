import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  DocumentLabelField,
  type DocumentLabelFieldProps,
} from "@/components/studio-ui-kit/document-label-field/document-label-field";

const TEST_ID = "dl";
const LABELS = {
  noLabel: "(없음)",
  notInConfigOption: (label: string) => `${label} (설정 밖)`,
};

function setup(overrides: Partial<DocumentLabelFieldProps> = {}) {
  const sent: (string | null)[] = [];
  const view = render(
    <DocumentLabelField
      value={null}
      onValueChange={label => sent.push(label)}
      choices={["A", "B"]}
      labels={LABELS}
      testId={TEST_ID}
      {...overrides}
    />,
  );
  return { ...view, sent };
}

const byId = (suffix: string) => screen.getByTestId(`${TEST_ID}-${suffix}`);
const queryById = (suffix: string) =>
  screen.queryByTestId(`${TEST_ID}-${suffix}`);
const input = () => byId("label-input") as HTMLInputElement;

async function openOptions() {
  byId("label-select").focus();
  await userEvent.keyboard("{Enter}");
  return screen.getAllByRole("option");
}

const optionTexts = (options: HTMLElement[]) =>
  options.map(option => option.textContent);

describe("DocumentLabelField select", () => {
  it("choices 가 있으면 select, 없으면 입력", () => {
    setup();
    expect(byId("label-select")).toBeInTheDocument();
    expect(queryById("label-input")).toBeNull();
  });

  it("noLabelOption 기본(when-empty): 라벨이 없을 때만 (없음) 항목을 맨 앞에", async () => {
    setup();
    expect(byId("label-select")).toHaveTextContent("(없음)");
    expect(optionTexts(await openOptions())).toEqual(["(없음)", "A", "B"]);
  });

  it("noLabelOption 기본: 라벨이 있으면 (없음) 항목이 없다", async () => {
    setup({ value: "B" });
    expect(byId("label-select")).toHaveTextContent("B");
    expect(optionTexts(await openOptions())).toEqual(["A", "B"]);
    expect(queryById("option-no-label")).toBeNull();
  });

  it("noLabelOption always: 라벨이 있어도 (없음) 항목이 맨 앞에", async () => {
    setup({ value: "A", noLabelOption: "always" });
    expect(optionTexts(await openOptions())).toEqual(["(없음)", "A", "B"]);
  });

  it("outsideOption 기본(annotated): 목록 밖 라벨을 문구로 맨 앞에", async () => {
    setup({ value: "Z" });
    const options = await openOptions();
    expect(optionTexts(options)).toEqual(["Z (설정 밖)", "A", "B"]);
    expect(options[0]).toHaveAttribute(
      "data-testid",
      `${TEST_ID}-option-label-Z`,
    );
  });

  it("annotated 라도 문구 함수가 없으면 목록 밖 항목을 그리지 않는다", async () => {
    setup({ value: "Z", labels: { noLabel: "(없음)" } });
    expect(optionTexts(await openOptions())).toEqual(["A", "B"]);
  });

  it("outsideOption none: 목록 밖 항목을 그리지 않는다", async () => {
    setup({ value: "Z", outsideOption: "none", noLabelOption: "always" });
    expect(optionTexts(await openOptions())).toEqual(["(없음)", "A", "B"]);
  });

  it("항목을 고르면 그 값을, (없음) 을 고르면 null 을 보낸다", async () => {
    const { sent, rerender } = setup();
    await openOptions();
    await userEvent.click(byId("option-label-B"));
    rerender(
      <DocumentLabelField
        value="B"
        onValueChange={label => sent.push(label)}
        choices={["A", "B"]}
        noLabelOption="always"
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    await openOptions();
    await userEvent.click(byId("option-no-label"));
    expect(sent).toEqual(["B", null]);
  });

  it("disabled 면 트리거가 비활성", () => {
    setup({ disabled: true });
    expect(byId("label-select")).toBeDisabled();
  });

  it("id·classNames.trigger 는 트리거에 붙는다", () => {
    setup({ id: "lbl", classNames: { trigger: "w-full", input: "x-input" } });
    const trigger = byId("label-select");
    expect(trigger).toHaveAttribute("id", "lbl");
    expect(trigger).toHaveClass("w-full");
    expect(trigger).not.toHaveClass("x-input");
  });
});

describe("DocumentLabelField 입력 commit 기본(포커스를 잃을 때 확정)", () => {
  it("placeholder 는 noLabel, maxLength 를 주지 않으면 속성이 없다", () => {
    setup({ choices: null });
    expect(input()).toHaveAttribute("placeholder", "(없음)");
    expect(input()).not.toHaveAttribute("maxlength");
  });

  it("maxLength·id·classNames.input", () => {
    setup({
      choices: null,
      maxLength: 200,
      id: "lbl",
      classNames: { trigger: "x-trigger", input: "x-input" },
    });
    expect(input()).toHaveAttribute("maxlength", "200");
    expect(input()).toHaveAttribute("id", "lbl");
    expect(input()).toHaveClass("x-input");
    expect(input()).not.toHaveClass("x-trigger");
  });

  it("입력 중에는 보내지 않고 포커스를 잃으면 앞뒤 공백을 빼서 보낸다", () => {
    const { sent } = setup({ choices: null, value: "A" });
    fireEvent.change(input(), { target: { value: "  Memo  " } });
    expect(sent).toEqual([]);
    fireEvent.blur(input());
    expect(sent).toEqual(["Memo"]);
    expect(input()).toHaveValue("Memo");
  });

  it("Enter 는 기본 동작을 막고, 값이 반영되면 이어지는 포커스 잃음에 다시 보내지 않는다", () => {
    const sent: (string | null)[] = [];
    function Harness() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <DocumentLabelField
          value={value}
          onValueChange={label => {
            sent.push(label);
            setValue(label);
          }}
          choices={null}
          labels={LABELS}
          testId={TEST_ID}
        />
      );
    }
    render(<Harness />);
    const node = input();
    fireEvent.change(node, { target: { value: "Memo" } });
    expect(fireEvent.keyDown(node, { key: "Enter" })).toBe(false);
    fireEvent.blur(node);
    expect(sent).toEqual(["Memo"]);
    expect(input()).toBe(node);
  });

  it("보낸 값이 value 로 반영되지 않으면 다음에 포커스를 잃을 때 다시 보낸다(되돌리지 않음)", () => {
    const { sent } = setup({ choices: null });
    fireEvent.change(input(), { target: { value: "Memo" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.blur(input());
    expect(sent).toEqual(["Memo", "Memo"]);
    expect(input()).toHaveValue("Memo");
  });

  it("Esc 는 지금 값으로 되돌리고 보내지 않는다", () => {
    const { sent } = setup({ choices: null, value: "A" });
    fireEvent.change(input(), { target: { value: "B" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input()).toHaveValue("A");
    fireEvent.blur(input());
    expect(sent).toEqual([]);
  });

  it("공백뿐이면 null, 공백을 뺀 값이 같으면 보내지 않고 draft 만 정리한다", () => {
    const { sent } = setup({ choices: null, value: "A" });
    fireEvent.change(input(), { target: { value: "A  " } });
    fireEvent.blur(input());
    expect(sent).toEqual([]);
    expect(input()).toHaveValue("A");
    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.blur(input());
    expect(sent).toEqual([null]);
  });

  it("밖에서 value 가 바뀌면 draft 가 따라온다(key 없이 써도)", () => {
    const { rerender } = setup({ choices: null, value: "A" });
    const node = input();
    fireEvent.change(node, { target: { value: "편집 중" } });
    rerender(
      <DocumentLabelField
        value="B"
        onValueChange={() => {}}
        choices={null}
        labels={LABELS}
        testId={TEST_ID}
      />,
    );
    expect(input()).toBe(node);
    expect(input()).toHaveValue("B");
  });

  it("disabled 면 입력이 비활성", () => {
    setup({ choices: null, disabled: true });
    expect(input()).toBeDisabled();
  });
});

describe("DocumentLabelField 입력 commit change", () => {
  it("입력마다 그대로 보내고 빈 값만 null(공백 정리는 호출자)", () => {
    const sent: (string | null)[] = [];
    function Harness() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <DocumentLabelField
          value={value}
          onValueChange={label => {
            sent.push(label);
            setValue(label);
          }}
          choices={null}
          commit="change"
          labels={LABELS}
          testId={TEST_ID}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(input(), { target: { value: " M " } });
    expect(input()).toHaveValue(" M ");
    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.blur(input());
    expect(sent).toEqual([" M ", null]);
    expect(input()).toHaveValue("");
  });
});

describe("DocumentLabelField testid", () => {
  it("testId 가 없으면 testid 를 붙이지 않는다", async () => {
    const { container } = render(
      <DocumentLabelField
        value={null}
        onValueChange={() => {}}
        choices={["A"]}
        labels={LABELS}
      />,
    );
    expect(container.querySelector("[data-testid]")).toBeNull();
    screen.getByRole("combobox").focus();
    await userEvent.keyboard("{Enter}");
    for (const option of screen.getAllByRole("option")) {
      expect(option).not.toHaveAttribute("data-testid");
    }
  });
});

describe("DocumentLabelField DOM 계약", () => {
  const SELECT_TEST_IDS = [
    "label-select",
    "option-no-label",
    "option-label-Z",
    "option-label-A",
    "option-label-B",
  ] as const;

  it("select testid 접미", async () => {
    setup({ value: null });
    await openOptions();
    for (const suffix of SELECT_TEST_IDS.filter(s => s !== "option-label-Z")) {
      expect(byId(suffix)).toBeInTheDocument();
    }
  });

  it("목록 밖 항목 testid 는 option-label-<라벨>", async () => {
    setup({ value: "Z" });
    await openOptions();
    expect(byId(SELECT_TEST_IDS[2])).toHaveTextContent("Z (설정 밖)");
  });

  it("입력 testid 접미는 label-input", () => {
    setup({ choices: null });
    expect(byId("label-input").tagName).toBe("INPUT");
  });

  it("root 요소 없이 조작부 하나만 그린다", () => {
    const { container } = setup({ choices: null });
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(input());
  });
});
