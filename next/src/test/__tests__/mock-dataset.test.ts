import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPageSpace,
  documentPages,
  hasSplitDocuments,
  jsonEquals,
  layouts,
  pairExtractItems,
  parseJson,
  readReviewDocument,
  replaceStructure,
  validateJob,
} from "@/lib/review-model";
import { revisionToDraft } from "@/lib/revision-history";
import { readJobResponse } from "@/lib/review-api/job-response";
import { stepTabsFor } from "@/components/job-review/step-tabs-model";
import {
  readElements,
  toFileHighlights,
  toFilePagesResponse,
} from "@/app/api/_lib/viewer-document";

import {
  DEFAULT_OPTIONS,
  PORT_TOKEN,
  generateDataset,
  pageSvg,
} from "../../../mock/lib/dataset.mjs";
import { contentKey, structureContent } from "../../../mock/lib/revisions.mjs";

// mock 생성기가 낸 데이터를 앱의 모델·BFF 변환이 그대로 읽을 수 있는지 확인한다.
// 생성기는 TS 가 아니라 결과를 통째로 넣어 본다(`readReviewDocument`·`validateJob`·`readJobResponse`·
// `toFilePagesResponse`). `pnpm mock:gen` 이 저장한 파일이 있으면 같은 검사를 그 파일로도 돈다.

type Dataset = ReturnType<typeof generateDataset>;

const GENERATED_PATH = process.env.MOCK_DATA
  ? resolve(process.env.MOCK_DATA)
  : fileURLToPath(
      new URL("../../../mock/.generated/dataset.json", import.meta.url),
    );

const DEFAULT = generateDataset();

afterEach(() => {
  vi.unstubAllEnvs();
});

/** 파일 응답의 포트 자리를 서버처럼 실제 포트로 바꾼다. */
function withPort<T>(value: T, port = 4010): T {
  return JSON.parse(
    JSON.stringify(value).split(PORT_TOKEN).join(String(port)),
  ) as T;
}

/** 생성 결과 하나에 대한 공통 검사. */
function checkDataset(dataset: Dataset) {
  const { options, documents, totalPages } = dataset;
  const expectedDocuments = documents.length;
  // 두 번째 Extract Step(옵션)이 있으면 Extract 결과가 문서마다 둘이다.
  const extraExtract = Boolean(
    (options as { extraExtractStep?: boolean }).extraExtractStep,
  );
  const extractSteps = extraExtract
    ? ["st_extract", "st_extract_2"]
    : ["st_extract"];

  // 검수 문서
  const text = JSON.stringify(dataset.reviewDocument);
  const doc = readReviewDocument(text);
  expect(doc.collection_id).toBe(dataset.ids.collection);
  expect(doc.jobs).toHaveLength(1);
  const job = doc.jobs[0]!;
  expect(job.id).toBe(dataset.ids.job);
  expect(validateJob(doc, job)).toEqual([]);

  const [layout] = layouts(job);
  expect(layout).toBeDefined();
  const entries = layout!.content.documents;
  expect(entries).toHaveLength(expectedDocuments);
  expect(entries.reduce((sum, d) => sum + documentPages(d).length, 0)).toBe(
    totalPages,
  );
  if (dataset.longDocumentIndex !== null) {
    const long = entries[dataset.longDocumentIndex]!;
    expect(long.document_id).toBe("doc_long");
    expect(long.label).toBe("contract");
    expect(documentPages(long)).toHaveLength(60);
  }
  const space = buildPageSpace(job);
  expect(space).not.toBeNull();
  expect(space!.files).toHaveLength(options.files);
  expect(space!.files.reduce((sum, f) => sum + f.num_pages, 0)).toBe(
    totalPages,
  );

  // Job 응답
  const data = readJobResponse(dataset.jobResponse);
  const expectedElements = totalPages * options.elementsPerPage;
  expect(data.parseElements.length).toBeGreaterThanOrEqual(
    expectedElements * 0.9,
  );
  expect(data.parseElements.length).toBeLessThanOrEqual(expectedElements * 1.1);
  expect(data.parse).toHaveLength(data.parseElements.length);
  const figures = data.parseElements.filter(e => e.category === "figure");
  expect(figures).toHaveLength(Math.floor(totalPages / 2));
  expect(figures.every(e => e.page % 2 === 0)).toBe(true);
  expect(
    figures.every(e => e.image?.startsWith("data:image/png;base64,")),
  ).toBe(true);
  expect(
    data.parseElements
      .filter(e => e.category !== "figure")
      .every(e => e.image === null),
  ).toBe(true);
  expect(data.parseStepId).toBe("st_parse");
  expect(data.extractItems).toHaveLength(
    expectedDocuments * extractSteps.length,
  );
  expect(pairExtractItems(doc, job, data.extractItems).size).toBe(
    expectedDocuments * extractSteps.length,
  );
  expect(data.instructOutputs).toHaveLength(Math.min(3, expectedDocuments));
  for (const output of data.instructOutputs) {
    expect(output.pageRanges).toHaveLength(1);
    expect(output.citations).toHaveLength(3);
    expect(output.text).toContain("【†1】");
  }
  expect(data.stepOrder.map(step => step.stepId)).toEqual([
    "st_parse",
    "st_classify",
    ...extractSteps,
    "st_validate",
    "st_instruct",
  ]);
  const tabs = stepTabsFor(job, doc.steps, data);
  expect(tabs.map(tab => [tab.id, tab.kind])).toEqual([
    ["st_parse", "parse"],
    ["st_classify", "structure"],
    ...extractSteps.map(id => [id, "values"]),
    ["st_validate", "values"],
    ["st_instruct", "instruct"],
  ]);
  expect(tabs.find(tab => tab.id === "st_classify")!.editable).toBe(true);

  // 파일 응답
  expect(dataset.files).toHaveLength(options.files);
  expect(dataset.files.reduce((sum, f) => sum + f.num_pages, 0)).toBe(
    totalPages,
  );
  expect(dataset.sourceJobRow.files).toHaveLength(options.files);
  expect(dataset.sourceJobFiles.data).toHaveLength(options.files);
}

