import { describe, expect, it } from "vitest";

import { jsonEquals } from "@/lib/review-model";

import { generateDataset } from "../../../mock/lib/dataset.mjs";
import {
  REVISION_DEFAULT_LIMIT,
  compareRecords,
  contentKey,
  createLedger,
  jobResultIdOf,
  structureContent,
} from "../../../mock/lib/revisions.mjs";

// mock upstream 의 Job 변경 이력 원장(목록 · 단건 · 저장 반영)이 서버 계약대로 동작하는지 본다.

type Row = {
  id: string;
  type: string;
  version: number;
  base_version: number;
  published_at: number;
  result: { occurrence_id: string; step_id: string } | null;
  operation: { id: string; change_count: number; kind: string };
  content?: unknown;
  content_omitted?: string | null;
  base_content?: unknown;
  base_content_omitted?: string | null;
};
type ListBody = {
  object: string;
  data: Row[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
};
type ErrorBody = { error: { code: string; param: string | null } };

const DATASET = generateDataset();
const LONG = generateDataset({ pages: 40, history: 60 });

function ledgerOf(dataset = DATASET) {
  const doc = JSON.parse(JSON.stringify(dataset.reviewDocument));
  const ledger = createLedger({
    jobId: dataset.ids.job,
    collectionId: dataset.ids.collection,
    history: dataset.history,
  });
  return { doc, ledger };
}

function list(query: string, { dataset = DATASET, maxBytes = Infinity } = {}) {
  const { doc, ledger } = ledgerOf(dataset);
  return ledger.list(doc, new URLSearchParams(query), {
    maxBytes,
  }) as unknown as { status: number; body: ListBody & ErrorBody };
}

const ids = (body: ListBody) => body.data.map(row => row.id);

describe("compareRecords", () => {
  it("published_at DESC → version DESC → id DESC", () => {
    const rows = [
      { id: "a", published_at: 1, version: 1 },
      { id: "b", published_at: 2, version: 1 },
      { id: "c", published_at: 2, version: 2 },
      { id: "d", published_at: 2, version: 2 },
    ];
    expect([...rows].sort(compareRecords).map(row => row.id)).toEqual([
      "d",
      "c",
      "b",
      "a",
    ]);
  });
});

describe("structureContent", () => {
  it("file_groups 에 base_version 이 없고 문서에 layout step_id 가 붙는다", () => {
    const job = DATASET.reviewDocument.jobs[0]!;
    const content = structureContent(job);
    expect(content.file_groups).not.toHaveProperty("base_version");
    expect(content.file_groups.groups[0]!.files[0]).toEqual({
      file_ref: "job_mock_0001#0",
      file_id: "file_mock_0001",
      name: "mock-200p.pdf",
      num_pages: 200,
      input_index: 0,
    });
    expect(content.documents).toHaveLength(DATASET.documents.length);
    expect(content.documents[0]).toMatchObject({
      document_id: "doc_1",
      step_id: "st_classify",
      group_id: "grp_1",
    });
  });
});

describe("ledger.list", () => {
  it("기본은 최신순 50 행, 기본 데이터셋은 7 행", () => {
    const { status, body } = list("");
    expect(status).toBe(200);
    expect(body.object).toBe("list");
    expect(ids(body)).toEqual([
      "rvn_seed_0007",
      "rvn_seed_0006",
      "rvn_seed_0005",
      "rvn_seed_0004",
      "rvn_seed_0003",
      "rvn_seed_0002",
      "rvn_seed_0001",
    ]);
    expect(body.has_more).toBe(false);
    expect(body.first_id).toBe("rvn_seed_0007");
    expect(body.last_id).toBe("rvn_seed_0001");
    expect(body.data[0]).not.toHaveProperty("content");
    const sorted = [...body.data].sort(compareRecords);
    expect(sorted.map(row => row.id)).toEqual(ids(body));
  });

  it("limit · after 로 keyset 페이지를 잇고 has_more · last_id 를 채운다", () => {
    const first = list("limit=2").body;
    expect(ids(first)).toEqual(["rvn_seed_0007", "rvn_seed_0006"]);
    expect(first.has_more).toBe(true);
    expect(first.last_id).toBe("rvn_seed_0006");
    const second = list(`limit=2&after=${first.last_id}`).body;
    expect(ids(second)).toEqual(["rvn_seed_0005", "rvn_seed_0004"]);
    const rest = list("limit=100&after=rvn_seed_0004").body;
    expect(ids(rest)).toEqual([
      "rvn_seed_0003",
      "rvn_seed_0002",
      "rvn_seed_0001",
    ]);
    expect(rest.has_more).toBe(false);
  });

  it("order=asc 는 가장 오래된 행부터, after 는 더 새로운 쪽으로 잇는다", () => {
    const first = list("order=asc&limit=2").body;
    expect(ids(first)).toEqual(["rvn_seed_0001", "rvn_seed_0002"]);
    expect(first.data.every(row => row.operation.id === "rvop_seed_1")).toBe(
      true,
    );
    const next = list(`order=asc&limit=2&after=${first.last_id}`).body;
    expect(ids(next)).toEqual(["rvn_seed_0003", "rvn_seed_0004"]);
    expect(list("order=desc&limit=1").body.data[0]!.id).toBe("rvn_seed_0007");
  });

  it("history 60 이면 64 행이고 100 행 블록을 두 번에 나눠 받는다", () => {
    const all = list("limit=100", { dataset: LONG }).body;
    expect(all.data).toHaveLength(64);
    expect(all.has_more).toBe(false);
    const head = list("limit=50", { dataset: LONG }).body;
    expect(head.data).toHaveLength(REVISION_DEFAULT_LIMIT);
    expect(head.has_more).toBe(true);
    const tail = list(`limit=50&after=${head.last_id}`, { dataset: LONG }).body;
    expect(tail.data).toHaveLength(14);
    expect([...ids(head), ...ids(tail)]).toEqual(ids(all));
    const oldest = list("order=asc&limit=100", { dataset: LONG }).body;
    expect(ids(oldest)).toEqual([...ids(all)].reverse());
  });

  it("필터: type · occurrence_id · job_result_id · operation_id", () => {
    expect(ids(list("type=structure").body)).toEqual(["rvn_seed_0001"]);
    expect(list("type=result").body.data).toHaveLength(6);
    expect(
      list("occurrence_id=occ_ext_2").body.data.map(row => row.version),
    ).toEqual([3, 2, 1]);
    expect(
      list(`job_result_id=${jobResultIdOf("occ_ext_3")}`).body.data.map(
        row => row.result!.occurrence_id,
      ),
    ).toEqual(["occ_ext_3", "occ_ext_3"]);
    expect(ids(list("operation_id=rvop_seed_2").body)).toEqual([
      "rvn_seed_0006",
      "rvn_seed_0005",
    ]);
    // 이 Job 의 결과지만 이력이 없으면 빈 목록
    const empty = list("occurrence_id=occ_ext_1").body;
    expect(empty.data).toEqual([]);
    expect(empty.first_id).toBeNull();
    expect(empty.last_id).toBeNull();
  });

  it("잘못된 쿼리는 422 · 400 · 404", () => {
    const code = (query: string) => {
      const { status, body } = list(query);
      return [status, body.error?.code, body.error?.param];
    };
    expect(code("type=other")).toEqual([422, "validation_error", "type"]);
    expect(code("include=all")).toEqual([422, "validation_error", "include"]);
    expect(code("limit=0")).toEqual([422, "validation_error", "limit"]);
    expect(code("limit=101")).toEqual([422, "validation_error", "limit"]);
    expect(code("limit=1.5")).toEqual([422, "validation_error", "limit"]);
    expect(code("order=up")).toEqual([422, "validation_error", "order"]);
    expect(code("type=structure&occurrence_id=occ_ext_2")).toEqual([
      400,
      "invalid_value",
      "occurrence_id",
    ]);
    expect(code("type=structure&job_result_id=jres_occ_ext_2")).toEqual([
      400,
      "invalid_value",
      "job_result_id",
    ]);
    expect(code("after=nope")).toEqual([400, "invalid_cursor", "after"]);
    expect(code("order=asc&after=nope")).toEqual([
      400,
      "invalid_cursor",
      "after",
    ]);
    expect(code("occurrence_id=occ_none")).toEqual([
      404,
      "result_not_found",
      "occurrence_id",
    ]);
    expect(code("job_result_id=jres_none")).toEqual([
      404,
      "result_not_found",
      "job_result_id",
    ]);
  });

  it("include=content 는 content 와 base_content(base 0 → 기계 출력)를 싣는다", () => {
    const rows = list("include=content&limit=100").body.data;
    const byId = new Map(rows.map(row => [row.id, row]));
    const history = DATASET.history!;
    for (const row of rows) {
      const record = history.records.find(item => item.id === row.id)!;
      expect(row.content_omitted).toBeNull();
      expect(row.base_content_omitted).toBeNull();
      expect(
        jsonEquals(
          row.content,
          history.contents[
            contentKey(record.type, record.target, record.version)
          ],
        ),
      ).toBe(true);
      if (row.base_version === 0) {
        const machine =
          row.type === "structure"
            ? history.machine.structure
            : history.machine.results[record.target];
        expect(jsonEquals(row.base_content, machine)).toBe(true);
      } else {
        const previous = rows.find(
          other =>
            other.type === row.type &&
            other.result?.occurrence_id === row.result?.occurrence_id &&
            other.version === row.base_version,
        )!;
        expect(jsonEquals(row.base_content, previous.content)).toBe(true);
      }
    }
    expect(byId.get("rvn_seed_0004")!.content).toBe("green");
    expect(byId.get("rvn_seed_0004")!.result).toMatchObject({
      occurrence_id: "occ_val_2",
      step_id: "st_validate",
      step_name: "Validate - 금액 검증",
      step_type: "validate",
      job_result_id: "jres_occ_val_2",
    });
  });

  it("maxBytes 를 넘는 내용은 too_large 로 생략한다", () => {
    const row = list("include=content&type=structure", { maxBytes: 100 }).body
      .data[0]!;
    expect(row.content).toBeNull();
    expect(row.content_omitted).toBe("too_large");
    expect(row.base_content_omitted).toBe("too_large");
  });
});

describe("ledger.append · captureMachine", () => {
  it("같은 저장의 행은 operation 을 공유하고 최신순 맨 앞에 온다", () => {
    const { doc, ledger } = ledgerOf();
    const job = doc.jobs[0];
    const first = job.output.find(
      (item: { id?: string }) => item.id === "occ_ext_1",
    );
    // 처음 편집되는 결과(base 0): 덮어쓰기 전 내용을 기계 출력으로 박제
    expect(first.base_version).toBe(0);
    const machine = JSON.parse(JSON.stringify(first.content));
    ledger.captureMachine(job, first);
    ledger.captureMachine(job, { ...first, content: { changed: true } });
    expect(ledger.machine.results.get("occ_ext_1")).toEqual(machine);
    // 이미 이력이 있는 구조는 seed 기계 출력을 유지
    const seededStructure = ledger.machine.structure;
    ledger.captureMachine(job, null);
    expect(ledger.machine.structure).toBe(seededStructure);

    const edited = { ...first.content, memo: "edited" };
    const operation = {
      id: "rvop_mock_1",
      kind: "import",
      change_count: 2,
      collection_id: "scol_mock_0001",
      from_this_collection: true,
      reason: null,
      client_reference: null,
    };
    ledger.append({
      operation,
      publishedAt: 1_800_000_000,
      changes: [
        {
          id: "rvn_mock_000001",
          type: "result",
          target: "occ_ext_1",
          version: 1,
          base_version: 0,
          content: edited,
          documents: [
            { document_id: "doc_1", label: "invoice", field_group: "" },
          ],
        },
        {
          id: "rvn_mock_000002",
          type: "result",
          target: "occ_ext_2",
          version: 4,
          base_version: 3,
          content: { memo: "v4" },
          documents: [],
        },
      ],
    });
    const body = ledger.list(
      doc,
      new URLSearchParams("include=content&limit=3"),
    ).body as ListBody;
    expect(ids(body)).toEqual([
      "rvn_mock_000002",
      "rvn_mock_000001",
      "rvn_seed_0007",
    ]);
    expect(body.data[0]!.operation).toEqual(operation);
    expect(body.data[1]!.operation).toEqual(operation);
    expect(body.data[0]!.published_at).toBe(1_800_000_000);
    expect(body.data[1]!.base_content).toEqual(machine);
    expect(body.data[1]!.content).toEqual(edited);
    // v4 의 base 는 seed v3(= 현재 문서 내용)
    const r1 = job.output.find(
      (item: { id?: string }) => item.id === "occ_ext_2",
    );
    expect(jsonEquals(body.data[0]!.base_content, r1.content)).toBe(true);
  });

  it("이력이 없는 원장은 빈 목록이고 구조 기계 출력을 처음 편집 때 박제한다", () => {
    const extra = generateDataset({ pages: 12, jobs: 2 }).extraJobs[0]!;
    const doc = JSON.parse(JSON.stringify(extra.reviewDocument));
    const ledger = createLedger({
      jobId: extra.ids.job,
      collectionId: "scol_mock_0001",
      history: null,
    });
    const body = ledger.list(doc, new URLSearchParams("")).body as ListBody;
    expect(body.data).toEqual([]);
    expect(body.has_more).toBe(false);
    expect(ledger.machine.structure).toBeNull();
    ledger.captureMachine(doc.jobs[0], null);
    expect(ledger.machine.structure).toEqual(structureContent(doc.jobs[0]));
  });
});

describe("ledger.get", () => {
  it("ETag · If-None-Match 304 · 없는 id 404", () => {
    const { doc, ledger } = ledgerOf();
    const found = ledger.get(doc, "rvn_seed_0001", undefined);
    expect(found.status).toBe(200);
    expect(found.headers.ETag).toBe('"rev-rvn_seed_0001"');
    const row = found.body as Row;
    expect(row.type).toBe("structure");
    expect(row.result).toBeNull();
    expect(
      jsonEquals(row.base_content, DATASET.history!.machine.structure),
    ).toBe(true);
    expect(
      jsonEquals(
        row.content,
        structureContent(DATASET.reviewDocument.jobs[0]!),
      ),
    ).toBe(true);

    const cached = ledger.get(doc, "rvn_seed_0001", '"rev-rvn_seed_0001"');
    expect(cached.status).toBe(304);
    expect(cached.body).toBeNull();

    const missing = ledger.get(doc, "rvn_nope", undefined);
    expect(missing.status).toBe(404);
    expect((missing.body as ErrorBody).error.code).toBe("revision_not_found");
  });
});
