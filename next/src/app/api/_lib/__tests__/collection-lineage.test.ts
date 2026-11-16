import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({
  listSearchCollections: vi.fn(),
  listSourceJobFiles: vi.fn(),
  listSourceJobs: vi.fn(),
  getAgentConfig: vi.fn(),
  searchSourceJobs: vi.fn(),
  getJobResponse: vi.fn(),
  listCollectionBindings: vi.fn(),
}));

vi.mock("@/lib/upstage/collections", () => ({
  listSearchCollections: upstream.listSearchCollections,
  listSourceJobFiles: upstream.listSourceJobFiles,
  listSourceJobs: upstream.listSourceJobs,
}));
vi.mock("@/lib/upstage/lineage", () => ({
  getAgentConfig: upstream.getAgentConfig,
  searchSourceJobs: upstream.searchSourceJobs,
  getJobResponse: upstream.getJobResponse,
  listCollectionBindings: upstream.listCollectionBindings,
}));

import { UpstreamNetworkError } from "@/lib/upstage/errors";

import {
  LineageListError,
  clearCollectionLineageCache,
  clearCollectionLineageResultCache as clearResultCache,
  configImportSources,
  finalizeEdges,
  importSourceIds,
  rankSourceCandidates,
  readCollectionLineage,
  toLineage,
} from "../collection-lineage";

const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const row = (
  id: string,
  agentId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  name: `name-${id}`,
  table_key: `export_${id}`,
  is_default: false,
  source: { type: "agent_export", label: agentId },
  source_agent: { id: agentId, name: `wf-${agentId}` },
  total_job_count: 2,
  pending_job_count: 0,
  failed_job_count: 0,
  updated_at: 100,
  ...overrides,
});

const binding = (
  agentId: string,
  configId: string,
  overrides: Record<string, unknown> = {},
) => ({
  agent_id: agentId,
  config_id: configId,
  boundary_kind: "export",
  completed_job_count: 1,
  ...overrides,
});

interface World {
  rows: Record<string, unknown>[];
  bindings?: Record<string, unknown[]>;
  configs?: Record<string, unknown>;
  jobRows?: Record<string, unknown[]>;
}

/** 목록·binding·Config 응답을 준비한다. 없는 Config 는 403 이다. */
function arrange({ rows, bindings = {}, configs = {}, jobRows = {} }: World) {
  upstream.listSearchCollections.mockImplementation(async () =>
    json({ data: rows, has_more: false }),
  );
  upstream.listCollectionBindings.mockImplementation(async (id: string) =>
    json({ data: bindings[id] ?? [] }),
  );
  upstream.listSourceJobs.mockImplementation(async (id: string) =>
    json({ data: jobRows[id] ?? [] }),
  );
  upstream.getAgentConfig.mockImplementation(
    async (_agentId: string, configId: string) =>
      configId in configs
        ? json(configs[configId])
        : json({ error: { code: "forbidden" } }, 403),
  );
}

const resultImport = (id: string, overrides = {}) =>
  row(id, "agt_hidden", {
    source: { type: "result_import", label: "result-snapshot" },
    ...overrides,
  });

const agentLink = (id: string, agentId: string, overrides = {}) =>
  row(id, agentId, {
    is_default: true,
    source: { type: "agent_link", label: agentId },
    ...overrides,
  });

/** Job id → `{ model, source_job_id }`. 없는 Job 은 404 다. */
function arrangeJobs(jobs: Record<string, unknown>) {
  upstream.getJobResponse.mockImplementation(async (jobId: string) =>
    jobId in jobs
      ? json(jobs[jobId])
      : json({ error: { code: "not_found" } }, 404),
  );
}

const jobSearchResult = (jobId: string) =>
  json({ data: [{ source_job_id: jobId }] });

const importStep = (...collectionIds: string[]) => ({
  type: "import",
  data: { provider: "collection", collection_ids: collectionIds },
});

const importConfig = (...collectionIds: string[]) => ({
  steps: [importStep(...collectionIds)],
});

