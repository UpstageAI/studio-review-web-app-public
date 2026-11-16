import { describe, expect, it } from "vitest";

import {
  compareMarkdown,
  compareResults,
  medianResults,
  toMarkdown,
} from "../../../mock/lib/measure-report.mjs";

// 측정 하네스(`mock/measure.mjs`)의 보고 모듈만 검사한다. Playwright 실행은 테스트에 두지 않는다.

const MB = 1024 * 1024;

function sample(
  name: string,
  heap: number,
  nodes: number,
  extra: Record<string, unknown> = {},
) {
  return {
    name,
    elapsedMs: 1000,
    stepMs: 200,
    metrics: {
      JSHeapUsedSize: heap * MB,
      JSHeapTotalSize: (heap + 20) * MB,
      Nodes: nodes,
      Documents: 1,
      LayoutCount: 10,
      RecalcStyleCount: 5,
    },
    dom: {
      thumbnails: 200,
      documentRows: 31,
      cells: 0,
      images: 210,
    },
    optional: { "job-review-position-bar": "skipped" },
    ...extra,
  };
}

function result(label: string, overrides: Record<string, unknown> = {}) {
  return {
    label,
    at: "2026-10-27T00:00:00.000Z",
    commit: "abc1234",
    base: "http://localhost:3100",
    url: "http://localhost:3100/ko/collections/c/jobs/j",
    browser: "Chromium 156",
    viewerMode: "paged",
    dataset: {
      options: { seed: 1, files: 1, pages: 200, elementsPerPage: 60 },
      totalPages: 200,
      documents: 31,
      longDocumentIndex: 10,
      longDocumentPages: 60,
      files: [],
    },
    options: { doc: 30, scroll: 40, jump: 55, runs: 1, gc: false },
    timings: {
      ttfb: 100,
      domContentLoaded: 400,
      documentList: 1200,
      firstPageImage: 2000,
      filesDone: 5000,
    },
    network: {
      byClass: {
        reviewDocument: {
          count: 1,
          bytes: 10_000,
          decodedBytes: 80_000,
          failed: 0,
        },
        files: { count: 1, bytes: 400_000, decodedBytes: 3_000_000, failed: 0 },
        response: {
          count: 1,
          bytes: 5_000_000,
          decodedBytes: 7_500_000,
          failed: 0,
        },
        images: {
          count: 200,
          bytes: 600_000,
          decodedBytes: 600_000,
          failed: 0,
        },
        other: { count: 20, bytes: 900_000, decodedBytes: 900_000, failed: 0 },
      },
      totalBytes: 6_910_000,
      totalDecodedBytes: 12_080_000,
      totalRequests: 223,
      failedCount: 0,
      unknownSizes: 0,
      failures: [],
    },
    samples: [
      sample("after-load", 150, 20_000),
      sample("structure-tab", 160, 21_000),
      sample("parse-tab", 170, 25_000),
    ],
    console: { errors: 0, warnings: 1, pageErrors: 0, firstErrors: [] },
    partial: false,
    ...overrides,
  };
}

