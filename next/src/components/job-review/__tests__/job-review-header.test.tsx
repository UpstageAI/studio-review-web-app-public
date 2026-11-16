import { act, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REVIEW_FEATURES_KEY } from "@/lib/review-policy/review-features";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import { JobReviewContext } from "../job-review-context";
import { JobReviewHeader } from "../job-review-header";
import type { SaveStatus } from "../job-review-state";
import { ReviewPolicyProvider } from "../review-policy";
import type { UseJobReviewHeaderExtension } from "../header-extension";
import {
  BLOCKING_ISSUE,
  reviewContext,
  type ContextOptions,
} from "./review-context-fixture";

// 머리의 돌아가기 링크는 라우터 없이 그릴 수 있게 평범한 링크로 바꾼다. "나가기" 뒤 이동은 push 로 본다.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  localStorage.clear();
  routerPush.mockReset();
  vi.restoreAllMocks();
});

const queueExtension: UseJobReviewHeaderExtension = () => ({
  extras: null,
  advancesAfterComplete: true,
  onCompleted: () => {},
});

interface SetupOptions extends ContextOptions {
  features?: { jsonMenu?: boolean; history?: boolean };
  useHeaderExtension?: UseJobReviewHeaderExtension;
}

function setup({
  features,
  useHeaderExtension,
  ...options
}: SetupOptions = {}) {
  if (features) {
    localStorage.setItem(REVIEW_FEATURES_KEY, JSON.stringify(features));
  }
  const { value, calls } = reviewContext(options);
  const view = renderWithIntl(
    <ReviewPolicyProvider>
      <JobReviewContext.Provider value={value}>
        <JobReviewHeader useHeaderExtension={useHeaderExtension} />
      </JobReviewContext.Provider>
      <input data-testid="outside-input" />
      <div role="dialog">
        <button type="button" data-testid="dialog-button" />
      </div>
    </ReviewPolicyProvider>,
  );
  return { ...view, value, calls };
}

/** 헤더 오른쪽 버튼 줄(저장 상태 문구 · slot · 변경 사항 · 저장 · 주 동작). */
const actionsRow = () =>
  screen.getByTestId("job-review-save-status").parentElement!;
const saveButton = () => screen.getByTestId("job-review-button-save");
const completeButton = () => screen.getByTestId("job-review-button-complete");
const statusText = () =>
  screen.getByTestId("job-review-save-status")
    .firstElementChild as HTMLElement | null;