beforeEach(() => {
  clearCollectionLineageCache();
});

afterEach(() => {
  for (const mock of Object.values(upstream)) mock.mockReset();
  vi.useRealTimers();
});

describe("importSourceIds", () => {
  it("세 형식을 모두 읽고 중복을 뺀다", () => {
    expect(importSourceIds({ collection_id: "a" })).toEqual(["a"]);
    expect(importSourceIds({ collection_ids: ["a", "b", "a"] })).toEqual([
      "a",
      "b",
    ]);
    expect(
      importSourceIds({
        selection_version: 2,
        sources: [
          { collection_id: "a", shape_ids: ["ish_1"] },
          { collection_id: "b", shape_ids: ["ish_2"] },
        ],
      }),
    ).toEqual(["a", "b"]);
  });

  it("모양이 다르면 비어 있다", () => {
    expect(importSourceIds(null)).toEqual([]);
    expect(importSourceIds({ collection_ids: "a", sources: [null] })).toEqual(
      [],
    );
  });
});

describe("configImportSources", () => {
  it("Import Step 만 본다", () => {
    expect(
      configImportSources({
        steps: [
          { type: "export", data: { collection_id: "x" } },
          { type: "import", data: { collection_id: "a" } },
        ],
      }),
    ).toEqual(["a"]);
    expect(configImportSources({})).toEqual([]);
  });
});

describe("finalizeEdges", () => {
  const edge = (from: string, to: string, mirror = false) => ({
    from,
    to,
    kind: "import" as const,
    workflow: "W",
    mirror,
  });

  it("중복과 자기 연결을 지운다", () => {
    expect(
      finalizeEdges([edge("a", "b"), edge("a", "b"), edge("a", "a")]),
    ).toEqual([{ from: "a", to: "b", kind: "import", workflow: "W" }]);
  });

  it("기본 Collection 사본으로 가는 연결은 지운다", () => {
    expect(
      finalizeEdges([edge("a", "b"), edge("a", "default", true)]),
    ).toHaveLength(1);
  });

  it("같은 연결이 사본과 Export 양쪽이면 사본이 아니다", () => {
    expect(
      finalizeEdges([edge("a", "b", true), edge("a", "b", false)]),
    ).toHaveLength(1);
  });

  it("목록에 없는 Collection 으로 끝나는 연결은 지운다", () => {
    expect(finalizeEdges([edge("a", "hidden")], new Set(["hidden"]))).toEqual(
      [],
    );
  });

  it("목록에 없는 Collection 이 다른 Collection 의 원본이면 남긴다", () => {
    const edges = finalizeEdges(
      [edge("a", "hidden"), edge("hidden", "c")],
      new Set(["hidden"]),
    );
    expect(edges.map(item => item.to)).toEqual(["hidden", "c"]);
  });

  it("지운 뒤 다시 끝이 되는 목록 밖 Collection 도 지운다", () => {
    const hidden = new Set(["h1", "h2"]);
    expect(finalizeEdges([edge("a", "h1"), edge("h1", "h2")], hidden)).toEqual(
      [],
    );
  });

  it("사본이 다시 원본으로 쓰이면 남긴다", () => {
    const edges = finalizeEdges([
      edge("a", "default", true),
      edge("default", "c"),
    ]);
    expect(edges.map(item => item.to)).toEqual(["default", "c"]);
  });
});

describe("rankSourceCandidates", () => {
  it("table_key 가 같은 Collection, 기본이 아닌 Collection 순이다", () => {
    const ranked = rankSourceCandidates(
      [
        { table_key: "link:a", is_default: true },
        { table_key: "other", is_default: false },
        { table_key: "same", is_default: true },
        { table_key: "same", is_default: false },
      ],
      { table_key: "same" },
    );
    expect(ranked.map(item => [item.table_key, item.is_default])).toEqual([
      ["same", false],
      ["same", true],
      ["other", false],
      ["link:a", true],
    ]);
  });
});

