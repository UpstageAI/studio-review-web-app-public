#!/usr/bin/env node
// mock 데이터를 만들어 `mock/.generated/`(기본)에 `dataset.json`·`index.json` 으로 저장한다.
//
//   node mock/generate.mjs [--seed 1] [--files 1] [--groups 1] [--pages 200] [--elements-per-page 60] [--items-max 30]
//                          [--jobs 1] [--history 3] [--copied] [--no-split] [--extra-extract-step] [--out mock/.generated] [--no-check]
//
// 저장 뒤 `src/test/__tests__/mock-dataset.test.ts` 를 그 파일로 돌려 검수 모델이 읽을 수 있는지
// 확인한다(`--no-check` 로 생략). 생성 자체는 결정적이라 같은 옵션이면 같은 바이트가 나온다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DEFAULT_OPTIONS, generateDataset } from "./lib/dataset.mjs";

const NEXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = "mock/.generated";
const CHECK_TEST = "src/test/__tests__/mock-dataset.test.ts";

const HELP = `mock 데이터 생성기

옵션
  --seed <n>               난수 seed (기본 ${DEFAULT_OPTIONS.seed})
  --files <n>              입력 파일 수 (기본 ${DEFAULT_OPTIONS.files}; 3 이면 50/30/20 % 로 나눈다)
  --groups <n>             파일 그룹 수 (기본 ${DEFAULT_OPTIONS.groups}; 파일을 앞에서부터 균등하게 나눠 담는다, --files 이하)
  --pages <n>              전체 페이지 수 (기본 ${DEFAULT_OPTIONS.pages})
  --elements-per-page <n>  쪽당 Parse 요소 수 (기본 ${DEFAULT_OPTIONS.elementsPerPage}, 최소 12)
  --items-max <n>          Extract 결과 items 최대 행 수 (기본 ${DEFAULT_OPTIONS.itemsMax}; 120 처럼 크게 하면 값 패널의 배열 묶음을 확인할 수 있다)
  --jobs <n>               Job 수 (기본 ${DEFAULT_OPTIONS.jobs}; 2 이상이면 Job 1 을 복제해 job_mock_0002.. 를 만든다 — 검수 큐·상태 확인용)
  --history <n>            Job 1 에 미리 심는 변경 이력 version 수 (기본 ${DEFAULT_OPTIONS.history}, 0..1000; 0 이면 이력 없음. 3 → 7 행, 60 → 64 행 — 이력 목록 페이지 확인용)
  --copied                 Collection 이 복사한 파일처럼 파일 응답의 요소를 비운다
  --no-split               Classify 가 문서를 나누지 않은 것처럼 그룹마다 문서 하나만 둔다(파일 전체)
  --extra-extract-step     같은 타입 Extract Step 을 하나 더 둔다(긴 이름 Step 탭 확인용, 결과는 첫 Extract 복사)
  --out <dir>              저장 폴더 (기본 ${DEFAULT_OUT}, next/ 기준)
  --no-check               생성 뒤 vitest 검사를 생략한다
  -h, --help               이 도움말
`;

function fail(text) {
  console.error(text);
  process.exit(1);
}

