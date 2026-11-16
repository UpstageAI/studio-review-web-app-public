// 측정 결과(`mock/measure.mjs` 가 만드는 JSON)를 표로 만들고 두 결과를 비교하는 순수 함수.
// DOM·Playwright 에 의존하지 않으므로 vitest 로 검사한다.

/**
 * 결과 JSON 의 샘플 이름 순서. 비교·중앙값에서 같은 이름끼리 맞춘다. 정리 화면 여섯 단계
 * (`organizer-*`)는 앞 열 단계 뒤에 이어 잰 것이라 heap·Nodes 가 누적값이다. 하이라이트 두 단계
 * (`*-highlight`)의 `appMs` 는 행 10 개의 "입력 → 커밋" 중앙값이다.
 */
export const SAMPLE_NAMES = [
  "after-load",
  "structure-tab",
  "select-doc",
  "long-doc-scroll",
  "jump-page",
  "parse-tab",
  "values-tab",
  "jump-page-values",
  "hover-highlight",
  "select-highlight",
  "organizer-tab",
  "organizer-open",
  "organizer-scroll",
  "organizer-size-m",
  "organizer-click",
  "organizer-close",
];

export const NETWORK_CLASSES = [
  "reviewDocument",
  "files",
  "fileHighlights",
  "response",
  "figures",
  "images",
  "other",
];

/**
 * 측정 결과 JSON(`mock/measure.mjs` 참고). 숫자 키는 비교·중앙값 대상, 나머지는 메타 정보.
 * @typedef {Record<string, any>} MeasureResult
 */

const TIMING_KEYS = [
  "ttfb",
  "domContentLoaded",
  "loaded",
  "documentList",
  "firstPageImage",
  "filesDone",
];

const MB = 1024 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fmtInt(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString("en-US")
    : "—";
}