describe("toLineage", () => {
  it("연결된 Collection 만 화면 필드로 담고 없는 원본은 missing 으로 둔다", () => {
    const lineage = toLineage(
      [row("b", "agt"), row("c", "agt")],
      [{ from: "gone", to: "b", kind: "import", workflow: null }],
      { partial: false, unverified: new Set(["c"]) },
    );
    expect(lineage.nodes.map(node => node.id)).toEqual(["b", "gone"]);
    expect(lineage.nodes[1]).toEqual({ id: "gone", missing: true });
    expect(lineage.nodes[0]).not.toHaveProperty("table_key");
    expect(lineage.nodes[0]).not.toHaveProperty("source_agent");
    expect(lineage.unrelated_count).toBe(1);
    expect(lineage.unverified_count).toBe(1);
  });

  it("연결 없는 수는 목록에 보이는 Collection 만 센다", () => {
    const lineage = toLineage(
      [row("a", "agt"), row("hidden", "agt", { listed: false })],
      [],
      { partial: false, unverified: new Set() },
    );
    expect(lineage.unrelated_count).toBe(1);
  });

  it("확인하지 못한 수는 화면에 나올 수 있는 Collection 만 센다", () => {
    const lineage = toLineage(
      [
        row("a", "agt"),
        row("hidden", "agt", { listed: false }),
        row("bridge", "agt", { listed: false }),
        row("c", "agt"),
      ],
      [{ from: "bridge", to: "c", kind: "import", workflow: null }],
      { partial: false, unverified: new Set(["a", "hidden", "bridge"]) },
    );
    expect(lineage.unverified_count).toBe(2);
  });

  it("연결은 모인 순서와 상관없이 목록 순서로 돌려준다", () => {
    const edge = (
      from: string,
      to: string,
      workflow: string | null = null,
    ) => ({
      from,
      to,
      kind: "import" as const,
      workflow,
    });
    const rows = [row("a", "agt"), row("b", "agt"), row("c", "agt")];
    const scan = { partial: false, unverified: new Set<string>() };
    const shuffled = [
      edge("c", "b", "W2"),
      edge("a", "c"),
      edge("c", "b", "W1"),
    ];
    const lineage = toLineage(rows, shuffled, scan);
    expect(lineage.edges).toEqual([
      edge("c", "b", "W1"),
      edge("c", "b", "W2"),
      edge("a", "c"),
    ]);
    expect(toLineage(rows, [...shuffled].reverse(), scan).edges).toEqual(
      lineage.edges,
    );
  });
});