const { values } = parseArgs({
  // pnpm 10 은 `pnpm mock:gen -- --pages 12` 의 `--` 를 그대로 넘기므로 맨 앞 `--` 는 버린다.
  args: process.argv
    .slice(2)
    .filter((arg, index) => !(arg === "--" && index === 0)),
  options: {
    seed: { type: "string" },
    files: { type: "string" },
    groups: { type: "string" },
    pages: { type: "string" },
    "elements-per-page": { type: "string" },
    "items-max": { type: "string" },
    jobs: { type: "string" },
    history: { type: "string" },
    copied: { type: "boolean", default: false },
    "no-split": { type: "boolean", default: false },
    "extra-extract-step": { type: "boolean", default: false },
    out: { type: "string" },
    "no-check": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

function integerOption(name, raw, fallback, min) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    fail(`--${name} 은 ${min} 이상의 정수여야 합니다: ${raw}`);
  }
  return value;
}

const options = {
  seed: integerOption("seed", values.seed, DEFAULT_OPTIONS.seed, 0),
  files: integerOption("files", values.files, DEFAULT_OPTIONS.files, 1),
  groups: integerOption("groups", values.groups, DEFAULT_OPTIONS.groups, 1),
  pages: integerOption("pages", values.pages, DEFAULT_OPTIONS.pages, 1),
  elementsPerPage: integerOption(
    "elements-per-page",
    values["elements-per-page"],
    DEFAULT_OPTIONS.elementsPerPage,
    12,
  ),
  itemsMax: integerOption(
    "items-max",
    values["items-max"],
    DEFAULT_OPTIONS.itemsMax,
    1,
  ),
  jobs: integerOption("jobs", values.jobs, DEFAULT_OPTIONS.jobs, 1),
  history: integerOption("history", values.history, DEFAULT_OPTIONS.history, 0),
  copiedFiles: values.copied,
  split: !values["no-split"],
  extraExtractStep: values["extra-extract-step"],
};
if (options.pages < options.files) {
  fail(
    `--pages(${options.pages}) 는 --files(${options.files}) 이상이어야 합니다`,
  );
}
if (options.history > 1000) {
  fail(`--history(${options.history}) 는 1000 이하여야 합니다`);
}
if (options.groups > options.files) {
  fail(
    `--groups(${options.groups}) 는 --files(${options.files}) 이하여야 합니다`,
  );
}

/** 스모크가 이력 시나리오를 건너뛸지 판단할 요약. 이력이 없으면 `null`. */
function historyIndex(history) {
  if (!history) return null;
  const results = [
    ...new Set(
      history.records
        .filter(record => record.type === "result")
        .map(record => record.target),
    ),
  ];
  return {
    job: history.job,
    rows: history.records.length,
    operations: history.operations.length,
    results,
    structure: history.records.some(record => record.type === "structure"),
  };
}

const outDir = resolve(NEXT_DIR, values.out ?? DEFAULT_OUT);
const started = performance.now();
const dataset = generateDataset(options);
const datasetText = JSON.stringify(dataset);
mkdirSync(outDir, { recursive: true });
const datasetPath = resolve(outDir, "dataset.json");
writeFileSync(datasetPath, datasetText);
writeFileSync(
  resolve(outDir, "index.json"),
  JSON.stringify(
    {
      ids: dataset.ids,
      jobs: [dataset.ids.job, ...dataset.extraJobs.map(job => job.ids.job)],
      steps: dataset.steps,
      documents: dataset.documents,
      longDocumentIndex: dataset.longDocumentIndex,
      totalPages: dataset.totalPages,
      files: dataset.files.map(file => ({
        id: file.id,
        filename: file.filename,
        num_pages: file.num_pages,
      })),
      history: historyIndex(dataset.history),
      options: dataset.options,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

const parseText = dataset.jobResponse.output[0].content[0].text;
const elementCount = JSON.parse(parseText).elements.length;
const elapsed = Math.round(performance.now() - started);
const longDocument =
  dataset.longDocumentIndex === null
    ? "없음"
    : `${dataset.documents[dataset.longDocumentIndex].document_id} (${dataset.documents[dataset.longDocumentIndex].pages}쪽, index ${dataset.longDocumentIndex})`;
console.log(
  [
    `mock 데이터 생성 완료 → ${relative(NEXT_DIR, datasetPath)} (${(datasetText.length / 1_048_576).toFixed(1)} MiB, ${elapsed} ms)`,
    `  옵션: seed ${options.seed} · 파일 ${options.files} · 그룹 ${options.groups} · 페이지 ${options.pages} · 쪽당 요소 ${options.elementsPerPage} · items 최대 ${options.itemsMax} · Job ${options.jobs}개 · 이력 ${dataset.history ? `${dataset.history.records.length}행` : "없음"}${options.copiedFiles ? " · copied" : ""}${options.split ? "" : " · no-split"}${options.extraExtractStep ? " · extra-extract-step" : ""}`,
    `  파일: ${dataset.files.map(file => `${file.id} ${file.filename} ${file.num_pages}쪽`).join(", ")}`,
    `  문서 ${dataset.documents.length}개 · 긴 문서 ${longDocument} · Parse 요소 ${elementCount}개 · 결과 ${dataset.reviewDocument.jobs[0].output.length - 1}개`,
  ].join("\n"),
);

if (!values["no-check"]) {
  const vitest = resolve(NEXT_DIR, "node_modules/vitest/vitest.mjs");
  if (!existsSync(vitest)) {
    fail(
      "vitest 를 찾지 못했습니다. pnpm install 뒤 다시 실행하거나 --no-check 를 쓰세요.",
    );
  }
  const result = spawnSync(process.execPath, [vitest, "run", CHECK_TEST], {
    cwd: NEXT_DIR,
    stdio: "inherit",
    env: { ...process.env, MOCK_DATA: datasetPath },
  });
  process.exit(result.status ?? 1);
}