function fmtMs(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value).toLocaleString("en-US")}`
    : "—";
}

function fmtMB(bytes) {
  return typeof bytes === "number" && Number.isFinite(bytes)
    ? (bytes / MB).toFixed(1)
    : "—";
}

function fmtSigned(value, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded =
    digits === 0
      ? Math.round(value).toLocaleString("en-US")
      : value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function fmtPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function row(cells) {
  return `| ${cells.join(" | ")} |`;
}

function table(header, rows) {
  return [
    row(header),
    row(header.map(() => "---")),
    ...rows.map(cells => row(cells)),
  ].join("\n");
}

/**
 * 샘플 배열을 이름으로 찾는다(없으면 `undefined`).
 * @param {MeasureResult} result
 * @param {string} name
 * @returns {Record<string, any> | undefined}
 */
export function sampleByName(result, name) {
  return (result?.samples ?? []).find(sample => sample?.name === name);
}

function datasetLine(dataset) {
  if (!dataset) return "—";
  const parts = [];
  const options = dataset.options ?? {};
  if (options.seed !== undefined) parts.push(`seed ${options.seed}`);
  if (options.files !== undefined) parts.push(`files ${options.files}`);
  if (options.pages !== undefined) parts.push(`pages ${options.pages}`);
  if (options.elementsPerPage !== undefined)
    parts.push(`elements/page ${options.elementsPerPage}`);
  if (options.copiedFiles) parts.push("copied");
  if (dataset.documents !== undefined)
    parts.push(`documents ${dataset.documents}`);
  if (dataset.longDocumentPages !== undefined)
    parts.push(`long doc ${dataset.longDocumentPages}p`);
  return parts.join(" · ") || "—";
}

/**
 * 결과 하나를 markdown 으로. 표 3 개 — 타이밍(ms) / 네트워크(클래스별 바이트·요청 수) /
 * 샘플(heap MB·Nodes·LayoutCount·DOM 카운트·단계 소요 ms).
 * @param {MeasureResult} result
 * @returns {string}
 */
export function toMarkdown(result) {
  const lines = [];
  const title = result.runs
    ? `${result.label} (median of ${result.runs} runs)`
    : result.label;
  lines.push(`## measure: ${title}`);
  lines.push("");
  const meta = [
    `- at: ${result.at ?? "—"}`,
    `- commit: ${result.commit ?? "—"}`,
    `- url: ${result.url ?? "—"}`,
    `- browser: ${result.browser ?? "—"}`,
    `- viewerMode: ${result.viewerMode ?? "—"}`,
    `- dataset: ${datasetLine(result.dataset)}`,
  ];
  if (result.options) {
    const { doc, scroll, jump, organizerScreens, gc, runs } = result.options;
    const organizer =
      organizerScreens === undefined
        ? ""
        : ` · organizer screens ${organizerScreens}`;
    meta.push(
      `- options: doc ${doc} · scroll ${scroll} · jump ${jump}${organizer} · gc ${gc ? "on" : "off"} · runs ${runs ?? 1}`,
    );
  }
  if (result.console) {
    meta.push(
      `- console: errors ${fmtInt(result.console.errors)} · warnings ${fmtInt(result.console.warnings)} · pageErrors ${fmtInt(result.console.pageErrors)}`,
    );
  }
  if (result.partial) {
    meta.push(`- **partial**: ${result.error ?? "some steps did not finish"}`);
  }
  if (result.runFiles?.length) {
    meta.push(`- runs: ${result.runFiles.join(", ")}`);
  }
  lines.push(...meta, "");

  lines.push("### Timings (ms)", "");
  lines.push(
    table(
      ["metric", "ms"],
      TIMING_KEYS.map(key => [key, fmtMs(result.timings?.[key])]),
    ),
    "",
  );
  if (result.timings?.documentListSource) {
    lines.push(
      `- documentList source: ${result.timings.documentListSource}`,
      "",
    );
  }

  lines.push("### Network", "");
  const byClass = result.network?.byClass ?? {};
  const networkRows = NETWORK_CLASSES.filter(name => byClass[name]).map(
    name => {
      const entry = byClass[name];
      return [
        name,
        fmtInt(entry.count),
        fmtInt(entry.bytes),
        fmtMB(entry.bytes),
        fmtMB(entry.decodedBytes),
        fmtInt(entry.failed),
      ];
    },
  );
  networkRows.push([
    "**total**",
    fmtInt(result.network?.totalRequests),
    fmtInt(result.network?.totalBytes),
    fmtMB(result.network?.totalBytes),
    fmtMB(result.network?.totalDecodedBytes),
    fmtInt(result.network?.failedCount),
  ]);
  lines.push(
    table(
      ["class", "requests", "wire bytes", "wire MB", "decoded MB", "failed"],
      networkRows,
    ),
    "",
  );
  if (result.network?.unknownSizes) {
    lines.push(
      `- unknownSizes: ${fmtInt(result.network.unknownSizes)} (counted as 0 bytes)`,
      "",
    );
  }

  lines.push("### Samples", "");
  const sampleHeader = [
    "sample",
    "step ms",
    "app ms",
    "heap used MB",
    "heap total MB",
    "Nodes",
    "LayoutCount",
    "thumbnails",
    "docRows",
    "cells",
    "img",
  ];
  const sampleRows = (result.samples ?? []).map(sample => {
    if (sample.skipped) {
      return [
        sample.name,
        `skipped: ${sample.skipped}`,
        ...sampleHeader.slice(2).map(() => ""),
      ];
    }
    const m = sample.metrics ?? {};
    const d = sample.dom ?? {};
    return [
      sample.name,
      fmtMs(sample.stepMs),
      fmtMs(sample.appMs),
      fmtMB(m.JSHeapUsedSize),
      fmtMB(m.JSHeapTotalSize),
      fmtInt(m.Nodes),
      fmtInt(m.LayoutCount),
      fmtInt(d.thumbnails),
      fmtInt(d.documentRows),
      fmtInt(d.cells),
      fmtInt(d.images),
    ];
  });
  lines.push(table(sampleHeader, sampleRows), "");

  const optional = new Map();
  for (const sample of result.samples ?? []) {
    for (const [id, state] of Object.entries(sample.optional ?? {})) {
      if (!optional.has(id)) optional.set(id, state);
      else if (state === "present") optional.set(id, "present");
    }
  }
  if (optional.size > 0) {
    lines.push(
      `- optional testids: ${[...optional].map(([id, state]) => `${id}=${state}`).join(", ")}`,
      "",
    );
  }
  return lines.join("\n");
}

