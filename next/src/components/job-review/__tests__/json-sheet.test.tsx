import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { editedText } from "../download";
import { JobReviewContext } from "../job-review-context";
import { JsonSheet, type JsonSheetSeed } from "../json-sheet";
import { reviewContext } from "./review-context-fixture";

const ORIGINAL = '{"original":true}';

function setup(seed: Partial<JsonSheetSeed> = {}) {
  const { value } = reviewContext({
    changes: 1,
    state: { jsonSheetOpen: true, sourceText: ORIGINAL },
  });
  const edited = editedText(value.state.session!.current);
  renderWithIntl(
    <JobReviewContext.Provider value={value}>
      <JsonSheet
        seed={{ key: 1, text: edited, basis: { kind: "edited" }, ...seed }}
        onPickFile={vi.fn()}
        fileError={null}
      />
    </JobReviewContext.Provider>,
  );
  return { edited };
}

const basis = () => screen.getByTestId("job-review-json-sheet-basis");
const textarea = () =>
  screen.getByTestId("job-review-json-sheet-editor-textarea");

describe("JsonSheet 지금 내용 기준 줄", () => {
  it("현재 편집본으로 열면 edited, 고치지 않음", () => {
    setup();
    expect(basis()).toHaveAttribute("role", "status");
    expect(basis()).toHaveAttribute("data-basis", "edited");
    expect(basis()).toHaveAttribute("data-modified", "false");
    expect(basis()).toHaveTextContent(
      "지금 내용: 현재 편집본 — 화면에서 고친 내용(저장 전 포함)이 들어 있습니다.",
    );
  });

  it("원본 불러오기 → original, 타이핑 → 직접 고침, 현재 편집본 불러오기 → edited 로 돌아가 고침 해제", () => {
    const { edited } = setup();
    fireEvent.click(
      screen.getByTestId("job-review-json-sheet-button-load-original"),
    );
    expect(basis()).toHaveAttribute("data-basis", "original");
    expect(basis()).toHaveAttribute("data-modified", "false");
    expect(textarea()).toHaveValue(ORIGINAL);
    expect(basis()).toHaveTextContent("지금 내용: 원본");

    fireEvent.change(textarea(), { target: { value: '{"typed":1}' } });
    expect(basis()).toHaveAttribute("data-basis", "original");
    expect(basis()).toHaveAttribute("data-modified", "true");
    expect(basis()).toHaveTextContent("· 이 창에서 직접 고침");

    // 불러온 그대로로 되돌리면 고침 표시도 사라진다.
    fireEvent.change(textarea(), { target: { value: ORIGINAL } });
    expect(basis()).toHaveAttribute("data-modified", "false");

    fireEvent.change(textarea(), { target: { value: "{}" } });
    fireEvent.click(
      screen.getByTestId("job-review-json-sheet-button-load-edited"),
    );
    expect(basis()).toHaveAttribute("data-basis", "edited");
    expect(basis()).toHaveAttribute("data-modified", "false");
    expect(textarea()).toHaveValue(edited);
    expect(basis()).not.toHaveTextContent("이 창에서 직접 고침");
  });

  it("파일로 열면 file + 파일 이름, 불러옴 안내는 이름 없이 한 번만", () => {
    setup({
      text: ORIGINAL,
      basis: { kind: "file", name: "review.json" },
      notice: "파일을 불러왔습니다. 검사한 뒤 적용하세요.",
    });
    expect(basis()).toHaveAttribute("data-basis", "file");
    expect(basis()).toHaveTextContent("지금 내용: 파일 review.json");
    expect(screen.getAllByText(/review\.json/)).toHaveLength(1);
    expect(
      screen.getByText("파일을 불러왔습니다. 검사한 뒤 적용하세요."),
    ).toBeInTheDocument();
  });
});