describe("toMarkdown", () => {
  it("label·메타·after-load 행을 포함한 표를 만든다", () => {
    const md = toMarkdown(result("before"));
    expect(md).toContain("## measure: before");
    expect(md).toContain("- viewerMode: paged");
    expect(md).toContain("seed 1 · files 1 · pages 200");
    expect(md).toMatch(/\| after-load \| 200 \| — \| 150\.0 \|/);
    expect(md).toMatch(/\| files \| 1 \| 400,000 \| 0\.4 \| 2\.9 \| 0 \|/);
    expect(md).toMatch(/\| firstPageImage \| 2,000 \|/);
    expect(md).toContain("job-review-position-bar=skipped");
    expect(md).toContain("- options: doc 30 · scroll 40 · jump 55 · gc off");
  });

  it("정리 화면 셀 수(cells)·organizer-screens 옵션·건너뛴 정리 화면 단계를 표시한다", () => {
    const md = toMarkdown(
      result("organizer", {
        options: {
          doc: 30,
          scroll: 40,
          jump: 55,
          organizerScreens: 8,
          gc: false,
        },
        samples: [
          sample("jump-page-values", 150, 20_000, { appMs: 30 }),
          sample("organizer-open", 160, 23_000, {
            dom: {
              thumbnails: 0,
              documentRows: 31,
              cells: 40,
              images: 42,
            },
          }),
          { name: "organizer-scroll", skipped: "no organizer" },
        ],
      }),
    );
    expect(md).toContain(
      "- options: doc 30 · scroll 40 · jump 55 · organizer screens 8 · gc off",
    );
    expect(md).toContain("| thumbnails | docRows | cells | img |");
    expect(md).toMatch(
      /\| jump-page-values \| 200 \| 30 \| .* \| 200 \| 31 \| 0 \| 210 \|/,
    );
    expect(md).toMatch(
      /\| organizer-open \| 200 \| — \| .* \| 0 \| 31 \| 40 \| 42 \|/,
    );
    // 건너뛴 행도 열 수가 같다(헤더 11 열).
    expect(md).toContain(
      "| organizer-scroll | skipped: no organizer |  |  |  |  |  |  |  |  |  |",
    );
  });

  it("건너뛴 샘플과 partial 을 표시한다", () => {
    const md = toMarkdown(
      result("x", {
        partial: true,
        error: "jump-page: timeout",
        samples: [
          sample("after-load", 100, 1000),
          { name: "jump-page", skipped: "timeout" },
        ],
      }),
    );
    expect(md).toContain("**partial**: jump-page: timeout");
    expect(md).toContain("| jump-page | skipped: timeout |");
  });

  it("앱 마크 구간(appMs)·loaded·documentList 출처를 표시한다", () => {
    const md = toMarkdown(
      result("marks", {
        timings: {
          ttfb: 100,
          domContentLoaded: 400,
          loaded: 900,
          documentList: 1100,
          documentListSource: "mark",
          firstPageImage: 2000,
          filesDone: 5000,
        },
        samples: [
          sample("jump-page", 150, 20_000, { appMs: 180 }),
          sample("jump-page-values", 150, 20_000, { appMs: null }),
        ],
      }),
    );
    expect(md).toMatch(/\| loaded \| 900 \|/);
    expect(md).toContain("- documentList source: mark");
    expect(md).toContain("| sample | step ms | app ms |");
    expect(md).toMatch(/\| jump-page \| 200 \| 180 \| 150\.0 \|/);
    expect(md).toMatch(/\| jump-page-values \| 200 \| — \| 150\.0 \|/);
  });
});

describe("compareResults appMs", () => {
  it("양쪽에 있으면 비교하고, 한쪽이 null 이면 건너뛴다", () => {
    const a = result("a", {
      samples: [
        sample("jump-page", 150, 20_000, { appMs: 200 }),
        sample("jump-page-values", 150, 20_000, { appMs: null }),
      ],
    });
    const b = result("b", {
      samples: [
        sample("jump-page", 150, 20_000, { appMs: 150 }),
        sample("jump-page-values", 150, 20_000, { appMs: 90 }),
      ],
    });
    const cmp = compareResults(a, b);
    expect(cmp.samples["jump-page"].appMs).toEqual({
      a: 200,
      b: 150,
      delta: -50,
      pct: -25,
    });
    expect(cmp.samples["jump-page-values"].appMs).toBeUndefined();
    const md = compareMarkdown(cmp);
    expect(md).toMatch(
      /\| jump-page \| app ms \| 200 \| 150 \| -50 \| -25\.0% \|/,
    );
    // SAMPLE_NAMES 순서: jump-page → parse-tab → values-tab → jump-page-values
    expect(md.indexOf("| jump-page | step ms")).toBeLessThan(
      md.indexOf("| jump-page-values | step ms"),
    );
  });
});