async function checkFilePages(dataset: Dataset) {
  const first = withPort(dataset.files[0]!);
  const numPages = dataset.files[0]!.num_pages;

  const blocked = toFilePagesResponse(first.id, first);
  expect(blocked.num_pages).toBe(numPages);
  expect(blocked.pages).toHaveLength(numPages);
  expect(blocked.pages.every(page => page.image_url === null)).toBe(true);

  vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", "1");
  const allowed = toFilePagesResponse(first.id, first);
  expect(allowed.status).toBe("READY");
  expect(allowed.pages[0]!.image_url).toBe(
    `http://127.0.0.1:4010/pages/${first.id}/1.svg`,
  );
  expect(allowed.pages.every(page => page.image_url !== null)).toBe(true);
  expect(JSON.stringify(allowed)).not.toContain("highlights");

  const elements = await readElements(first.pages[0]!);
  const highlights = await toFileHighlights(first, 1, 2);
  expect(highlights.map(page => page.page)).toEqual([1, 2]);
  if (dataset.options.copiedFiles) {
    expect(elements).toHaveLength(0);
    expect(highlights[0]!.highlights).toHaveLength(0);
  } else {
    expect(elements.length).toBeGreaterThanOrEqual(
      dataset.options.elementsPerPage - 6,
    );
    expect(elements.length).toBeLessThanOrEqual(
      dataset.options.elementsPerPage + 6,
    );
    expect(elements.every(e => e.page === 1)).toBe(true);
    expect(highlights[0]!.highlights).toHaveLength(elements.length);
    expect(highlights[1]!.highlights[0]!.page).toBe(2);
    expect(JSON.stringify(first)).not.toContain("base64_encoding");
  }
}

