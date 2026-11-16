import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  addChange,
  createSession,
  documentsOf,
  readReviewDocument,
  type ChangeDraft,
  type ReviewSession,
} from "@/lib/review-model";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import { FilmstripOpenContext } from "../filmstrip-open-context";
import {
  JobReviewContext,
  type JobReviewContextValue,
} from "../job-review-context";
import { jobOf, type SaveStatus } from "../job-review-state";
import { OrganizerContext } from "../organizer-context";
import { ReviewPolicyProvider } from "../review-policy";
import { StructurePanel } from "../structure-panel";
import { reviewContext } from "./review-context-fixture";

// jsdom 에서는 `import.meta.url` 이 파일 경로가 아니라서 모델 fixture 모듈 대신 같은 파일을 직접 읽는다.
const SINGLE_JOB = readFileSync(
  join(
    process.cwd(),
    "src/lib/review-model/__tests__/fixtures/single-job.json",
  ),
  "utf8",
);

const TEST_ID = "job-review-structure";
const LABEL_ID = "job-review-structure-label";

interface SessionOptions {
  /** `doc_1` 의 라벨(기본은 fixture 값 "invoice"). */
  label?: string | null;
  /** false 면 분류 Step 의 설정 라벨을 지워 자유 입력 칸을 그린다. */
  choices?: boolean;
}

/** fixture 검수 문서(분류 Step 라벨 invoice·receipt·contract)에서 `doc_1` 라벨·설정 라벨을 바꾼 세션. */
function sessionOf({ label, choices = true }: SessionOptions = {}) {
  const raw = JSON.parse(SINGLE_JOB);
  if (!choices) delete raw.steps.st_classify.labels;
  if (label !== undefined) {
    raw.jobs[0].output[0].content.documents[0].label = label;
  }
  return createSession(readReviewDocument(JSON.stringify(raw)));
}

interface SetupOptions extends SessionOptions {
  save?: SaveStatus;
}

/**
 * 구조 패널을 실제 `useStructureActions` 로 그린다. `APPLY` 는 세션에 실제로 적용해 다시 그리고,
 * 보낸 편집은 `drafts` 에 남긴다. `select(documentId)` 로 선택 문서를 바꾼다.
 */
function setup({ save, ...sessionOptions }: SetupOptions = {}) {
  const drafts: ChangeDraft[] = [];
  const { value: base } = reviewContext({
    state: save ? { save } : {},
  });
  let selectDocument: (documentId: string) => void = () => {};

  function Harness() {
    const [session, setSession] = useState<ReviewSession>(() =>
      sessionOf(sessionOptions),
    );
    const [documentId, setDocumentId] = useState("doc_1");
    selectDocument = setDocumentId;
    const job = jobOf(session)!;
    const selected =
      documentsOf(job).find(
        entry => entry.document.document_id === documentId,
      ) ?? null;
    const value: JobReviewContextValue = {
      ...base,
      state: { ...base.state, session },
      job,
      selected,
      dispatch: action => {
        if (action.type !== "APPLY") return;
        drafts.push(action.draft);
        setSession(current => {
          const outcome = addChange(current, action.draft);
          if (!outcome.ok) throw new Error(outcome.reason);
          return outcome.session;
        });
      },
    };
    return (
      <ReviewPolicyProvider>
        <FilmstripOpenContext.Provider value={[true, () => {}]}>
          <OrganizerContext.Provider
            value={{
              open: false,
              size: "m",
              setOpen: () => {},
              setSize: () => {},
              panelId: "organizer-panel",
              toggleId: "organizer-toggle",
            }}
          >
            <JobReviewContext.Provider value={value}>
              <button type="button" data-testid="outside">
                outside
              </button>
              <StructurePanel />
            </JobReviewContext.Provider>
          </OrganizerContext.Provider>
        </FilmstripOpenContext.Provider>
      </ReviewPolicyProvider>
    );
  }

  const view = renderWithIntl(<Harness />);
  const select = (documentId: string) =>
    act(() => {
      selectDocument(documentId);
    });
  return { ...view, drafts, select };
}

const byId = (suffix: string) => screen.getByTestId(`${TEST_ID}-${suffix}`);
const queryById = (suffix: string) =>
  screen.queryByTestId(`${TEST_ID}-${suffix}`);
const labelInput = () => byId("label-input") as HTMLInputElement;
/** 라벨 칸 영역(칸 제목 `<label>` 의 부모). */
const labelArea = () =>
  document.querySelector(`label[for="${LABEL_ID}"]`)!.parentElement;
const labels = (drafts: readonly ChangeDraft[]) =>
  drafts.map(draft => (draft.kind === "set_label" ? draft.label : draft.kind));

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

