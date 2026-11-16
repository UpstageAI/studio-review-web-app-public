import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  PageRangeEditor,
  type PageRangeEditorLabels,
  type PageRangeEditorProps,
} from "@/components/studio-ui-kit/page-range-editor/page-range-editor";

const LABELS: PageRangeEditorLabels = {
  file: row => `파일 ${row}`,
  range: row => `범위 ${row}`,
  placeholder: "1-3, 5",
  removeRow: row => `${row}행 지우기`,
  addRow: "행 추가",
};

function renderEditor(overrides: Partial<PageRangeEditorProps> = {}) {
  const props: PageRangeEditorProps = {
    rows: [
      { fileRef: "a.pdf", text: "1-2" },
      { fileRef: "b.pdf", text: "3" },
    ],
    fileOptions: [
      { fileRef: "a.pdf", name: "a.pdf" },
      { fileRef: "b.pdf", name: "b.pdf" },
    ],
    validate: () => null,
    labels: LABELS,
    testId: "range",
    ...overrides,
  };
  return render(<PageRangeEditor {...props} />);
}

/**
 * Studio UI Kit item 문서의 "DOM 계약" 중 `page-range-editor` 행: 범위 입력의 `data-range-row` 는 0 부터의 행
 * 번호이고, 행을 더한 뒤 포커스를 옮기는 내부 조회가 이 값을 읽는다.
 */
const DOM_CONTRACT = [
  { attribute: "data-range-row", on: "범위 입력(`-input-range`)" },
] as const;

describe("PageRangeEditor DOM 계약", () => {
  it.each(DOM_CONTRACT)("$attribute 가 $on 에 붙는다", ({ attribute }) => {
    renderEditor();
    for (const input of screen.getAllByTestId("range-input-range")) {
      expect(input).toHaveAttribute(attribute);
    }
  });

  it("data-range-row 는 행 순서대로 0, 1, …", () => {
    renderEditor();
    expect(
      screen
        .getAllByTestId("range-input-range")
        .map(input => [
          input.getAttribute("data-range-row"),
          (input as HTMLInputElement).value,
        ]),
    ).toEqual([
      ["0", "1-2"],
      ["1", "3"],
    ]);
  });

  it("행을 더하면 새 행 번호가 붙고 그 입력으로 포커스가 간다", async () => {
    renderEditor();
    fireEvent.click(screen.getByTestId("range-button-add"));
    const inputs = screen.getAllByTestId("range-input-range");
    expect(inputs.map(input => input.getAttribute("data-range-row"))).toEqual([
      "0",
      "1",
      "2",
    ]);
    await waitFor(() => expect(document.activeElement).toBe(inputs[2]));
  });
});