describe("generateDataset", () => {
  it("기본 옵션으로 200 쪽 · 파일 1 · 문서 ≈ 32 · 긴 문서 index 10", () => {
    expect(DEFAULT.options).toEqual(DEFAULT_OPTIONS);
    expect(DEFAULT.totalPages).toBe(200);
    expect(DEFAULT.files[0]!.filename).toBe("mock-200p.pdf");
    expect(DEFAULT.longDocumentIndex).toBe(10);
    expect(DEFAULT.documents.length).toBeGreaterThanOrEqual(24);
    expect(DEFAULT.documents.length).toBeLessThanOrEqual(45);
    expect(DEFAULT.documents.every(d => d.pages >= 1 && d.pages <= 60)).toBe(
      true,
    );
  });

  it("같은 seed 는 같은 결과, 다른 seed 는 다른 결과", () => {
    const again = generateDataset();
    expect(JSON.stringify(again)).toBe(JSON.stringify(DEFAULT));
    const other = generateDataset({ seed: 2 });
    expect(JSON.stringify(other.reviewDocument)).not.toBe(
      JSON.stringify(DEFAULT.reviewDocument),
    );
  });

  it("검수 모델·Job 응답 파서가 그대로 읽는다", () => {
    checkDataset(DEFAULT);
  });

  it("파일 응답은 BFF 변환을 거쳐 플래그에 따라 image_url 을 낸다", async () => {
    await checkFilePages(DEFAULT);
  });

  it("files 3 이면 100/60/40 쪽으로 나누고 문서 범위를 파일별로 쪼갠다", () => {
    const three = generateDataset({ files: 3 });
    expect(three.files.map(f => [f.filename, f.num_pages])).toEqual([
      ["mock-100p.pdf", 100],
      ["mock-60p.pdf", 60],
      ["mock-40p.pdf", 40],
    ]);
    const doc = readReviewDocument(JSON.stringify(three.reviewDocument));
    const [layout] = layouts(doc.jobs[0]!);
    const spanning = layout!.content.documents.filter(
      d => d.source_files.length > 1,
    );
    expect(spanning.length).toBeGreaterThanOrEqual(1);
    checkDataset(three);
  });

  it("copiedFiles 면 파일 응답의 요소가 비고 작은 데이터셋도 유효하다", async () => {
    const small = generateDataset({ pages: 12, copiedFiles: true });
    expect(small.longDocumentIndex).toBeNull();
    checkDataset(small);
    await checkFilePages(small);
  });

  it("groups 2 면 파일을 그룹으로 나누고 문서는 그룹 경계를 넘지 않는다", () => {
    const grouped = generateDataset({ pages: 660, files: 3, groups: 2 });
    const job = grouped.reviewDocument.jobs[0]!;
    const groups = job.file_groups.groups.map(
      (group: { group_id: string; files: { file_ref: string }[] }) => [
        group.group_id,
        group.files.map(file => file.file_ref),
      ],
    );
    expect(groups).toEqual([
      ["grp_1", ["job_mock_0001#0", "job_mock_0001#1"]],
      ["grp_2", ["job_mock_0001#2"]],
    ]);
    const filesOf = new Map<string, string[]>(groups as [string, string[]][]);

    const doc = readReviewDocument(JSON.stringify(grouped.reviewDocument));
    const [layout] = layouts(doc.jobs[0]!);
    const entries = layout!.content.documents;
    for (const entry of entries) {
      const groupFiles = filesOf.get(entry.group_id)!;
      expect(groupFiles).toBeDefined();
      expect(
        entry.source_files.every(source =>
          groupFiles.includes(source.file_ref),
        ),
      ).toBe(true);
    }
    expect(entries.map(entry => entry.group_id)).toEqual(
      grouped.documents.map(summary => summary.group),
    );

    // 둘째 그룹은 셋째 파일(330 + 198 쪽 뒤, 병합 529 쪽)부터.
    const firstOfSecond = grouped.documents.findIndex(
      summary => summary.group === "grp_2",
    );
    expect(firstOfSecond).toBeGreaterThan(0);
    expect(grouped.documents[firstOfSecond - 1]!.last).toBe(528);
    expect(grouped.documents[firstOfSecond - 1]!.group).toBe("grp_1");
    expect(grouped.documents[firstOfSecond]!.first).toBe(529);
    expect(
      grouped.documents
        .slice(firstOfSecond)
        .every(summary => summary.group === "grp_2"),
    ).toBe(true);
    checkDataset(grouped);
  });

  it("split: false 면 그룹마다 문서 하나가 그룹의 모든 페이지를 덮는다", () => {
    const whole = generateDataset({
      files: 3,
      groups: 2,
      pages: 12,
      split: false,
    });
    expect(whole.options.split).toBe(false);
    expect(whole.longDocumentIndex).toBeNull();
    // 파일 7·3·2 쪽, 그룹 1 = 파일 0·1(병합 1–10), 그룹 2 = 파일 2(11–12).
    expect(
      whole.documents.map(summary => [
        summary.group,
        summary.first,
        summary.last,
      ]),
    ).toEqual([
      ["grp_1", 1, 10],
      ["grp_2", 11, 12],
    ]);

    const job = whole.reviewDocument.jobs[0]!;
    const groupFiles = new Map<string, string[]>(
      job.file_groups.groups.map(
        (group: { group_id: string; files: { file_ref: string }[] }) => [
          group.group_id,
          group.files.map(file => file.file_ref),
        ],
      ),
    );
    expect(job.file_groups.groups).toHaveLength(whole.documents.length);

    const doc = readReviewDocument(JSON.stringify(whole.reviewDocument));
    const reviewJob = doc.jobs[0]!;
    const [layout] = layouts(reviewJob);
    for (const entry of layout!.content.documents) {
      const refs = entry.source_files.map(source => source.file_ref);
      expect(refs).toEqual(groupFiles.get(entry.group_id));
    }
    expect(reviewJob.file_groups?.excluded_pages).toEqual([]);
    expect(hasSplitDocuments(reviewJob)).toBe(false);
    expect(
      hasSplitDocuments(
        readReviewDocument(JSON.stringify(DEFAULT.reviewDocument)).jobs[0]!,
      ),
    ).toBe(true);
    checkDataset(whole);
  });

  it("groups 1 이면 문서 배치가 그룹 옵션이 없던 때와 같다", () => {
    // 그룹 옵션 도입 전 기본 옵션의 문서 끝 쪽(같은 seed → 같은 배치).
    expect(DEFAULT.documents.map(summary => summary.last)).toEqual([
      8, 11, 18, 21, 22, 35, 38, 39, 41, 43, 103, 120, 128, 136, 137, 139, 146,
      148, 156, 158, 162, 164, 165, 173, 175, 184, 191, 192, 196, 197, 200,
    ]);
    const three = generateDataset({ files: 3 });
    const explicit = generateDataset({ files: 3, groups: 1 });
    expect(JSON.stringify(explicit)).toBe(JSON.stringify(three));
    expect(three.documents.every(summary => summary.group === "grp_1")).toBe(
      true,
    );
    expect(three.reviewDocument.jobs[0]!.file_groups.groups).toHaveLength(1);
  });

  it("groups 가 files 보다 많거나 1 보다 작으면 거부한다", () => {
    expect(() => generateDataset({ files: 2, groups: 3 })).toThrow(RangeError);
    expect(() => generateDataset({ groups: 0 })).toThrow(RangeError);
    expect(() => generateDataset({ groups: 1.5 })).toThrow(TypeError);
  });

  it("pages 가 files 보다 작으면 거부한다", () => {
    expect(() => generateDataset({ pages: 2, files: 3 })).toThrow(RangeError);
  });

  it("elementsPerPage 는 쪽마다 고정 요소 12 개라 12 미만이면 거부한다", () => {
    expect(() => generateDataset({ pages: 12, elementsPerPage: 11 })).toThrow(
      RangeError,
    );
    const minimal = generateDataset({ pages: 12, elementsPerPage: 12 });
    checkDataset(minimal);
  });

  it("itemsMax 는 Extract items 행 수 상한이고 기본은 30 이다", () => {
    const rows = (dataset: Dataset) =>
      dataset.reviewDocument.jobs[0]!.output.filter(
        (result: { step_id: string }) => result.step_id === "st_extract",
      ).map(
        (result: { content: { items: unknown[] } }) =>
          result.content.items.length,
      );
    const defaults = rows(DEFAULT);
    expect(Math.max(...defaults)).toBeLessThanOrEqual(30);
    expect(Math.min(...defaults)).toBeGreaterThanOrEqual(5);

    const wide = generateDataset({ pages: 40, itemsMax: 120 });
    const counts = rows(wide);
    expect(Math.max(...counts)).toBeLessThanOrEqual(120);
    expect(Math.max(...counts)).toBeGreaterThan(50);
    checkDataset(wide);

    expect(() => generateDataset({ itemsMax: 0 })).toThrow(RangeError);
    expect(() => generateDataset({ itemsMax: 1.5 })).toThrow(TypeError);
  });

  it("jobs 1 이면 추가 Job 이 없고 Collection count 는 1 이다", () => {
    expect(DEFAULT.extraJobs).toEqual([]);
    expect(DEFAULT.collection.total_job_count).toBe(1);
    expect(DEFAULT.collection.pending_job_count).toBe(0);
    expect(DEFAULT.collection.failed_job_count).toBe(0);
  });

  it("jobs 3 이면 Job 1 을 복제한 job_mock_0002·0003 을 만든다", () => {
    const dataset = generateDataset({ pages: 12, jobs: 3 });
    checkDataset(dataset);
    expect(dataset.collection.total_job_count).toBe(3);
    // 짝수 번째 Job 은 이전 Config 행이라 latest 는 Job 1·3 뿐이다.
    expect(dataset.collection.latest_config_job_count).toBe(2);
    expect(
      [dataset.sourceJobRow, ...dataset.extraJobs.map(job => job.sourceJobRow)]
        .filter(row => row.config.is_latest)
        .map(row => row.job_id),
    ).toEqual(["job_mock_0001", "job_mock_0003"]);
    expect(dataset.extraJobs.map(job => job.ids.job)).toEqual([
      "job_mock_0002",
      "job_mock_0003",
    ]);
    let previousUpdatedAt = dataset.sourceJobRow.updated_at;
    for (const extra of dataset.extraJobs) {
      const id = extra.ids.job;
      const doc = readReviewDocument(JSON.stringify(extra.reviewDocument));
      const job = doc.jobs[0]!;
      expect(job.id).toBe(id);
      expect(validateJob(doc, job)).toEqual([]);
      const refs = job.file_groups!.groups.flatMap(group =>
        group.files.map(file => file.file_ref),
      );
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every(ref => ref.startsWith(`${id}#`))).toBe(true);
      expect(extra.jobResponse.id).toBe(id);
      expect(readJobResponse(extra.jobResponse).extractItems).toHaveLength(
        dataset.documents.length,
      );
      expect(extra.sourceJobRow.job_id).toBe(id);
      expect(extra.sourceJobRow.updated_at).toBeGreaterThan(previousUpdatedAt);
      previousUpdatedAt = extra.sourceJobRow.updated_at;
      // 파일은 Job 1 과 공유한다.
      expect(extra.sourceJobFiles).toEqual(dataset.sourceJobFiles);
    }
    // 복제가 원본을 바꾸지 않는다.
    expect(dataset.reviewDocument.jobs[0]!.id).toBe("job_mock_0001");
    expect(() => generateDataset({ jobs: 0 })).toThrow(RangeError);
    expect(() => generateDataset({ jobs: 1.5 })).toThrow(TypeError);
  });

  it("extraExtractStep 을 끄면 옵션이 없던 때와 같은 출력이다", () => {
    expect(JSON.stringify(generateDataset({ extraExtractStep: false }))).toBe(
      JSON.stringify(DEFAULT),
    );
    expect(DEFAULT.options).not.toHaveProperty("extraExtractStep");
  });

  it("extraExtractStep 이면 같은 타입 Extract Step 이 둘이고 검수 모델·Job 응답 파서가 그대로 읽는다", () => {
    const dataset = generateDataset({ pages: 12, extraExtractStep: true });
    const base = generateDataset({ pages: 12 });
    const count = dataset.documents.length;
    // 난수를 더 쓰지 않으므로 문서 배치·첫 Extract 결과가 플래그 없을 때와 같다.
    expect(dataset.documents).toEqual(base.documents);
    expect(
      Object.values(dataset.steps).filter(
        step => step.type === "information-extract",
      ),
    ).toHaveLength(2);

    // 결과 수·Step 순서·탭은 공통 검사가 플래그에 맞춰 본다.
    checkDataset(dataset);

    const output = dataset.reviewDocument.jobs[0]!.output as Output[];
    const second = output.filter(item => item.step_id === "st_extract_2");
    expect(second).toHaveLength(count);
    second.forEach((result, index) => {
      expect(result.id).toBe(`occ_ext2_${index + 1}`);
      expect(result.content).toEqual(
        output.find(item => item.id === `occ_ext_${index + 1}`)!.content,
      );
    });
    // 이름이 달라 순번(ordinal)이 붙지 않는다.
    const doc = readReviewDocument(JSON.stringify(dataset.reviewDocument));
    const tabs = stepTabsFor(
      doc.jobs[0]!,
      doc.steps,
      readJobResponse(dataset.jobResponse),
    );
    expect(tabs.every(tab => tab.ordinal === undefined)).toBe(true);
  });
});