const NOT_IN_CONFIG = "설정에 없는 라벨입니다. 그대로 저장할 수 있습니다.";

describe("StructurePanel 라벨 칸 DOM", () => {
  it("select: 설정 라벨이 붙은 문서", () => {
    setup();
    expect(snapshotHtml(labelArea())).toMatchSnapshot();
  });

  it("select: 라벨 없음", () => {
    setup({ label: null });
    expect(snapshotHtml(labelArea())).toMatchSnapshot();
  });

  it("select: 설정 밖 라벨", () => {
    setup({ label: "Memo" });
    expect(snapshotHtml(labelArea())).toMatchSnapshot();
  });

  it("자유 입력", () => {
    setup({ choices: false });
    expect(snapshotHtml(labelArea())).toMatchSnapshot();
  });
});

describe("StructurePanel 라벨 select", () => {
  it("라벨이 있으면 항목은 설정 라벨만(없음 항목 없음), 값은 지금 라벨", async () => {
    setup();
    const trigger = byId("label-select");
    expect(trigger).toHaveClass("w-full");
    expect(trigger).toHaveTextContent("invoice");
    expect(screen.getByLabelText("라벨")).toBe(trigger);
    const options = await openSelect();
    expect(options.map(option => option.textContent)).toEqual([
      "invoice",
      "receipt",
      "contract",
    ]);
    expect(options.map(option => option.getAttribute("data-testid"))).toEqual([
      `${TEST_ID}-option-label-invoice`,
      `${TEST_ID}-option-label-receipt`,
      `${TEST_ID}-option-label-contract`,
    ]);
    expect(queryById("label-input")).toBeNull();
  });

  it("라벨이 null 이면 (라벨 없음) 항목이 맨 앞이고 값이다", async () => {
    setup({ label: null });
    expect(byId("label-select")).toHaveTextContent("(라벨 없음)");
    const options = await openSelect();
    expect(options.map(option => option.getAttribute("data-testid"))).toEqual([
      `${TEST_ID}-option-no-label`,
      `${TEST_ID}-option-label-invoice`,
      `${TEST_ID}-option-label-receipt`,
      `${TEST_ID}-option-label-contract`,
    ]);
  });

  it("form 밖이라 숨은 native select 를 그리지 않는다", () => {
    setup({ label: null });
    expect(labelArea()!.querySelector("select")).toBeNull();
  });

  it("항목을 고르면 그 라벨로 바꾸고, 바뀐 라벨에는 없음 항목이 없다", async () => {
    const { drafts } = setup({ label: null });
    await choose("option-label-receipt");
    expect(drafts).toEqual([
      {
        kind: "set_label",
        jobId: "job_A",
        stepId: "st_classify",
        documentId: "doc_1",
        label: "receipt",
      },
    ]);
    expect(byId("label-select")).toHaveTextContent("receipt");
    const options = await openSelect();
    expect(options.map(option => option.textContent)).toEqual([
      "invoice",
      "receipt",
      "contract",
    ]);
  });

  it("라벨이 설정 밖이면 맨 앞에 (설정에 없음) 항목과 아래 안내 줄", async () => {
    setup({ label: "Memo" });
    expect(byId("label-select")).toHaveTextContent("Memo (설정에 없음)");
    expect(labelArea()).toHaveTextContent(NOT_IN_CONFIG);
    const options = await openSelect();
    expect(options.map(option => option.textContent)).toEqual([
      "Memo (설정에 없음)",
      "invoice",
      "receipt",
      "contract",
    ]);
    expect(options[0]).toHaveAttribute(
      "data-testid",
      `${TEST_ID}-option-label-Memo`,
    );
  });

  it("설정 밖 라벨에서 설정 라벨을 고르면 안내 줄이 사라진다", async () => {
    const { drafts } = setup({ label: "Memo" });
    await choose("option-label-contract");
    expect(labels(drafts)).toEqual(["contract"]);
    expect(labelArea()).not.toHaveTextContent(NOT_IN_CONFIG);
  });

  it("설정 라벨이면 안내 줄이 없다", () => {
    setup();
    expect(labelArea()).not.toHaveTextContent(NOT_IN_CONFIG);
    expect(labelArea()!.querySelector("p")).toBeNull();
  });

  it("편집할 수 없으면(저장 중) select 비활성", () => {
    setup({ save: { phase: "uploading" } });
    expect(byId("label-select")).toBeDisabled();
  });
});