/** 샘플 배열 → 이름 키 객체(비교·중앙값용). 이름이 없는 샘플은 버린다. */
function samplesByName(samples) {
  const out = {};
  for (const sample of samples ?? []) {
    if (sample && typeof sample.name === "string") out[sample.name] = sample;
  }
  return out;
}

/** 비교·중앙값에서 숫자로 다루지 않는 키(메타 정보). */
const NON_METRIC_KEYS = new Set([
  "label",
  "at",
  "commit",
  "base",
  "url",
  "viewerMode",
  "dataset",
  "options",
  "partial",
  "error",
  "runs",
  "runFiles",
  "failures",
  "firstErrors",
  "browser",
  "notes",
  "optional",
  "skipped",
  "name",
]);

function compareNode(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
    const delta = b - a;
    const pct = a === 0 ? (b === 0 ? 0 : null) : (delta / a) * 100;
    return { a, b, delta, pct };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const out = {};
    for (const key of Object.keys(a)) {
      if (NON_METRIC_KEYS.has(key) || !(key in b)) continue;
      const compared = compareNode(a[key], b[key]);
      if (compared !== undefined) out[key] = compared;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * 두 결과의 같은 숫자 키마다 `{a, b, delta, pct}`. 한쪽에만 있는 키·샘플은 건너뛴다.
 * 샘플은 이름으로 맞춘다(`samples` 가 이름 키 객체가 된다).
 * @param {MeasureResult} a
 * @param {MeasureResult} b
 * @returns {Record<string, any>}
 */
export function compareResults(a, b) {
  const normalize = result => ({
    ...result,
    samples: samplesByName(result.samples),
  });
  const compared = compareNode(normalize(a), normalize(b)) ?? {};
  return {
    label: { a: a.label, b: b.label },
    ...compared,
  };
}

const SAMPLE_METRICS = [
  ["stepMs", "step ms", v => fmtSigned(v)],
  ["appMs", "app ms", v => fmtSigned(v)],
  ["metrics.JSHeapUsedSize", "heap used MB", v => fmtSigned(v / MB, 1)],
  ["metrics.Nodes", "Nodes", v => fmtSigned(v)],
  ["metrics.LayoutCount", "LayoutCount", v => fmtSigned(v)],
  ["dom.thumbnails", "thumbnails", v => fmtSigned(v)],
  ["dom.cells", "cells", v => fmtSigned(v)],
  ["dom.images", "img", v => fmtSigned(v)],
];

function getPath(object, path) {
  let node = object;
  for (const key of path.split(".")) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * `compareResults` 결과를 markdown 으로. 증가는 `+` 로 표시한다.
 * @param {Record<string, any>} comparison
 * @returns {string}
 */
export function compareMarkdown(comparison) {
  const lines = [];
  lines.push(
    `## compare: ${comparison.label?.a ?? "a"} → ${comparison.label?.b ?? "b"}`,
    "",
  );

  lines.push("### Timings (ms)", "");
  lines.push(
    table(
      ["metric", "a", "b", "delta", "pct"],
      TIMING_KEYS.filter(key => comparison.timings?.[key]).map(key => {
        const c = comparison.timings[key];
        return [key, fmtMs(c.a), fmtMs(c.b), fmtSigned(c.delta), fmtPct(c.pct)];
      }),
    ),
    "",
  );

  lines.push("### Network (wire bytes)", "");
  const byClass = comparison.network?.byClass ?? {};
  const bytesRow = (name, bytes, decoded, count) => [
    name,
    fmtMB(bytes.a),
    fmtMB(bytes.b),
    fmtSigned(bytes.delta / MB, 1),
    fmtPct(bytes.pct),
    decoded ? `${fmtMB(decoded.a)} → ${fmtMB(decoded.b)}` : "—",
    count ? `${fmtInt(count.a)} → ${fmtInt(count.b)}` : "—",
  ];
  const networkRows = NETWORK_CLASSES.filter(name => byClass[name]?.bytes).map(
    name =>
      bytesRow(
        name,
        byClass[name].bytes,
        byClass[name].decodedBytes,
        byClass[name].count,
      ),
  );
  if (comparison.network?.totalBytes) {
    networkRows.push(
      bytesRow(
        "**total**",
        comparison.network.totalBytes,
        comparison.network.totalDecodedBytes,
        comparison.network.totalRequests,
      ),
    );
  }
  lines.push(
    table(
      ["class", "a MB", "b MB", "delta MB", "pct", "decoded MB", "requests"],
      networkRows,
    ),
    "",
  );

  lines.push("### Samples", "");
  const samples = comparison.samples ?? {};
  const names = SAMPLE_NAMES.filter(name => samples[name]).concat(
    Object.keys(samples).filter(name => !SAMPLE_NAMES.includes(name)),
  );
  const sampleRows = [];
  for (const name of names) {
    for (const [path, label, format] of SAMPLE_METRICS) {
      const c = getPath(samples[name], path);
      if (!c) continue;
      const toDisplay =
        path === "metrics.JSHeapUsedSize" ? v => fmtMB(v) : v => fmtInt(v);
      sampleRows.push([
        name,
        label,
        toDisplay(c.a),
        toDisplay(c.b),
        format(c.delta),
        fmtPct(c.pct),
      ]);
    }
  }
  lines.push(
    table(["sample", "metric", "a", "b", "delta", "pct"], sampleRows),
    "",
  );

  if (comparison.console) {
    const parts = Object.entries(comparison.console).map(
      ([key, c]) => `${key} ${fmtInt(c.a)} → ${fmtInt(c.b)}`,
    );
    lines.push(`- console: ${parts.join(" · ")}`, "");
  }
  return lines.join("\n");
}

function median(values) {
  const sorted = values
    .filter(value => typeof value === "number" && Number.isFinite(value))
    .sort((x, y) => x - y);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianNode(nodes) {
  const first = nodes[0];
  // 어떤 run 은 값이 없을 수 있다(`appMs: null`) — 숫자가 하나라도 있으면 숫자끼리의 중앙값.
  if (nodes.some(node => typeof node === "number")) return median(nodes);
  if (isPlainObject(first)) {
    const out = {};
    for (const key of Object.keys(first)) {
      if (NON_METRIC_KEYS.has(key)) {
        out[key] = first[key];
        continue;
      }
      const values = nodes
        .filter(node => isPlainObject(node) && key in node)
        .map(node => node[key]);
      out[key] = medianNode(values);
    }
    return out;
  }
  return first;
}

/**
 * 같은 label 의 run 여러 개를 숫자 키마다 중앙값으로 합친 결과 하나. 메타 정보(label·commit·
 * viewerMode·dataset·options)는 첫 run 것을 쓰고 `runs` 에 개수를 적는다. 어느 run 에서든
 * `partial` 이면 결과도 `partial`.
 * @param {MeasureResult[]} results
 * @returns {MeasureResult}
 */
export function medianResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("medianResults: 결과가 없습니다");
  }
  if (results.length === 1) return { ...results[0], runs: 1 };
  const normalized = results.map(result => ({
    ...result,
    samples: samplesByName(result.samples),
  }));
  const merged = medianNode(normalized);
  const sampleNames = Object.keys(normalized[0].samples);
  merged.samples = sampleNames.map(name => {
    const perRun = normalized.map(result => result.samples[name]);
    const skipped = perRun.find(sample => sample?.skipped);
    if (skipped) return { name, skipped: skipped.skipped };
    return { ...medianNode(perRun.filter(Boolean)), name };
  });
  merged.runs = results.length;
  merged.partial = results.some(result => result.partial);
  merged.error = results.find(result => result.error)?.error;
  merged.console = {
    errors: median(results.map(result => result.console?.errors)),
    warnings: median(results.map(result => result.console?.warnings)),
    pageErrors: median(results.map(result => result.console?.pageErrors)),
  };
  return merged;
}