describe("JobReviewHeader 버튼 줄", () => {
  it("불러오는 중에는 자리 표시 3 개만 있고 버튼 줄이 없다", () => {
    const { container } = setup({
      state: { status: "loading", session: null },
    });
    expect(screen.queryByTestId("job-review-save-status")).toBeNull();
    expect(screen.queryByTestId("job-review-button-save")).toBeNull();
    const skeletons = container.querySelector(
      "div.flex.items-center.gap-2.xl\\:justify-self-end",
    );
    expect(skeletons?.children).toHaveLength(3);
  });

  it("Job 이 없으면(불러오기 실패) 버튼 줄이 없다", () => {
    setup({ state: { status: "error", session: null } });
    expect(screen.queryByTestId("job-review-save-status")).toBeNull();
    expect(screen.queryByTestId("job-review-tray-button-open")).toBeNull();
    expect(screen.queryByTestId("job-review-review-status-notice")).toBeNull();
  });

  it("변경 0 · 검수 중: 저장 비활성(outline), 완료 활성, 배지 없음", () => {
    setup();
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute("data-variant", "outline");
    expect(completeButton()).toBeEnabled();
    expect(completeButton()).toHaveTextContent("검수 완료");
    expect(completeButton()).toHaveAttribute("data-save-first", "false");
    expect(completeButton()).toHaveAttribute("data-advance", "false");
    expect(screen.queryByTestId("job-review-change-count")).toBeNull();
    expect(screen.getByTestId("job-review-save-status")).toBeEmptyDOMElement();
  });

  it("변경 3 · 검수 중: 저장 활성이지만 outline, 주 동작은 저장하고 완료", () => {
    setup({ changes: 3 });
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveAttribute("data-variant", "outline");
    expect(completeButton()).toBeEnabled();
    expect(completeButton()).toHaveTextContent("저장하고 완료");
    expect(completeButton()).toHaveAttribute("data-save-first", "true");
    expect(completeButton()).toHaveAttribute(
      "title",
      "저장하고 완료 (⌘Enter 또는 Ctrl+Enter)",
    );
    expect(screen.getByTestId("job-review-change-count")).toHaveTextContent(
      "3",
    );
  });

  it("변경 3 · 검수 완료: 저장은 default, 주 동작은 다시 열기(title·단축키 없음)", () => {
    setup({ changes: 3, reviewStatus: { value: "done" } });
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveAttribute("data-variant", "default");
    expect(screen.queryByTestId("job-review-button-complete")).toBeNull();
    const reopen = screen.getByTestId("job-review-button-reopen");
    expect(reopen).toBeEnabled();
    expect(reopen).toHaveTextContent("검수 중으로 되돌리기");
    expect(reopen).toHaveAttribute("data-variant", "outline");
    expect(reopen).not.toHaveAttribute("title");
    expect(reopen).not.toHaveAttribute("aria-keyshortcuts");
  });

  it.each<SaveStatus>([
    { phase: "uploading" },
    { phase: "polling", importId: "imp_1" },
    {
      phase: "reloading",
      importId: "imp_1",
      revision: 4,
      partial: false,
    },
  ])("저장 중($phase): 저장 비활성·글자 저장 중…, 완료 비활성", save => {
    setup({ changes: 2, state: { save } });
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveTextContent("저장 중…");
    expect(completeButton()).toBeDisabled();
  });

  it("저장 중(uploading) 버튼 줄", () => {
    setup({ changes: 2, state: { save: { phase: "uploading" } } });
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
  });

  it("충돌: 저장 비활성 + 충돌 안내와 aria-describedby 로 잇는다", () => {
    setup({
      changes: 2,
      state: {
        save: {
          phase: "conflict",
          importId: "imp_1",
          conflict: { entryIds: [], resultIds: [], structure: false, count: 1 },
        },
      },
    });
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
    expect(saveButton()).toBeDisabled();
    expect(completeButton()).toBeDisabled();
    const hint = screen.getByTestId("job-review-save-conflict-hint");
    expect(hint.id).not.toBe("");
    expect(saveButton()).toHaveAttribute("aria-describedby", hint.id);
  });

  it("충돌이 아니면 aria-describedby 가 없다", () => {
    setup({ changes: 2 });
    expect(saveButton()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByTestId("job-review-save-conflict-hint")).toBeNull();
  });

  it("차단 문제가 있어도 머리의 저장·저장하고 완료는 켜져 있다(트레이와 다름)", () => {
    setup({ changes: 2, issues: [BLOCKING_ISSUE] });
    expect(saveButton()).toBeEnabled();
    expect(completeButton()).toBeEnabled();
    expect(completeButton()).toHaveAttribute("data-save-first", "true");
  });

  it.each<{
    name: string;
    save: SaveStatus;
    text: string;
    className: string;
    title: string | null;
  }>([
    {
      name: "uploading",
      save: { phase: "uploading" },
      text: "저장 중…",
      className: "text-muted-foreground",
      title: null,
    },
    {
      name: "polling",
      save: { phase: "polling", importId: "imp_1" },
      text: "저장 중…",
      className: "text-muted-foreground",
      title: null,
    },
    {
      name: "reloading",
      save: {
        phase: "reloading",
        importId: "imp_1",
        revision: 3,
        partial: false,
      },
      text: "다시 불러오는 중…",
      className: "text-muted-foreground",
      title: null,
    },
    {
      name: "saved(revision 있음)",
      save: {
        phase: "saved",
        importId: "imp_1",
        revision: 7,
        partial: false,
        reloadFailed: null,
      },
      text: "저장됨",
      className: "",
      title: "저장 버전 7",
    },
    {
      name: "saved(revision 없음)",
      save: {
        phase: "saved",
        importId: "imp_1",
        revision: null,
        partial: false,
        reloadFailed: null,
      },
      text: "저장됨",
      className: "",
      title: null,
    },
    {
      name: "saved(reloadFailed)",
      save: {
        phase: "saved",
        importId: "imp_1",
        revision: 7,
        partial: false,
        reloadFailed: "network",
      },
      text: "저장됨, 다시 불러오지 못함",
      className: "text-destructive",
      title: null,
    },
    {
      name: "no_change",
      save: { phase: "no_change", importId: null },
      text: "바뀐 내용 없음",
      className: "text-muted-foreground",
      title: null,
    },
    {
      name: "conflict",
      save: {
        phase: "conflict",
        importId: "imp_1",
        conflict: { entryIds: [], resultIds: [], structure: false, count: 1 },
      },
      text: "충돌, 다시 불러오기 필요",
      className: "text-destructive",
      title: null,
    },
    {
      name: "blocked",
      save: { phase: "blocked", reason: "issues" },
      text: "저장하지 못함",
      className: "text-destructive",
      title: null,
    },
    {
      name: "failed",
      save: {
        phase: "failed",
        code: "x",
        importId: null,
        message: null,
        resultId: null,
        fieldPointer: null,
        entryIds: [],
      },
      text: "저장하지 못함",
      className: "text-destructive",
      title: null,
    },
    {
      name: "stopped",
      save: {
        phase: "stopped",
        reason: "timeout",
        importId: "imp_1",
        code: null,
      },
      text: "저장하지 못함",
      className: "text-destructive",
      title: null,
    },
  ])("저장 상태 문구 $name", ({ save, text, className, title }) => {
    setup({ state: { save } });
    const outer = screen.getByTestId("job-review-save-status");
    expect(outer).toHaveAttribute("aria-live", "polite");
    expect(outer).toHaveClass("empty:hidden");
    const inner = statusText()!;
    expect(inner).toHaveTextContent(text);
    expect(inner.getAttribute("class") ?? "").toBe(className);
    expect(inner.getAttribute("title")).toBe(title);
  });

  it("저장 완료(revision 있음) 버튼 줄", () => {
    setup({
      state: {
        save: {
          phase: "saved",
          importId: "imp_1",
          revision: 7,
          partial: false,
          reloadFailed: null,
        },
      },
    });
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
  });

  it("검수 상태를 바꾸는 중(complete): 글자 처리 중…, 비활성", () => {
    setup({ reviewStatus: { updating: "complete" } });
    expect(completeButton()).toHaveTextContent("처리 중…");
    expect(completeButton()).toBeDisabled();
  });

  it("되돌리는 중(reopen): 다시 열기 글자 처리 중…, 비활성", () => {
    setup({ reviewStatus: { value: "done", updating: "reopen" } });
    const reopen = screen.getByTestId("job-review-button-reopen");
    expect(reopen).toHaveTextContent("처리 중…");
    expect(reopen).toBeDisabled();
  });

  it("검수 상태를 아직 모르면 완료 비활성", () => {
    setup({ reviewStatus: { value: "unknown" } });
    expect(completeButton()).toBeDisabled();
    expect(completeButton()).toHaveTextContent("검수 완료");
  });

  it("검수 큐가 다음으로 넘기면: 완료 후 다음 Job / 저장하고 다음 Job, data-advance", () => {
    const first = setup({ useHeaderExtension: queueExtension });
    expect(completeButton()).toHaveTextContent("완료 후 다음 Job");
    expect(completeButton()).toHaveAttribute("data-advance", "true");
    expect(snapshotHtml(actionsRow())).toMatchSnapshot();
    first.unmount();
    setup({ changes: 1, useHeaderExtension: queueExtension });
    expect(completeButton()).toHaveTextContent("저장하고 다음 Job");
    expect(completeButton()).toHaveAttribute("data-advance", "true");
    expect(completeButton()).toHaveAttribute("data-save-first", "true");
  });

  it.each([
    { jsonMenu: false, history: false },
    { jsonMenu: true, history: false },
    { jsonMenu: false, history: true },
    { jsonMenu: true, history: true },
  ])(
    "JSON 메뉴 $jsonMenu · 이력 $history: 상태 문구와 변경 사항 사이 slot",
    features => {
      setup({ features });
      const row = actionsRow();
      const children = [...row.children];
      expect(children[0]).toBe(screen.getByTestId("job-review-save-status"));
      const tray = screen.getByTestId("job-review-tray-button-open");
      // JSON 메뉴는 트리거와 숨은 파일 입력 둘을, 이력은 버튼(지원하지 않으면 툴팁 감싸개)을 그린다.
      const slot = children
        .slice(1, children.indexOf(tray))
        .map(child => child.getAttribute("data-testid"));
      expect(slot).toEqual([
        ...(features.jsonMenu
          ? ["job-review-json-menu-trigger", "job-review-json-input-file"]
          : []),
        ...(features.history ? ["job-review-history-button-open-wrapper"] : []),
      ]);
      expect(children.slice(children.indexOf(tray) + 1)).toEqual([
        saveButton(),
        completeButton(),
      ]);
      expect(snapshotHtml(row)).toMatchSnapshot();
    },
  );
});