describe("compareResults highlight", () => {
  it("하이라이트 두 단계는 값 탭 점프 뒤, 정리 화면 앞에 두고 appMs 를 비교한다", () => {
    const a = result("a", {
      samples: [
        sample("organizer-open", 150, 20_000),
        sample("select-highlight", 150, 20_000, { appMs: 12 }),
        sample("hover-highlight", 150, 20_000, { appMs: 20 }),
        sample("jump-page-values", 150, 20_000, { appMs: 30 }),
      ],
    });
    const b = result("b", {
      samples: [
        sample("organizer-open", 150, 20_000),
        sample("select-highlight", 150, 20_000, { appMs: 12 }),
        sample("hover-highlight", 150, 20_000, { appMs: 10 }),
        sample("jump-page-values", 150, 20_000, { appMs: 30 }),
      ],
    });
    const md = compareMarkdown(compareResults(a, b));
    expect(md).toMatch(
      /\| hover-highlight \| app ms \| 20 \| 10 \| -10 \| -50\.0% \|/,
    );
    const order = [
      "jump-page-values",
      "hover-highlight",
      "select-highlight",
      "organizer-open",
    ].map(name => md.indexOf(`| ${name} | step ms`));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});

describe("compareResults organizer", () => {
  const organizerDom = (cells: number) => ({
    dom: {
      thumbnails: 0,
      documentRows: 31,
      cells,
      images: cells + 2,
    },
  });

  it("정리 화면 단계는 기존 샘플 뒤에 두고 cells 열을 비교한다", () => {
    const a = result("a", {
      samples: [
        sample("organizer-click", 150, 20_000, {
          appMs: 40,
          ...organizerDom(40),
        }),
        sample("organizer-open", 150, 20_000, organizerDom(40)),
        sample("jump-page-values", 150, 20_000, { appMs: 30 }),
      ],
    });
    const b = result("b", {
      samples: [
        sample("organizer-click", 150, 20_000, {
          appMs: 48,
          ...organizerDom(36),
        }),
        sample("organizer-open", 150, 20_000, organizerDom(36)),
        sample("jump-page-values", 150, 20_000, { appMs: 30 }),
      ],
    });
    const cmp = compareResults(a, b);
    expect(cmp.samples["organizer-open"].dom.cells).toEqual({
      a: 40,
      b: 36,
      delta: -4,
      pct: -10,
    });
    const md = compareMarkdown(cmp);
    expect(md).toMatch(
      /\| organizer-open \| cells \| 40 \| 36 \| -4 \| -10\.0% \|/,
    );
    expect(md).toMatch(
      /\| organizer-click \| app ms \| 40 \| 48 \| \+8 \| \+20\.0% \|/,
    );
    // SAMPLE_NAMES 순서: jump-page-values → organizer-open → organizer-click (결과 배열 순서와 무관)
    expect(md.indexOf("| jump-page-values | step ms")).toBeLessThan(
      md.indexOf("| organizer-open | step ms"),
    );
    expect(md.indexOf("| organizer-open | step ms")).toBeLessThan(
      md.indexOf("| organizer-click | step ms"),
    );
  });

  it("한쪽에 cells 가 없으면(옛 결과) 그 열은 건너뛴다", () => {
    const old = result("old", {
      samples: [
        {
          ...sample("structure-tab", 150, 20_000),
          dom: { thumbnails: 200, documentRows: 31, images: 210 },
        },
      ],
    });
    const fresh = result("fresh", {
      samples: [sample("structure-tab", 150, 20_000)],
    });
    const cmp = compareResults(old, fresh);
    expect(cmp.samples["structure-tab"].dom.cells).toBeUndefined();
    expect(cmp.samples["structure-tab"].dom.images).toBeDefined();
  });
});

describe("compareResults", () => {
  const before = result("before");
  const after = result("after", {
    timings: {
      ttfb: 100,
      domContentLoaded: 300,
      documentList: 1200,
      firstPageImage: 1000,
      filesDone: 2500,
    },
    network: {
      ...before.network,
      byClass: {
        ...before.network.byClass,
        files: { count: 1, bytes: 100_000, decodedBytes: 500_000, failed: 0 },
        fileHighlights: {
          count: 3,
          bytes: 50_000,
          decodedBytes: 400_000,
          failed: 0,
        },
      },
    },
    samples: [
      sample("after-load", 75, 10_000),
      // structure-tab 없음 → 비교에서 빠진다
      sample("parse-tab", 170, 25_000),
    ],
  });

  it("같은 숫자 키마다 a·b·delta·pct 를 준다", () => {
    const cmp = compareResults(before, after);
    expect(cmp.label).toEqual({ a: "before", b: "after" });
    expect(cmp.timings.firstPageImage).toEqual({
      a: 2000,
      b: 1000,
      delta: -1000,
      pct: -50,
    });
    expect(cmp.timings.ttfb).toEqual({ a: 100, b: 100, delta: 0, pct: 0 });
    expect(cmp.network.byClass.files.bytes).toEqual({
      a: 400_000,
      b: 100_000,
      delta: -300_000,
      pct: -75,
    });
    expect(cmp.samples["after-load"].metrics.JSHeapUsedSize.delta).toBe(
      -75 * MB,
    );
    expect(cmp.samples["after-load"].metrics.Nodes.pct).toBe(-50);
  });

  it("한쪽에만 있는 키·샘플은 건너뛴다", () => {
    const cmp = compareResults(before, after);
    expect(cmp.network.byClass.fileHighlights).toBeUndefined();
    expect(cmp.samples["structure-tab"]).toBeUndefined();
    expect(cmp.samples["parse-tab"]).toBeDefined();
    // 메타 정보는 비교 대상이 아니다
    expect(cmp.dataset).toBeUndefined();
    expect(cmp.options).toBeUndefined();
  });

  it("markdown 에서 증가는 + 로 표시한다", () => {
    const md = compareMarkdown(
      compareResults(
        before,
        result("after", {
          timings: { ...before.timings, filesDone: 6000 },
        }),
      ),
    );
    expect(md).toContain("## compare: before → after");
    expect(md).toMatch(
      /\| filesDone \| 5,000 \| 6,000 \| \+1,000 \| \+20\.0% \|/,
    );
    expect(md).toMatch(/\| firstPageImage \| 2,000 \| 2,000 \| 0 \| 0\.0% \|/);
  });
});

describe("medianResults", () => {
  it("run 여러 개의 숫자 키를 중앙값으로 합치고 샘플은 이름으로 맞춘다", () => {
    const runs = [
      result("before", {
        timings: { ...result("before").timings, filesDone: 5000 },
        samples: [sample("after-load", 150, 20_000)],
      }),
      result("before", {
        timings: { ...result("before").timings, filesDone: 9000 },
        samples: [sample("after-load", 190, 26_000)],
      }),
      result("before", {
        timings: { ...result("before").timings, filesDone: 6000 },
        samples: [sample("after-load", 160, 22_000)],
        partial: true,
        error: "parse-tab: timeout",
      }),
    ];
    const median = medianResults(runs);
    expect(median.runs).toBe(3);
    expect(median.label).toBe("before");
    expect(median.timings.filesDone).toBe(6000);
    expect(median.samples).toHaveLength(1);
    expect(median.samples[0].name).toBe("after-load");
    expect(median.samples[0].metrics.JSHeapUsedSize).toBe(160 * MB);
    expect(median.samples[0].metrics.Nodes).toBe(22_000);
    expect(median.partial).toBe(true);
    expect(median.error).toBe("parse-tab: timeout");
    expect(toMarkdown(median)).toContain("(median of 3 runs)");
  });

  it("어떤 run 에 값이 없어도(null) 숫자끼리 중앙값을 낸다", () => {
    const runs = [null, 300, 100].map(appMs =>
      result("x", {
        timings: { ...result("x").timings, documentListSource: "mark" },
        samples: [sample("jump-page", 150, 20_000, { appMs })],
      }),
    );
    const median = medianResults(runs);
    expect(median.samples[0].appMs).toBe(200);
    expect(median.timings.documentListSource).toBe("mark");
  });

  it("run 하나면 그대로 돌려준다", () => {
    const only = result("x");
    expect(medianResults([only])).toEqual({ ...only, runs: 1 });
  });
});