type Output = {
  id?: string;
  step_id: string;
  base_version: number;
  content: unknown;
  checks?: unknown;
};

/** 문서의 결과·layout·`file_groups` 의 `base_version` 을 `{ [id|step_id]: n, file_groups: n }` 로. */
function versionsOf(reviewDocument: Dataset["reviewDocument"]) {
  const job = reviewDocument.jobs[0]!;
  const out: Record<string, number> = {
    file_groups: job.file_groups.base_version,
  };
  for (const item of job.output as Output[]) {
    out[item.id ?? item.step_id] = item.base_version;
  }
  return out;
}

describe("seed 변경 이력", () => {
  const history = DEFAULT.history!;
  const job = DEFAULT.reviewDocument.jobs[0]!;
  const resultOf = (id: string) =>
    (job.output as Output[]).find(item => item.id === id)!;

  it("기본 3 version → 묶음 3 개 · 7 행, 마지막 묶음은 다른 Collection 의 migration", () => {
    expect(DEFAULT_OPTIONS.history).toBe(3);
    expect(history.job).toBe("job_mock_0001");
    expect(history.records).toHaveLength(7);
    expect(
      history.operations.map(op => [op.id, op.kind, op.change_count]),
    ).toEqual([
      ["rvop_seed_1", "import", 4],
      ["rvop_seed_2", "import", 2],
      ["rvop_seed_3", "migration", 1],
    ]);
    expect(history.operations[2]).toMatchObject({
      collection_id: "scol_mock_prev",
      from_this_collection: false,
      reason: "schema upgrade",
    });
    expect(history.records.map(r => [r.type, r.target, r.version])).toEqual([
      ["structure", "job_mock_0001", 1],
      ["result", "occ_ext_2", 1],
      ["result", "occ_ext_3", 1],
      ["result", "occ_val_2", 1],
      ["result", "occ_ext_2", 2],
      ["result", "occ_ext_3", 2],
      ["result", "occ_ext_2", 3],
    ]);
    expect(history.records.every(r => r.base_version === r.version - 1)).toBe(
      true,
    );
    expect(history.records[1]!.documents).toEqual([
      { document_id: "doc_2", label: "receipt", field_group: "" },
    ]);
    expect(history.records[0]!.documents).toBeNull();
    expect(generateDataset({ history: 60 }).history!.records).toHaveLength(64);
  });

  it("대상의 마지막 version 내용 = 지금 문서 내용, 문서 base_version = 대상별 최대 version", () => {
    const latest = new Map<string, number>();
    for (const record of history.records) {
      latest.set(
        `${record.type}:${record.target}`,
        Math.max(
          latest.get(`${record.type}:${record.target}`) ?? 0,
          record.version,
        ),
      );
    }
    for (const [key, version] of latest) {
      const [type, target] = key.split(":") as [string, string];
      const stored = history.contents[contentKey(type, target, version)];
      const current =
        type === "structure" ? structureContent(job) : resultOf(target).content;
      expect(jsonEquals(stored, current), key).toBe(true);
    }
    expect(versionsOf(DEFAULT.reviewDocument)).toMatchObject({
      file_groups: 1,
      st_classify: 1,
      occ_ext_1: 0,
      occ_ext_2: 3,
      occ_ext_3: 2,
      occ_val_1: 0,
      occ_val_2: 1,
      occ_ext_4: 0,
    });
    // 사람이 판정을 고친 V 는 기계 판정 근거가 없다(나머지는 그대로).
    expect(resultOf("occ_val_2")).not.toHaveProperty("checks");
    expect(resultOf("occ_val_1")).toHaveProperty("checks");
  });

  it("기계 출력은 v1 과 다르다", () => {
    const v1 = (type: string, target: string) =>
      history.contents[contentKey(type, target, 1)];
    for (const target of ["occ_ext_2", "occ_ext_3", "occ_val_2"]) {
      expect(history.machine.results[target]).toBeDefined();
      expect(
        jsonEquals(history.machine.results[target], v1("result", target)),
      ).toBe(false);
    }
    expect(
      jsonEquals(history.machine.structure, v1("structure", "job_mock_0001")),
    ).toBe(false);
    // R1 기계 출력은 v1 보다 items 가 한 행 많다(배열 added/removed 확인용).
    const machineItems = (
      history.machine.results.occ_ext_2 as { items: unknown[] }
    ).items;
    const v1Items = (v1("result", "occ_ext_2") as { items: unknown[] }).items;
    expect(machineItems).toHaveLength(v1Items.length + 1);
  });

  it("기계 구조를 편집에 불러오면 저장 전 검증을 통과한다", () => {
    const doc = readReviewDocument(JSON.stringify(DEFAULT.reviewDocument));
    const current = doc.jobs[0]!;
    const outcome = revisionToDraft(
      current,
      { type: "structure", result: null },
      parseJson(JSON.stringify(history.machine.structure)),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.draft.kind !== "replace_structure") return;
    expect(outcome.draft.fileGroups.base_version).toBe(1);
    const applied = replaceStructure(
      current,
      outcome.draft.fileGroups,
      outcome.draft.layouts,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(validateJob(doc, applied.job)).toEqual([]);
  });

  it("history 0 이면 null 이고 base_version 이 전부 0", () => {
    const none = generateDataset({ history: 0 });
    expect(none.history).toBeNull();
    expect(
      Object.values(versionsOf(none.reviewDocument)).every(v => v === 0),
    ).toBe(true);
    // 이력은 값·구조 내용을 바꾸지 않는다(occ_val_2.checks 제외).
    const strip = (dataset: Dataset) =>
      (dataset.reviewDocument.jobs[0]!.output as Output[]).map(item => ({
        id: item.id ?? item.step_id,
        content: item.content,
      }));
    expect(strip(none)).toEqual(strip(DEFAULT));
    expect(JSON.stringify(none.jobResponse)).toBe(
      JSON.stringify(DEFAULT.jobResponse),
    );
    checkDataset(none);
  });

  it("extraJobs 는 이력이 없고 base_version 이 전부 0", () => {
    const dataset = generateDataset({ pages: 12, jobs: 3 });
    expect(dataset.history).not.toBeNull();
    for (const extra of dataset.extraJobs) {
      expect(extra).not.toHaveProperty("history");
      expect(
        Object.values(versionsOf(extra.reviewDocument)).every(v => v === 0),
      ).toBe(true);
    }
  });

  it("같은 seed 면 같은 이력, 작은 데이터셋도 유효하다", () => {
    expect(JSON.stringify(generateDataset().history)).toBe(
      JSON.stringify(history),
    );
    const one = generateDataset({ pages: 1 });
    expect(one.documents).toHaveLength(1);
    expect(one.history!.records.map(record => record.target)).toEqual([
      "job_mock_0001",
      "occ_ext_1",
      "occ_ext_1",
      "occ_ext_1",
    ]);
    checkDataset(one);
    expect(() => generateDataset({ history: 1001 })).toThrow(RangeError);
    expect(() => generateDataset({ history: -1 })).toThrow(TypeError);
  });
});

describe("pageSvg", () => {
  it("1240×1754 SVG 를 내고 범위 밖은 null", () => {
    const fileId = DEFAULT.files[0]!.id;
    const svg = pageSvg(DEFAULT, fileId, 1);
    expect(svg).not.toBeNull();
    expect(svg!.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1240"');
    expect(svg).toContain('height="1754"');
    expect(svg).toContain("mock-200p.pdf · page 1 / 200");
    expect(pageSvg(DEFAULT, fileId, 1)).toBe(svg);
    expect(pageSvg(DEFAULT, fileId, 2)).not.toBe(svg);
    expect(pageSvg(DEFAULT, fileId, 0)).toBeNull();
    expect(pageSvg(DEFAULT, fileId, 201)).toBeNull();
    expect(pageSvg(DEFAULT, "file_nope", 1)).toBeNull();
  });
});

describe("mock/.generated/dataset.json", () => {
  const exists = existsSync(GENERATED_PATH);

  it.skipIf(!exists)("저장된 데이터셋도 같은 검사를 통과한다", async () => {
    const dataset = JSON.parse(readFileSync(GENERATED_PATH, "utf8")) as Dataset;
    checkDataset(dataset);
    await checkFilePages(dataset);
    expect(pageSvg(dataset, dataset.files[0]!.id, 1)).toContain("<svg");
  });
});
