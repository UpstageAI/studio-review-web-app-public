import { describe, expect, it } from "vitest";

import {
  addChange,
  createSession,
  ExactNumber,
  type ChangeDraft,
  type JsonValue,
  type ReviewJob,
} from "@/lib/review-model";
import type { MachineTarget } from "@/lib/revision-history";
import type { JobRevision } from "@/lib/review-api/types";

import { singleJob } from "../../../lib/review-model/__tests__/fixtures/builders";
import {
  asJson,
  revision,
  structureOf,
} from "../../../lib/revision-history/__tests__/helpers";
import {
  buildHistoryItems,
  documentLabels,
  historyAvailability,
  loadAvailability,
  machinePlacementOf,
  machineTargetVisible,
  planGroupLoad,
  targetChangedSince,
  withOrigin,
  type HistoryItem,
  type LoadAvailabilityInput,
} from "../history-model";
import type { SaveStatus } from "../job-review-state";

describe("historyAvailability", () => {
  it("지원 여부를 모르면 unknown, true 가 아니면 unsupported", () => {
    expect(historyAvailability(null)).toEqual({ ok: false, reason: "unknown" });
    expect(historyAvailability({})).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(historyAvailability({ revisions_supported: false })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(historyAvailability({ revisions_supported: true })).toEqual({
      ok: true,
    });
  });
});

describe("loadAvailability", () => {
  const { doc, job } = singleJob();
  const session = createSession(doc);
  const IDLE: SaveStatus = { phase: "idle" };
  const OTHER: JsonValue = { amount: 1, currency: "KRW" };
  const row = revision({ id: "rev_1", version: 1 });
  const withContent = (
    content: JsonValue | null,
    extra: Partial<JobRevision> = {},
  ): JobRevision => ({ ...row, content, base_content: OTHER, ...extra });

  const input = (
    overrides: Partial<LoadAvailabilityInput> = {},
  ): LoadAvailabilityInput => ({
    session,
    save: IDLE,
    revision: row,
    detail: withContent(OTHER),
    source: "content",
    isCurrent: false,
    ...overrides,
  });

  const blockOf = (overrides: Partial<LoadAvailabilityInput> = {}) => {
    const outcome = loadAvailability(input(overrides));
    return outcome.ok ? "ok" : outcome.block;
  };

  it("다른 값이면 결과 content 전체를 바꾸는 draft", () => {
    const outcome = loadAvailability(input());
    expect(outcome).toEqual({
      ok: true,
      draft: {
        kind: "replace_subtree",
        jobId: job.id,
        resultId: "occ_extract_1",
        path: [],
        value: OTHER,
      },
    });
  });

  it("저장 중 · 충돌이 가장 먼저 막는다", () => {
    expect(blockOf({ save: { phase: "uploading" }, isCurrent: true })).toBe(
      "saving",
    );
    expect(blockOf({ save: { phase: "polling", importId: "imp" } })).toBe(
      "saving",
    );
    expect(
      blockOf({
        save: {
          phase: "conflict",
          importId: "imp",
          conflict: {
            entryIds: [],
            resultIds: [],
            structure: false,
            count: 1,
          },
        },
        isCurrent: true,
      }),
    ).toBe("conflict");
  });

  it("지금 반영본은 content 일 때만 current, base_content 면 계속 판정", () => {
    expect(blockOf({ isCurrent: true, detail: null })).toBe("current");
    expect(
      blockOf({ isCurrent: true, detail: null, source: "base_content" }),
    ).toBe("loading");
  });

  it("내용을 아직 받지 않았으면 loading", () => {
    expect(blockOf({ detail: null })).toBe("loading");
  });

  it("생략된 내용은 omitted(source 별 필드)", () => {
    expect(
      blockOf({
        detail: withContent(null, { content_omitted: "too_large" }),
      }),
    ).toBe("omitted");
    expect(
      blockOf({
        source: "base_content",
        detail: withContent(OTHER, {
          base_content: null,
          base_content_omitted: "unavailable",
        }),
      }),
    ).toBe("omitted");
    // 생략 표시 없이 내용이 비어도 불러올 수 없다.
    expect(blockOf({ detail: withContent(null) })).toBe("omitted");
  });

  it("결과가 없거나 고칠 수 없으면 막는다", () => {
    const missing = revision({
      result: { occurrence_id: "occ_none", step_id: "st_extract" },
    });
    expect(blockOf({ revision: missing })).toBe("missing_result");
    const inputChanged = revision({
      result: { occurrence_id: "occ_extract_2", step_id: "st_extract" },
    });
    expect(blockOf({ revision: inputChanged })).toBe("not_editable");
  });

  it("지금 값과 같으면 same", () => {
    const current = job.output.find(item => "id" in item)!;
    expect(
      blockOf({
        detail: withContent((current as { content: JsonValue }).content),
      }),
    ).toBe("same");
  });

  it("base_content(기계 출력)를 불러온다", () => {
    const outcome = loadAvailability(
      input({ source: "base_content", detail: withContent(null) }),
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.draft).toMatchObject({ value: OTHER });
  });

  it("base_version 0 이 아닌 행의 base_content 는 최초 원본이 아니므로 original_missing", () => {
    expect(
      blockOf({
        source: "base_content",
        detail: withContent(null, { version: 3, base_version: 2 }),
      }),
    ).toBe("original_missing");
  });

  describe("구조", () => {
    const structure = revision({ type: "structure", result: null });
    const detail = (content: JsonValue): JobRevision => ({
      ...structure,
      content,
    });

    it("지금 구성과 같으면 same", () => {
      expect(
        blockOf({
          revision: structure,
          detail: detail(asJson(structureOf(job))),
        }),
      ).toBe("same");
    });

    it("파일 집합이 다르거나 모양이 틀리면 mismatch", () => {
      const content = structureOf(job);
      const changed = {
        ...content,
        file_groups: {
          ...content.file_groups,
          groups: content.file_groups.groups.map(group => ({
            ...group,
            files: group.files.map(file => ({
              ...file,
              file_id: `${file.file_id}_x`,
            })),
          })),
        },
      };
      expect(
        blockOf({ revision: structure, detail: detail(asJson(changed)) }),
      ).toBe("mismatch");
      expect(blockOf({ revision: structure, detail: detail({ x: 1 }) })).toBe(
        "mismatch",
      );
    });

    it("라벨이 바뀐 구성이면 replace_structure", () => {
      const content = structureOf(job);
      const relabeled = {
        ...content,
        documents: content.documents.map((document, index) =>
          index === 0 ? { ...document, label: "receipt" } : document,
        ),
      };
      const outcome = loadAvailability(
        input({ revision: structure, detail: detail(asJson(relabeled)) }),
      );
      expect(outcome.ok && outcome.draft.kind).toBe("replace_structure");
    });
  });
});

describe("buildHistoryItems", () => {
  const row = (
    id: string,
    op: string,
    extra: Partial<JobRevision["operation"]> = {},
  ) => revision({ id, operation: { id: op, ...extra } });

  const shape = (items: HistoryItem[]) =>
    items.map(item =>
      item.kind === "group"
        ? `group:${item.group.key}${item.continued ? "+" : ""}`
        : item.kind === "row"
          ? `row:${item.revision.id}`
          : "machine",
    );

  it("연속한 같은 저장 2 건 이상만 머리줄을 둔다", () => {
    const rows = [
      row("r5", "op_c"),
      row("r4", "op_b"),
      row("r3", "op_b"),
      row("r2", "op_a"),
      row("r1", "op_b"),
    ];
    expect(shape(buildHistoryItems(rows, rows, null))).toEqual([
      "row:r5",
      "group:op_b:r4",
      "row:r4",
      "row:r3",
      "row:r2",
      "row:r1",
    ]);
  });

  it("다른 Collection 에서 반영된 작업은 1 건이어도 머리줄", () => {
    const rows = [row("r1", "op_m", { from_this_collection: false })];
    expect(shape(buildHistoryItems(rows, rows, null))).toEqual([
      "group:op_m:r1",
      "row:r1",
    ]);
  });

  it("이전 페이지에서 이어진 묶음은 (이어서) 머리줄", () => {
    const all = [
      row("r4", "op_b"),
      row("r3", "op_b"),
      row("r2", "op_b"),
      row("r1", "op_a"),
    ];
    const items = buildHistoryItems(all.slice(2), all, null);
    expect(shape(items)).toEqual(["group:op_b:r4+", "row:r2", "row:r1"]);
    const group = items[0]!;
    expect(group.kind === "group" && group.group.rows).toHaveLength(3);
  });

  it("기계 행은 bottom 이면 끝, top 이면 처음, null 이면 없음", () => {
    const rows = [row("r1", "op_a")];
    expect(shape(buildHistoryItems(rows, rows, "bottom"))).toEqual([
      "row:r1",
      "machine",
    ]);
    expect(shape(buildHistoryItems(rows, rows, "top"))).toEqual([
      "machine",
      "row:r1",
    ]);
    expect(shape(buildHistoryItems([], [], "bottom"))).toEqual(["machine"]);
  });
});

describe("machinePlacementOf", () => {
  it("최신순은 남은 페이지가 없을 때 끝, 오래된 순은 1 페이지 처음", () => {
    expect(machinePlacementOf({ order: "desc", page: 4, hasMore: false })).toBe(
      "bottom",
    );
    expect(machinePlacementOf({ order: "desc", page: 1, hasMore: true })).toBe(
      null,
    );
    expect(machinePlacementOf({ order: "asc", page: 1, hasMore: true })).toBe(
      "top",
    );
    expect(machinePlacementOf({ order: "asc", page: 2, hasMore: false })).toBe(
      null,
    );
  });
});

describe("documentLabels", () => {
  it("앞 2 개와 나머지 수, 라벨이 없으면 대체 문구", () => {
    expect(
      documentLabels(
        [{ label: "invoice" }, { label: null }, { label: "a" }, { label: "b" }],
        2,
        "(none)",
      ),
    ).toEqual({ labels: ["invoice", "(none)"], more: 2 });
    expect(documentLabels([{ label: "x" }])).toEqual({
      labels: ["x"],
      more: 0,
    });
    expect(documentLabels(null)).toEqual({ labels: [], more: 0 });
  });
});

describe("targetChangedSince", () => {
  const { job } = singleJob();
  const RESULT: MachineTarget = {
    type: "result",
    occurrenceId: "occ_extract_2",
    stepId: "st_extract",
  };
  const STRUCTURE: MachineTarget = { type: "structure" };

  const withOutput = (
    from: ReviewJob,
    map: (entry: ReviewJob["output"][number]) => ReviewJob["output"][number],
  ): ReviewJob => ({ ...from, output: from.output.map(map) });
  const withResult = (from: ReviewJob, id: string, content: JsonValue) =>
    withOutput(from, entry =>
      "id" in entry && entry.id === id ? { ...entry, content } : entry,
    );
  const relabeled = (from: ReviewJob, label: string) =>
    withOutput(from, entry =>
      "id" in entry
        ? entry
        : {
            ...entry,
            content: {
              ...entry.content,
              documents: entry.content.documents.map((document, index) =>
                index === 0 ? { ...document, label } : document,
              ),
            },
          },
    );

  it("같은 내용이면 객체가 새로 만들어져도 false", () => {
    const copy = withResult(job, "occ_extract_2", {
      amount: 1000,
      currency: "KRW",
    });
    expect(targetChangedSince(job, copy, RESULT)).toBe(false);
    expect(targetChangedSince(job, job, RESULT)).toBe(false);
  });

  it("그 결과 값이 바뀌면 true", () => {
    const edited = withResult(job, "occ_extract_2", {
      amount: 2000,
      currency: "KRW",
    });
    expect(targetChangedSince(job, edited, RESULT)).toBe(true);
  });

  it("다른 결과만 바뀌면 false", () => {
    const edited = withResult(job, "occ_extract_1", { amount: 1 });
    expect(targetChangedSince(job, edited, RESULT)).toBe(false);
  });

  it("어느 쪽에서든 결과를 찾을 수 없으면 true", () => {
    const missing = withOutput(job, entry =>
      "id" in entry && entry.id === "occ_extract_2"
        ? { ...entry, id: "occ_other" }
        : entry,
    );
    expect(targetChangedSince(job, missing, RESULT)).toBe(true);
    expect(targetChangedSince(missing, job, RESULT)).toBe(true);
  });

  it("숫자 표기만 다르면(ExactNumber 1000.0 과 1000) false", () => {
    const exact = withResult(job, "occ_extract_2", {
      amount: new ExactNumber("1000.0"),
      currency: "KRW",
    } as unknown as JsonValue);
    expect(targetChangedSince(job, exact, RESULT)).toBe(false);
  });

  it("문서 라벨이 바뀌면 구조는 true, 결과는 false", () => {
    const changed = relabeled(job, "receipt");
    expect(targetChangedSince(job, changed, STRUCTURE)).toBe(true);
    expect(targetChangedSince(job, changed, RESULT)).toBe(false);
  });

  it("구조가 같으면 false", () => {
    expect(targetChangedSince(job, relabeled(job, "invoice"), STRUCTURE)).toBe(
      false,
    );
  });

  it("어느 쪽 Job 이든 없으면 true", () => {
    expect(targetChangedSince(null, job, RESULT)).toBe(true);
    expect(targetChangedSince(job, null, RESULT)).toBe(true);
    expect(targetChangedSince(null, job, STRUCTURE)).toBe(true);
    expect(targetChangedSince(job, null, STRUCTURE)).toBe(true);
  });
});

describe("machineTargetVisible", () => {
  const RESULT: MachineTarget = {
    type: "result",
    occurrenceId: "occ_1",
    stepId: "st_extract",
  };
  const STRUCTURE: MachineTarget = { type: "structure" };

  it("필터가 없으면 둘 다 보인다", () => {
    expect(machineTargetVisible(RESULT, null, null)).toBe(true);
    expect(machineTargetVisible(STRUCTURE, null, null)).toBe(true);
  });

  it("결과 종류 필터면 결과만", () => {
    expect(machineTargetVisible(RESULT, "result", null)).toBe(true);
    expect(machineTargetVisible(STRUCTURE, "result", null)).toBe(false);
  });

  it("구조 종류 필터면 구조만", () => {
    expect(machineTargetVisible(RESULT, "structure", null)).toBe(false);
    expect(machineTargetVisible(STRUCTURE, "structure", null)).toBe(true);
  });

  it("결과 필터가 그 결과면 보이고, 구조는 숨긴다", () => {
    expect(machineTargetVisible(RESULT, null, "occ_1")).toBe(true);
    expect(machineTargetVisible(STRUCTURE, null, "occ_1")).toBe(false);
  });

  it("결과 필터가 다른 결과면 숨긴다", () => {
    expect(machineTargetVisible(RESULT, null, "occ_2")).toBe(false);
    expect(machineTargetVisible(RESULT, "result", "occ_2")).toBe(false);
  });

  it("결과 종류 + 그 결과 필터면 보인다", () => {
    expect(machineTargetVisible(RESULT, "result", "occ_1")).toBe(true);
  });
});

describe("withOrigin", () => {
  it("replace_subtree·replace_structure 에만 출처를 붙인다", () => {
    const value = {
      kind: "replace_subtree",
      jobId: "job_A",
      resultId: "occ_1",
      path: [],
      value: {},
    } as const;
    expect(withOrigin(value, { kind: "original" })).toEqual({
      ...value,
      origin: { kind: "original" },
    });
    const structure = {
      kind: "replace_structure",
      jobId: "job_A",
      fileGroups: { groups: [] },
      layouts: [],
    } as unknown as Parameters<typeof withOrigin>[0];
    expect(
      withOrigin(structure, { kind: "revision", revisionId: "r", version: 2 }),
    ).toMatchObject({
      origin: { kind: "revision", revisionId: "r", version: 2 },
    });
    const label = {
      kind: "set_label",
      jobId: "job_A",
      stepId: null,
      documentId: "doc_1",
      label: "x",
    } as const;
    expect(withOrigin(label, { kind: "original" })).toBe(label);
  });
});

describe("planGroupLoad", () => {
  const { doc, job } = singleJob();
  const session = createSession(doc);
  const IDLE: SaveStatus = { phase: "idle" };
  const VALUE: JsonValue = { amount: 7, currency: "USD" };
  // occ_extract_1 은 지금 base_version 2(고칠 수 있음), occ_extract_2 는 고칠 수 없다.
  const result = (
    id: string,
    version: number,
    content: JsonValue,
    occurrenceId = "occ_extract_1",
  ): JobRevision =>
    revision({
      id,
      version,
      base_version: version - 1,
      result: { occurrence_id: occurrenceId, step_id: "st_extract" },
      content,
    });
  const relabeledStructure = (): JobRevision => {
    const content = structureOf(job);
    return revision({
      id: "rev_s",
      type: "structure",
      result: null,
      version: 5,
      base_version: 4,
      content: asJson({
        ...content,
        documents: content.documents.map((document, index) =>
          index === 0 ? { ...document, label: "receipt" } : document,
        ),
      }),
    });
  };
  const plan = (rows: JobRevision[], save: SaveStatus = IDLE) =>
    planGroupLoad({ session, save, baseJob: job, rows });

  it("같은 대상의 행이 여럿이면 version 이 가장 큰 것만 남긴다", () => {
    const out = plan([
      result("rev_3", 3, { amount: 3 }),
      result("rev_4", 4, VALUE),
    ]);
    expect(out.total).toBe(1);
    expect(out.loaded).toBe(1);
    expect(out.drafts[0]).toMatchObject({
      kind: "replace_subtree",
      resultId: "occ_extract_1",
      value: VALUE,
    });
  });

  it("넣는 draft 에 행 출처를 붙인다", () => {
    const out = plan([result("rev_4", 4, VALUE)]);
    expect(out.drafts[0]).toMatchObject({
      origin: { kind: "revision", revisionId: "rev_4", version: 4 },
    });
  });

  it("구조 행을 결과 행보다 먼저 넣는다", () => {
    const out = plan([result("rev_4", 4, VALUE), relabeledStructure()]);
    expect(out.drafts.map(draft => draft.kind)).toEqual([
      "replace_structure",
      "replace_subtree",
    ]);
  });

  it("지금 반영본은 current 로 막고 나머지만 넣는다", () => {
    // 구조는 지금 base_version 3 — v3 행이 반영본이다.
    const current = revision({
      id: "rev_s3",
      type: "structure",
      result: null,
      version: 3,
      base_version: 2,
      content: asJson(structureOf(job)),
    });
    const mixed = plan([result("rev_4", 4, VALUE), current]);
    expect(mixed).toMatchObject({
      loaded: 1,
      total: 2,
      blocked: { current: 1 },
    });
  });

  it("지금 값과 같거나 고칠 수 없는 행은 이유별로 센다", () => {
    const same = (
      job.output.find(item => "id" in item && item.id === "occ_extract_1") as {
        content: JsonValue;
      }
    ).content;
    const out = plan([
      result("rev_4", 4, same),
      result("rev_9", 9, VALUE, "occ_extract_2"),
    ]);
    expect(out).toMatchObject({
      drafts: [],
      loaded: 0,
      total: 2,
      blocked: { same: 1, not_editable: 1 },
    });
  });

  /** 계획한 draft 를 같은 순서로 넣는다(`APPLY_BATCH` 와 같은 규칙). 하나라도 실패하면 그 이유. */
  const replay = (drafts: readonly ChangeDraft[]) => {
    let current = session;
    for (const draft of drafts) {
      const outcome = addChange(current, draft);
      if (!outcome.ok) return { ok: false as const, reason: outcome.reason };
      current = outcome.session;
    }
    return { ok: true as const, entries: current.entries.length };
  };

  it("구조와 값이 섞인 묶음도 계획대로 한 번에 넣을 수 있다", () => {
    const out = plan([result("rev_4", 4, VALUE), relabeledStructure()]);
    expect(out).toMatchObject({ loaded: 2, total: 2, blocked: {} });
    expect(replay(out.drafts)).toEqual({ ok: true, entries: 2 });
  });

  it("구조가 값 행의 문서를 없애도 넣는 draft 는 한 번에 들어간다", () => {
    const content = structureOf(job);
    const removing = revision({
      id: "rev_s",
      type: "structure",
      result: null,
      version: 5,
      base_version: 4,
      content: asJson({
        ...content,
        documents: content.documents.filter(
          document => document.document_id !== "doc_1",
        ),
      }),
    });
    const out = plan([result("rev_4", 4, VALUE), removing]);
    const blockedCount = Object.values(out.blocked).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );
    expect(out.loaded + blockedCount).toBe(out.total);
    expect(replay(out.drafts).ok).toBe(true);
  });

  it("저장 중이면 모두 saving 으로 막는다", () => {
    const out = plan([result("rev_4", 4, VALUE), relabeledStructure()], {
      phase: "uploading",
    });
    expect(out).toMatchObject({
      drafts: [],
      loaded: 0,
      total: 2,
      blocked: { saving: 2 },
    });
  });
});
