import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import { ChangeTraySheet } from "../change-tray-sheet";
import { JobReviewContext } from "../job-review-context";
import {
  BLOCKING_ISSUE,
  reviewContext,
  type ContextOptions,
} from "./review-context-fixture";

function setup(options: ContextOptions = {}) {
  const { value, calls } = reviewContext({
    ...options,
    state: { trayOpen: true, ...options.state },
  });
  renderWithIntl(
    <JobReviewContext.Provider value={value}>
      <ChangeTraySheet />
    </JobReviewContext.Provider>,
  );
  return { value, calls };
}

const saveButton = () => screen.getByTestId("job-review-tray-button-save");
/** 트레이 아래 저장 영역(저장 버튼과 그 아래 안내 한 줄). */
const footer = () => saveButton().parentElement!;

const CONFLICT = {
  phase: "conflict",
  importId: "imp_1",
  conflict: { entryIds: [], resultIds: [], structure: false, count: 1 },
} as const;

describe("ChangeTraySheet 저장 영역", () => {
  it("변경 0: 저장 비활성, 안내 없음", () => {
    setup();
    expect(snapshotHtml(footer())).toMatchSnapshot();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent("저장");
    expect(footer().children).toHaveLength(1);
  });

  it("변경 있음: 저장 활성(기본 variant, title·단축키 없음), 누르면 save", () => {
    const { calls } = setup({ changes: 2 });
    expect(snapshotHtml(footer())).toMatchSnapshot();
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveAttribute("data-variant", "default");
    expect(saveButton()).not.toHaveAttribute("title");
    expect(saveButton()).not.toHaveAttribute("aria-keyshortcuts");
    expect(saveButton()).not.toHaveAttribute("aria-describedby");
    fireEvent.click(saveButton());
    expect(calls.save).toHaveBeenCalledTimes(1);
  });

  it("저장 중: 비활성, 글자 저장 중…", () => {
    setup({ changes: 2, state: { save: { phase: "uploading" } } });
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent("저장 중…");
  });

  it("충돌: 비활성 + 충돌 안내와 aria-describedby 로 잇는다", () => {
    setup({ changes: 2, state: { save: CONFLICT } });
    expect(snapshotHtml(footer())).toMatchSnapshot();
    expect(saveButton()).toBeDisabled();
    const hint = screen.getByTestId("job-review-tray-save-conflict-hint");
    expect(hint.id).not.toBe("");
    expect(saveButton()).toHaveAttribute("aria-describedby", hint.id);
    expect(hint).toHaveTextContent(
      "다시 저장해도 같은 충돌이 납니다. 먼저 다시 불러온 뒤 저장하세요.",
    );
  });

  it("충돌이면 차단 문제가 있어도 충돌 안내만 보인다", () => {
    setup({ changes: 2, state: { save: CONFLICT }, issues: [BLOCKING_ISSUE] });
    expect(footer().children).toHaveLength(2);
    expect(
      screen.getByTestId("job-review-tray-save-conflict-hint"),
    ).toBeInTheDocument();
    expect(footer()).not.toHaveTextContent(
      "위 문제를 고쳐야 저장할 수 있습니다.",
    );
  });

  it("차단 문제: 비활성 + 차단 안내(머리 저장과 다름)", () => {
    setup({ changes: 2, issues: [BLOCKING_ISSUE] });
    expect(snapshotHtml(footer())).toMatchSnapshot();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).not.toHaveAttribute("aria-describedby");
    expect(footer().children[1]).toHaveTextContent(
      "위 문제를 고쳐야 저장할 수 있습니다.",
    );
  });

  it("차단 문제가 있어도 변경이 없으면 차단 안내는 없다", () => {
    setup({ issues: [BLOCKING_ISSUE] });
    expect(saveButton()).toBeDisabled();
    expect(footer().children).toHaveLength(1);
  });

  it("경고만 있으면 저장 활성", () => {
    setup({
      changes: 2,
      issues: [{ ...BLOCKING_ISSUE, severity: "warning" }],
    });
    expect(saveButton()).toBeEnabled();
    expect(footer().children).toHaveLength(1);
  });

  it("업로드 크기 초과: 비활성 + 차단 안내", () => {
    setup({
      changes: 2,
      state: { capabilities: { max_inline_import_bytes: 10 } },
    });
    expect(saveButton()).toBeDisabled();
    expect(footer().children[1]).toHaveTextContent(
      "위 문제를 고쳐야 저장할 수 있습니다.",
    );
  });

  it("크기 한도 안이면 저장 활성", () => {
    setup({
      changes: 2,
      state: { capabilities: { max_inline_import_bytes: 10_000_000 } },
    });
    expect(saveButton()).toBeEnabled();
  });
});