describe("JobReviewHeader 클릭", () => {
  it("변경 사항 → OPEN_TRAY, aria-expanded 는 트레이 열림을 따른다", () => {
    const { calls } = setup({ changes: 1 });
    const tray = screen.getByTestId("job-review-tray-button-open");
    expect(tray).toHaveAttribute("aria-haspopup", "dialog");
    expect(tray).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(tray);
    expect(calls.dispatch).toHaveBeenCalledWith({ type: "OPEN_TRAY" });
  });

  it("트레이가 열려 있으면 aria-expanded true", () => {
    setup({ changes: 1, state: { trayOpen: true } });
    expect(screen.getByTestId("job-review-tray-button-open")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("저장 → save 한 번", () => {
    const { calls } = setup({ changes: 1 });
    fireEvent.click(saveButton());
    expect(calls.save).toHaveBeenCalledTimes(1);
  });

  it("완료 → completeReview, 저장은 부르지 않는다", async () => {
    const { calls } = setup();
    await act(async () => {
      fireEvent.click(completeButton());
    });
    expect(calls.completeReview).toHaveBeenCalledTimes(1);
    expect(calls.save).not.toHaveBeenCalled();
  });

  it("저장하고 완료 → save 먼저(완료는 저장 결과를 기다린다)", async () => {
    const { calls } = setup({ changes: 1 });
    await act(async () => {
      fireEvent.click(completeButton());
    });
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.completeReview).not.toHaveBeenCalled();
  });

  it("다시 열기 → reopenReview", async () => {
    const { calls } = setup({ reviewStatus: { value: "done" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("job-review-button-reopen"));
    });
    expect(calls.reopenReview).toHaveBeenCalledTimes(1);
  });
});

describe("JobReviewHeader 단축키", () => {
  const key = (target: Element, init: KeyboardEventInit) =>
    fireEvent.keyDown(target, { ctrlKey: true, ...init });

  it("⌘/Ctrl+S: 저장할 수 있으면 save, 기본 동작은 막는다", () => {
    const { calls } = setup({ changes: 1 });
    const notPrevented = key(document.body, { key: "s" });
    expect(notPrevented).toBe(false);
    expect(calls.save).toHaveBeenCalledTimes(1);
  });

  it("⌘/Ctrl+S: 저장할 것이 없어도 기본 동작을 막고 save 는 부르지 않는다", () => {
    const { calls } = setup();
    const notPrevented = key(document.body, { key: "s", metaKey: true });
    expect(notPrevented).toBe(false);
    expect(calls.save).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl+S: 충돌 중에는 save 를 부르지 않는다", () => {
    const { calls } = setup({
      changes: 1,
      state: {
        save: {
          phase: "conflict",
          importId: "imp_1",
          conflict: { entryIds: [], resultIds: [], structure: false, count: 1 },
        },
      },
    });
    expect(key(document.body, { key: "s" })).toBe(false);
    expect(calls.save).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl+S: 차단 문제가 있어도 save 를 부른다", () => {
    const { calls } = setup({ changes: 1, issues: [BLOCKING_ISSUE] });
    key(document.body, { key: "s" });
    expect(calls.save).toHaveBeenCalledTimes(1);
  });

  it("⌘/Ctrl+S: 편집 칸 안이면 blur 한 뒤 다음 작업에서 저장한다", async () => {
    const { calls } = setup({ changes: 1 });
    const input = screen.getByTestId("outside-input");
    input.focus();
    expect(document.activeElement).toBe(input);
    expect(key(input, { key: "s" })).toBe(false);
    expect(document.activeElement).not.toBe(input);
    expect(calls.save).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(calls.save).toHaveBeenCalledTimes(1);
  });

  it("⌘/Ctrl+Enter: 편집 칸·대화 상자 밖에서 완료", async () => {
    const { calls } = setup();
    await act(async () => {
      key(document.body, { key: "Enter" });
    });
    expect(calls.completeReview).toHaveBeenCalledTimes(1);
  });

  it("⌘/Ctrl+Enter: 변경이 있으면 저장하고 완료(save 먼저)", async () => {
    const { calls } = setup({ changes: 1 });
    await act(async () => {
      key(document.body, { key: "Enter" });
    });
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.completeReview).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl+Enter: 편집 칸이나 대화 상자 안에서는 아무것도 하지 않는다", async () => {
    const { calls } = setup();
    await act(async () => {
      expect(key(screen.getByTestId("outside-input"), { key: "Enter" })).toBe(
        true,
      );
      expect(key(screen.getByTestId("dialog-button"), { key: "Enter" })).toBe(
        true,
      );
    });
    expect(calls.completeReview).not.toHaveBeenCalled();
    expect(calls.save).not.toHaveBeenCalled();
  });

  it("⌘/Ctrl+Enter: 검수 완료 Job 에서는 다시 열기를 부르지 않는다", async () => {
    const { calls } = setup({ reviewStatus: { value: "done" } });
    await act(async () => {
      key(document.body, { key: "Enter" });
    });
    expect(calls.reopenReview).not.toHaveBeenCalled();
    expect(calls.completeReview).not.toHaveBeenCalled();
  });
});

// 확인 창 host 가 없는 테스트라 이탈 확인은 브라우저 기본 확인 창(`window.confirm`)으로 답한다.
describe("JobReviewHeader 돌아가기 링크", () => {
  const back = () => screen.getByTestId("job-review-link-back");
  const click = async (init: MouseEventInit = {}) => {
    let notPrevented = true;
    await act(async () => {
      notPrevented = fireEvent.click(back(), init);
    });
    return notPrevented;
  };

  it("변경이 없으면 묻지 않고 링크 기본 이동을 둔다", async () => {
    const confirm = vi.spyOn(window, "confirm");
    setup();
    expect(await click()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("변경이 있으면 기본 이동을 막고 묻는다. 머무르면 옮기지 않는다", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setup({ changes: 2 });
    expect(await click()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("변경이 있어도 나가기를 고르면 Collection 상세로 옮긴다", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup({ changes: 2 });
    expect(await click()).toBe(false);
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith(back().getAttribute("href"));
  });

  it("새 탭으로 여는 클릭은 변경이 있어도 묻지 않는다", async () => {
    const confirm = vi.spyOn(window, "confirm");
    setup({ changes: 2 });
    expect(await click({ metaKey: true })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });
});