describe("StructurePanel 라벨 자유 입력", () => {
  it("id·placeholder·maxLength, 값은 지금 라벨", () => {
    setup({ choices: false });
    const input = labelInput();
    expect(input).toHaveAttribute("id", LABEL_ID);
    expect(input).toHaveAttribute("placeholder", "(라벨 없음)");
    expect(input).toHaveAttribute("maxlength", "200");
    expect(input).toHaveValue("invoice");
    expect(input).not.toBeDisabled();
    expect(screen.getByLabelText("라벨")).toBe(input);
    expect(queryById("label-select")).toBeNull();
  });

  it("라벨 null 이면 빈 칸", () => {
    setup({ choices: false, label: null });
    expect(labelInput()).toHaveValue("");
  });

  it("blur 에 다듬은 값으로 확정한다", async () => {
    const { drafts } = setup({ choices: false });
    await userEvent.clear(labelInput());
    await userEvent.type(labelInput(), "  Memo  ");
    expect(drafts).toEqual([]);
    await userEvent.click(screen.getByTestId("outside"));
    expect(drafts).toEqual([
      {
        kind: "set_label",
        jobId: "job_A",
        stepId: "st_classify",
        documentId: "doc_1",
        label: "Memo",
      },
    ]);
    expect(labelInput()).toHaveValue("Memo");
  });

  it("Enter 에 확정하고 기본 동작을 막는다, 뒤따르는 blur 는 다시 보내지 않는다", async () => {
    const { drafts } = setup({ choices: false });
    await userEvent.clear(labelInput());
    await userEvent.type(labelInput(), "Memo");
    const notPrevented = fireEvent.keyDown(labelInput(), { key: "Enter" });
    expect(notPrevented).toBe(false);
    expect(labels(drafts)).toEqual(["Memo"]);
    labelInput().focus();
    await userEvent.click(screen.getByTestId("outside"));
    expect(labels(drafts)).toEqual(["Memo"]);
  });

  it("Enter 확정 뒤 입력이 다시 마운트되어 포커스가 입력에 남지 않는다", async () => {
    setup({ choices: false });
    const before = labelInput();
    await userEvent.clear(before);
    await userEvent.type(before, "Memo{Enter}");
    const after = labelInput();
    expect(after).not.toBe(before);
    expect(after).toHaveValue("Memo");
    expect(document.activeElement).not.toBe(after);
    expect(document.activeElement).toBe(document.body);
  });

  it("Esc 는 지금 라벨로 되돌리고 보내지 않는다", async () => {
    const { drafts } = setup({ choices: false });
    await userEvent.clear(labelInput());
    await userEvent.type(labelInput(), "Memo{Escape}");
    expect(labelInput()).toHaveValue("invoice");
    await userEvent.click(screen.getByTestId("outside"));
    expect(drafts).toEqual([]);
  });

  it("손대지 않았거나 다듬은 값이 같으면 보내지 않는다", async () => {
    const { drafts } = setup({ choices: false });
    labelInput().focus();
    await userEvent.click(screen.getByTestId("outside"));
    await userEvent.type(labelInput(), " ");
    expect(labelInput()).toHaveValue("invoice ");
    await userEvent.click(screen.getByTestId("outside"));
    expect(drafts).toEqual([]);
    expect(labelInput()).toHaveValue("invoice");
  });

  it("공백만 남기면 null 로 보낸다", async () => {
    const { drafts } = setup({ choices: false });
    await userEvent.clear(labelInput());
    await userEvent.type(labelInput(), "   ");
    await userEvent.click(screen.getByTestId("outside"));
    expect(labels(drafts)).toEqual([null]);
    expect(labelInput()).toHaveValue("");
  });

  it("확정해 라벨이 바뀌면 입력이 다시 마운트된다", async () => {
    setup({ choices: false });
    const before = labelInput();
    await userEvent.clear(before);
    await userEvent.type(before, "Memo");
    await userEvent.click(screen.getByTestId("outside"));
    const after = labelInput();
    expect(after).not.toBe(before);
    expect(after).toHaveValue("Memo");
  });

  it("문서가 바뀌면 다시 마운트되고 편집 중이던 값은 보내지 않는다", async () => {
    const { drafts, select } = setup({ choices: false });
    const before = labelInput();
    await userEvent.clear(before);
    await userEvent.type(before, "Memo");
    select("doc_2");
    const after = labelInput();
    expect(after).not.toBe(before);
    expect(after).toHaveValue("receipt");
    expect(drafts).toEqual([]);
  });

  it("편집 중 언마운트는 확정하지 않는다", async () => {
    const { drafts, unmount } = setup({ choices: false });
    await userEvent.clear(labelInput());
    await userEvent.type(labelInput(), "Memo");
    unmount();
    expect(drafts).toEqual([]);
  });

  it("편집할 수 없으면(저장 중) 입력 비활성", () => {
    setup({ choices: false, save: { phase: "uploading" } });
    expect(labelInput()).toBeDisabled();
  });
});