describe("readCollectionLineage", () => {
  it("Import Step 으로 Collection 을 잇는다", async () => {
    arrange({
      rows: [row("c", "agt_3"), row("b", "agt_2"), row("a", "agt_1")],
      bindings: {
        a: [binding("agt_1", "cfg_1")],
        b: [binding("agt_2", "cfg_2")],
        c: [binding("agt_3", "cfg_3")],
      },
      configs: {
        cfg_1: { steps: [{ type: "document-parse" }] },
        cfg_2: importConfig("a"),
        cfg_3: importConfig("b"),
      },
    });
    const lineage = await readCollectionLineage();
    expect(lineage.partial).toBe(false);
    expect(lineage.nodes.map(node => node.id)).toEqual(["c", "b", "a"]);
    expect(lineage.edges).toEqual(
      expect.arrayContaining([
        { from: "a", to: "b", kind: "import", workflow: "wf-agt_2" },
        { from: "b", to: "c", kind: "import", workflow: "wf-agt_3" },
      ]),
    );
  });

  it("결과가 없는 Collection 은 upstream 을 부르지 않는다", async () => {
    arrange({ rows: [row("a", "agt_1", { total_job_count: 0 })] });
    const lineage = await readCollectionLineage();
    expect(upstream.listCollectionBindings).not.toHaveBeenCalled();
    expect(lineage).toMatchObject({ edges: [], unrelated_count: 1 });
  });

  it("완료 결과가 없는 binding 은 잇지 않는다", async () => {
    arrange({
      rows: [row("a", "agt_1"), row("b", "agt_2")],
      bindings: {
        b: [binding("agt_2", "cfg_2", { completed_job_count: 0 })],
      },
      configs: { cfg_2: importConfig("a") },
    });
    expect((await readCollectionLineage()).edges).toEqual([]);
    expect(upstream.getAgentConfig).not.toHaveBeenCalled();
  });

  it("bindings 다음 페이지의 Config 도 읽는다", async () => {
    arrange({
      rows: [row("a", "agt_1"), row("b", "agt_2")],
      configs: { cfg_old: importConfig("a") },
    });
    upstream.listCollectionBindings.mockImplementation(
      async (id: string, query: { after?: string }) => {
        if (id !== "b") return json({ data: [] });
        return query.after === "c1"
          ? json({ data: [binding("agt_2", "cfg_old")], has_more: false })
          : json({ data: [], has_more: true, last_cursor: "c1" });
      },
    );
    const lineage = await readCollectionLineage();
    expect(lineage.edges.map(edge => edge.from)).toEqual(["a"]);
    expect(lineage.partial).toBe(false);
  });

  it("bindings 페이지 상한을 넘으면 받은 데까지로 partial 이다", async () => {
    arrange({
      rows: [row("a", "agt_1"), row("b", "agt_2")],
      configs: { cfg_2: importConfig("a") },
    });
    upstream.listCollectionBindings.mockImplementation(async (id: string) =>
      id === "b"
        ? json({
            data: [binding("agt_2", "cfg_2")],
            has_more: true,
            last_cursor: "next",
          })
        : json({ data: [] }),
    );
    const lineage = await readCollectionLineage();
    expect(lineage.edges).toHaveLength(1);
    expect(lineage.partial).toBe(true);
    expect(
      upstream.listCollectionBindings.mock.calls.filter(([id]) => id === "b"),
    ).toHaveLength(5);
  });

  it("기본 Collection 사본은 그림에 넣지 않는다", async () => {
    arrange({
      rows: [
        row("a", "agt_1"),
        row("b", "agt_2"),
        row("b_default", "agt_2", { is_default: true }),
      ],
      bindings: {
        b: [binding("agt_2", "cfg_2")],
        b_default: [
          binding("agt_2", "cfg_2", { boundary_kind: "export_input" }),
        ],
      },
      configs: {
        cfg_2: {
          steps: [
            importStep("a"),
            { type: "export", data: { collection: {} } },
          ],
        },
      },
    });
    const lineage = await readCollectionLineage();
    expect(lineage.edges.map(edge => edge.to)).toEqual(["b"]);
    expect(lineage.unrelated_count).toBe(1);
  });

  it.each([
    ["Review", { type: "review", data: {} }],
    [
      "HTTP Export",
      {
        type: "export",
        data: {
          destination: { type: "http", method: "POST", url: "https://x" },
        },
      },
    ],
  ])(
    "%s 로 끝나는 Workflow 의 export_input 은 사본이 아니다",
    async (_, step) => {
      arrange({
        rows: [row("a", "agt_1"), row("result", "agt_2", { is_default: true })],
        bindings: {
          result: [
            binding("agt_2", "cfg_2", { boundary_kind: "export_input" }),
          ],
        },
        configs: { cfg_2: { steps: [importStep("a"), step] } },
      });
      expect((await readCollectionLineage()).edges).toEqual([
        { from: "a", to: "result", kind: "import", workflow: "wf-agt_2" },
      ]);
    },
  );

  it("목록에 없는 기본 Collection 은 원본일 때만 그림에 넣는다", async () => {
    arrange({
      rows: [
        row("a", "agt_1"),
        row("leaf", "agt_2", { listed: false }),
        row("bridge", "agt_3", { listed: false }),
        row("c", "agt_4"),
      ],
      bindings: {
        leaf: [binding("agt_2", "cfg_2", { boundary_kind: "terminal" })],
        bridge: [binding("agt_3", "cfg_3", { boundary_kind: "terminal" })],
        c: [binding("agt_4", "cfg_4")],
      },
      configs: {
        cfg_2: importConfig("a"),
        cfg_3: importConfig("a"),
        cfg_4: importConfig("bridge"),
      },
    });
    const lineage = await readCollectionLineage();
    expect(lineage.nodes.map(node => node.id).sort()).toEqual([
      "a",
      "bridge",
      "c",
    ]);
    expect(lineage.unrelated_count).toBe(0);
  });

  it("같은 Config 는 한 번만 읽는다", async () => {
    arrange({
      rows: [row("a", "agt_1"), row("b", "agt_2"), row("c", "agt_2")],
      bindings: {
        b: [binding("agt_2", "cfg_2")],
        c: [binding("agt_2", "cfg_2")],
      },
      configs: { cfg_2: importConfig("a") },
    });
    await readCollectionLineage();
    expect(upstream.getAgentConfig).toHaveBeenCalledTimes(1);
  });

  it("결과 가져오기는 Job 계보로 원본을 찾는다", async () => {
    arrange({
      rows: [
        resultImport("fixed", { table_key: "shared" }),
        row("default", "agt_1", { is_default: true, table_key: "link:1" }),
        row("original", "agt_1", { table_key: "shared" }),
      ],
      bindings: {
        default: [binding("agt_1", "cfg_1", { boundary_kind: "export_input" })],
        fixed: [binding("agt_hidden", "cfg_hidden")],
        original: [binding("agt_1", "cfg_1")],
      },
      configs: { cfg_1: {} },
    });
    upstream.searchSourceJobs.mockResolvedValue(jobSearchResult("job_fixed"));
    arrangeJobs({
      job_fixed: { model: "agt_hidden", source_job_id: "job_original" },
      job_original: { model: "agt_1", source_job_id: null },
    });
    upstream.listSourceJobFiles.mockImplementation(async () =>
      json({ data: [] }),
    );

    const lineage = await readCollectionLineage();
    expect(lineage.partial).toBe(false);
    expect(lineage.edges).toEqual([
      { from: "original", to: "fixed", kind: "result_import", workflow: null },
    ]);
    // 숨은 Agent 의 Config 가 거부되는 것은 정상이라 확인 못 한 Collection 으로 세지 않는다.
    expect(lineage.unverified_count).toBe(0);
    expect(upstream.getAgentConfig).toHaveBeenCalledWith(
      "agt_hidden",
      "cfg_hidden",
    );
    expect(upstream.listSourceJobFiles).toHaveBeenCalledTimes(1);
    expect(upstream.listSourceJobFiles).toHaveBeenCalledWith(
      "original",
      "job_original",
    );
  });

  /** 결과 가져오기 `fixed` 와 원본 `original`. */
  const correctedWorld = {
    rows: [resultImport("fixed"), row("original", "agt_1")],
    bindings: {
      fixed: [binding("agt_hidden", "cfg_hidden")],
      original: [binding("agt_1", "cfg_1")],
    },
    configs: { cfg_1: {} },
  };

  it("결과 유형이 여럿이면 첫 유형으로 다시 찾는다", async () => {
    arrange(correctedWorld);
    upstream.searchSourceJobs.mockImplementation(
      async (_id: string, body: { result_type_key?: string }) =>
        body.result_type_key === "invoice"
          ? jobSearchResult("job_fixed")
          : json(
              {
                error: {
                  code: "result_type_required",
                  details: { result_type_keys: ["invoice", "receipt"] },
                },
              },
              400,
            ),
    );
    arrangeJobs({
      job_fixed: { model: "agt_hidden", source_job_id: "job_original" },
      job_original: { model: "agt_1" },
    });
    upstream.listSourceJobFiles.mockImplementation(async () =>
      json({ data: [] }),
    );
    const lineage = await readCollectionLineage();
    expect(lineage.edges).toHaveLength(1);
    expect(lineage.partial).toBe(false);
  });

  it("내용을 교체한 Collection 은 지워진 이전 세대를 지나 원본까지 올라간다", async () => {
    arrange(correctedWorld);
    upstream.searchSourceJobs.mockResolvedValue(jobSearchResult("job_new"));
    arrangeJobs({
      job_new: { model: "agt_hidden", source_job_id: "job_old" },
      job_old: { model: "agt_hidden", source_job_id: "job_original" },
      job_original: { model: "agt_1", source_job_id: null },
    });
    upstream.listSourceJobFiles.mockImplementation(async () =>
      json({ data: [] }),
    );
    const lineage = await readCollectionLineage();
    expect(lineage.edges.map(edge => edge.from)).toEqual(["original"]);
    expect(upstream.getJobResponse).toHaveBeenCalledTimes(3);
  });

  it("계보가 끝없이 이어져도 상한에서 멈춘다", async () => {
    arrange(correctedWorld);
    upstream.searchSourceJobs.mockResolvedValue(jobSearchResult("job_loop"));
    arrangeJobs({
      job_loop: { model: "agt_hidden", source_job_id: "job_loop" },
    });
    const lineage = await readCollectionLineage();
    expect(lineage.edges).toEqual([]);
    expect(upstream.getJobResponse).toHaveBeenCalledTimes(9);
  });

  it("Job 을 찾을 수 없는 결과 가져오기는 확인하지 못한 수로 센다", async () => {
    arrange({ rows: [resultImport("fixed")] });
    upstream.searchSourceJobs.mockResolvedValue(
      json({ error: { code: "collection_schema_not_ready" } }, 409),
    );
    expect(await readCollectionLineage()).toMatchObject({
      edges: [],
      partial: false,
      unverified_count: 1,
    });
  });

  it("앞 단계에서 원본을 못 읽었을 때의 못 찾음은 남기지 않는다", async () => {
    arrange(correctedWorld);
    upstream.searchSourceJobs.mockImplementation(async () =>
      jobSearchResult("job_fixed"),
    );
    arrangeJobs({
      job_fixed: { model: "agt_hidden", source_job_id: "job_original" },
      job_original: { model: "agt_1" },
    });
    upstream.listSourceJobFiles.mockImplementation(async () =>
      json({ data: [] }),
    );
    const bindings = upstream.listCollectionBindings.getMockImplementation();
    upstream.listCollectionBindings.mockImplementation(
      async (id: string, ...rest: unknown[]) =>
        id === "original"
          ? json({ error: { code: "internal" } }, 500)
          : bindings?.(id, ...rest),
    );
    const first = await readCollectionLineage();
    expect(first).toMatchObject({ edges: [], partial: true });

    upstream.listCollectionBindings.mockImplementation(
      async (id: string, ...rest: unknown[]) => bindings?.(id, ...rest),
    );
    const second = await readCollectionLineage();
    expect(second.edges).toHaveLength(1);
    expect(second.partial).toBe(false);
  });

  it("결과 수가 바뀌면 결과 가져오기의 원본을 다시 찾는다", async () => {
    arrange(correctedWorld);
    upstream.searchSourceJobs.mockResolvedValue(
      json({ error: { code: "collection_schema_not_ready" } }, 409),
    );
    await readCollectionLineage();
    clearResultCache();
    arrange({
      ...correctedWorld,
      rows: [
        resultImport("fixed", { total_job_count: 3 }),
        row("original", "agt_1"),
      ],
    });
    await readCollectionLineage();
    expect(upstream.searchSourceJobs).toHaveBeenCalledTimes(2);
  });

  describe("기본 Collection 의 스키마 없는 결과", () => {
    const world = {
      rows: [agentLink("result", "agt_2"), row("a", "agt_1")],
      jobRows: { result: [{ config: { id: "cfg_2" } }] },
    };

    it("bindings 에 없어도 Job 행의 Config 로 잇는다", async () => {
      arrange({
        ...world,
        configs: {
          cfg_2: {
            steps: [
              {
                type: "import",
                data: { provider: "collection", collection_ids: ["a"] },
              },
              { type: "instruct" },
            ],
          },
        },
      });
      const lineage = await readCollectionLineage();
      expect(lineage.edges).toEqual([
        { from: "a", to: "result", kind: "import", workflow: "wf-agt_2" },
      ]);
      expect(upstream.listSourceJobs).toHaveBeenCalledWith("result", {
        status: "completed",
        limit: 100,
      });
    });

    it("Config 에 Export 가 있으면 사본이라 잇지 않는다", async () => {
      arrange({
        ...world,
        configs: {
          cfg_2: {
            steps: [
              { type: "import", data: { collection_ids: ["a"] } },
              { type: "export" },
            ],
          },
        },
      });
      expect((await readCollectionLineage()).edges).toEqual([]);
    });

    it("HTTP Export 는 Collection 에 쓰지 않으므로 사본으로 치지 않는다", async () => {
      arrange({
        ...world,
        configs: {
          cfg_2: {
            steps: [
              importStep("a"),
              {
                type: "export",
                data: {
                  destination: { type: "http", method: "POST", url: "x" },
                },
              },
            ],
          },
        },
      });
      expect((await readCollectionLineage()).edges).toHaveLength(1);
    });

    it("Export Collection 은 Job 행을 읽지 않는다", async () => {
      arrange({ rows: [row("a", "agt_1")] });
      await readCollectionLineage();
      expect(upstream.listSourceJobs).not.toHaveBeenCalled();
    });
  });

  it("Config 를 볼 수 없는 Collection 은 확인하지 못한 수로 세고 캐시한다", async () => {
    arrange({
      rows: [row("a", "agt_1")],
      bindings: { a: [binding("agt_1", "cfg_gone")] },
    });
    upstream.getAgentConfig.mockImplementation(async () =>
      json({ error: { code: "not_found" } }, 404),
    );
    expect(await readCollectionLineage()).toMatchObject({
      partial: false,
      unverified_count: 1,
    });
    clearResultCache();
    expect(await readCollectionLineage()).toMatchObject({
      unverified_count: 1,
    });
    expect(upstream.getAgentConfig).toHaveBeenCalledTimes(1);
  });

  it("읽지 못한 곳이 있으면 partial 이고 캐시하지 않아 다시 읽는다", async () => {
    arrange({
      rows: [row("a", "agt_1"), row("b", "agt_2")],
      bindings: { b: [binding("agt_2", "cfg_2")] },
      configs: { cfg_2: importConfig("a") },
    });
    upstream.listCollectionBindings.mockImplementationOnce(async () =>
      json({ error: { code: "internal" } }, 500),
    );
    upstream.listCollectionBindings.mockImplementationOnce(async () =>
      json({ error: { code: "internal" } }, 500),
    );
    const first = await readCollectionLineage();
    expect(first.partial).toBe(true);
    expect(first.edges).toEqual([]);

    const second = await readCollectionLineage();
    expect(second.partial).toBe(false);
    expect(second.edges).toHaveLength(1);
  });

  it("429 는 Retry-After 뒤에 다시 부른다", async () => {
    vi.useFakeTimers();
    arrange({
      rows: [row("a", "agt_1")],
      bindings: { a: [binding("agt_1", "cfg_1")] },
      configs: { cfg_1: {} },
    });
    upstream.listCollectionBindings.mockImplementationOnce(async () =>
      json({ error: { code: "rate_limited" } }, 429, { "Retry-After": "1" }),
    );
    const pending = readCollectionLineage();
    await vi.runAllTimersAsync();
    const lineage = await pending;
    expect(lineage.partial).toBe(false);
    expect(upstream.listCollectionBindings).toHaveBeenCalledTimes(2);
  });

  it("429 가 끝나지 않으면 partial 이다", async () => {
    vi.useFakeTimers();
    arrange({ rows: [row("a", "agt_1")] });
    upstream.listCollectionBindings.mockImplementation(async () =>
      json({ error: { code: "rate_limited" } }, 429),
    );
    const pending = readCollectionLineage();
    await vi.runAllTimersAsync();
    expect((await pending).partial).toBe(true);
    expect(upstream.listCollectionBindings).toHaveBeenCalledTimes(3);
  });

  it("시간 상한은 목록을 다 읽은 뒤부터 잰다", async () => {
    vi.useFakeTimers();
    arrange({
      rows: [row("a", "agt_1"), row("b", "agt_2")],
      bindings: { b: [binding("agt_2", "cfg_2")] },
      configs: { cfg_2: importConfig("a") },
    });
    const list = upstream.listSearchCollections.getMockImplementation();
    upstream.listSearchCollections.mockImplementation(async () => {
      vi.advanceTimersByTime(31_000);
      return list?.();
    });
    expect(await readCollectionLineage()).toMatchObject({
      partial: false,
      edges: [{ from: "a", to: "b" }],
    });
  });

  it("본문을 읽다 끊기면 전체가 실패하지 않고 partial 이다", async () => {
    arrange({ rows: [row("a", "agt_1")] });
    upstream.listCollectionBindings.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("terminated"));
            },
          }),
        ),
    );
    expect(await readCollectionLineage()).toMatchObject({ partial: true });
  });

  it("목록의 429 도 다시 부른다", async () => {
    vi.useFakeTimers();
    arrange({ rows: [row("a", "agt_1", { total_job_count: 0 })] });
    upstream.listSearchCollections.mockImplementationOnce(async () =>
      json({ error: { code: "rate_limited" } }, 429, { "Retry-After": "1" }),
    );
    const pending = readCollectionLineage();
    await vi.runAllTimersAsync();
    expect((await pending).partial).toBe(false);
    expect(upstream.listSearchCollections).toHaveBeenCalledTimes(2);
  });

  it("다음 목록 페이지가 네트워크 오류면 받은 데까지로 partial 이다", async () => {
    upstream.listSearchCollections
      .mockResolvedValueOnce(
        json({ data: [row("a", "agt_1")], has_more: true, last_cursor: "c1" }),
      )
      .mockRejectedValueOnce(new UpstreamNetworkError(new Error("boom")));
    upstream.listCollectionBindings.mockImplementation(async () =>
      json({ data: [] }),
    );
    expect(await readCollectionLineage()).toMatchObject({
      partial: true,
      unrelated_count: 1,
    });
  });

  it("목록 첫 페이지가 네트워크 오류면 그대로 던진다", async () => {
    upstream.listSearchCollections.mockRejectedValue(
      new UpstreamNetworkError(new Error("boom")),
    );
    await expect(readCollectionLineage()).rejects.toBeInstanceOf(
      UpstreamNetworkError,
    );
  });

  it("다음 목록 페이지가 실패하면 받은 데까지로 partial 이다", async () => {
    upstream.listSearchCollections
      .mockResolvedValueOnce(
        json({ data: [row("a", "agt_1")], has_more: true, last_cursor: "c1" }),
      )
      .mockResolvedValueOnce(json({ error: { code: "internal" } }, 500));
    upstream.listCollectionBindings.mockImplementation(async () =>
      json({ data: [] }),
    );
    const lineage = await readCollectionLineage();
    expect(upstream.listSearchCollections).toHaveBeenLastCalledWith(
      expect.objectContaining({ after: "c1" }),
    );
    expect(lineage).toMatchObject({ partial: true, unrelated_count: 1 });
  });

  it("목록 첫 페이지가 실패하면 응답을 담아 던진다", async () => {
    upstream.listSearchCollections.mockResolvedValue(
      json({ error: { code: "unauthorized" } }, 401),
    );
    await expect(readCollectionLineage()).rejects.toBeInstanceOf(
      LineageListError,
    );
  });

  it("동시 요청과 잠깐 사이의 다시 읽기는 탐색 한 번을 함께 쓴다", async () => {
    arrange({ rows: [row("a", "agt_1", { total_job_count: 0 })] });
    await Promise.all([readCollectionLineage(), readCollectionLineage()]);
    await readCollectionLineage();
    expect(upstream.listSearchCollections).toHaveBeenCalledTimes(1);
  });
});
