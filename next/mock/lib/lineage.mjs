// Collection 관계 화면용 mock 데이터. 검수 화면이 쓰는 Collection 하나(`base`) 뒤로 Import 와 결과
// 가져오기로 이어진 Collection 들을 붙인다. 실제 응답처럼 Agent 의 Config, Collection 의 binding,
// Job 의 `source_job_id` 로 흩어져 있고 관계를 직접 주는 응답은 없다.
//
//   base ─ Import ─▶ second ─ Import ─▶ third ─ Import ─▶ merged
//    └──────────────────────── Import ──────────────────────▲
//   second ─ 결과 가져오기 ─▶ corrected
//   third ─ Import ─▶ instruct
//   other ─ Import ─▶ otherResult
//   (삭제된 Collection) ─ Import ─▶ orphan
//
// `instruct` 는 Import → Instruct 로 끝나는 Workflow 의 기본 Collection(직접 만들어 목록에 보임)이라
// `bindings` 가 비어 있고 Job 행에만 Config 가 있다. `corrected` 는 유형이 둘이고, 내용을 한 번 교체해 Job 이 지워진 이전 세대를
// 거쳐 원본으로 이어진다. 기본 Collection 사본 둘(`bindings` 의 `export_input`, Job 행뿐이고 Config 에
// Export 가 있는 경우)은 화면에 나오면 안 되고, `unrelated` 와 `empty` 는 이어진 곳이 없다.
// `unreadable` 은 Workflow 가 지워져 Config 를 읽을 수 없어 연결을 확인하지 못한다.

const HIDDEN_AGENT = "agt_mock_line_snapshot";
const RESULT_TYPE_KEY = "mock_invoice";
const DELETED_COLLECTION = "scol_mock_line_deleted";
const AT = 1_792_000_000;

const row = (id, name, agent, overrides = {}) => ({
  id,
  object: "search_collection",
  table_key: `export_${id}`,
  name,
  description: null,
  kind: "documents",
  is_default: false,
  default_for_agent_id: null,
  listed: true,
  source: { type: "agent_export", label: agent.name },
  source_agent: { id: agent.id, name: agent.name },
  total_job_count: 4,
  latest_config_job_count: 4,
  pending_job_count: 0,
  failed_job_count: 0,
  last_result_at: AT,
  file_count: 2,
  project: null,
  created_at: AT,
  updated_at: AT,
  latest_config_ids: [agent.config],
  latest_config_id: agent.config,
  head_binding: null,
  ...overrides,
});

const agent = (key, name) => ({
  id: `agt_mock_line_${key}`,
  config: `cfg_mock_line_${key}`,
  name,
});

const binding = (agentRef, boundaryKind = "export", completed = 4) => ({
  object: "search_collection.binding",
  agent_id: agentRef.id,
  config_id: agentRef.config,
  boundary_kind: boundaryKind,
  export_kind: boundaryKind === "export" ? "explicit" : "implicit",
  completed_job_count: completed,
  is_active: true,
});

const config = (agentRef, importData, { exports = true } = {}) => ({
  id: agentRef.config,
  object: "config",
  agent_id: agentRef.id,
  is_default: true,
  steps: [
    ...(importData
      ? [{ name: "import", type: "import", data: importData, is_first: true }]
      : []),
    ...(exports
      ? [
          {
            name: "export",
            type: "export",
            data: { custom_name: agentRef.name, collection: {} },
          },
        ]
      : [{ name: "instruct", type: "instruct", data: {} }]),
  ],
});

const defaultRow = (id, name, agentRef) =>
  row(id, name, agentRef, {
    table_key: `link:${agentRef.id}`,
    is_default: true,
    default_for_agent_id: agentRef.id,
    listed: false,
    source: { type: "agent_link", label: agentRef.name },
  });

const jobRow = (id, agentRef) => ({
  object: "search_collection.job_row",
  job_id: id,
  status: "completed",
  config: { id: agentRef.config, is_latest: true },
  files: [],
});

/** `base` 는 dataset 의 Collection. 돌려주는 `base` 에는 mock 서버가 쓸 필드가 더해져 있다. */
export function buildLineageFixture(base) {
  const agents = {
    base: agent("base", "Mock agent"),
    second: agent("second", "Mock step 2"),
    third: agent("third", "Mock step 3"),
    merged: agent("merged", "Mock step 4"),
    other: agent("other", "Mock other agent"),
    otherResult: agent("other_result", "Mock other step"),
    orphan: agent("orphan", "Mock orphan step"),
    instruct: agent("instruct", "Mock instruct step"),
    unrelated: agent("unrelated", "Mock unrelated agent"),
    deleted: agent("deleted", "Mock deleted agent"),
  };
  const ids = {
    second: "scol_mock_line_second",
    secondDefault: "scol_mock_line_second_default",
    third: "scol_mock_line_third",
    thirdDefault: "scol_mock_line_third_default",
    instruct: "scol_mock_line_instruct",
    corrected: "scol_mock_line_corrected",
    merged: "scol_mock_line_merged",
    other: "scol_mock_line_other",
    otherResult: "scol_mock_line_other_result",
    orphan: "scol_mock_line_orphan",
    unrelated: "scol_mock_line_unrelated",
    empty: "scol_mock_line_empty",
    unreadable: "scol_mock_line_unreadable",
  };

  const baseRow = {
    ...base,
    table_key: `export_${base.id}`,
    source_agent: { id: agents.base.id, name: agents.base.name },
  };
  const collections = [
    row(ids.merged, "Mock merged results", agents.merged),
    row(ids.third, "Mock third pass", agents.third),
    row(ids.corrected, "Mock corrected results", agents.second, {
      table_key: `export_${ids.second}`,
      source: { type: "result_import", label: "result-snapshot" },
      source_agent: { id: HIDDEN_AGENT, name: "result-snapshot" },
    }),
    row(ids.second, "Mock second pass", agents.second),
    defaultRow(ids.secondDefault, "Mock step 2 results", agents.second),
    defaultRow(ids.thirdDefault, "Mock step 3 results", agents.third),
    // 직접 만든 Collection 이 기본이 된 경우라 목록에 보인다.
    {
      ...defaultRow(ids.instruct, "Mock instruct results", agents.instruct),
      listed: true,
    },
    row(ids.other, "Mock other source", agents.other),
    row(ids.otherResult, "Mock other result", agents.otherResult),
    row(ids.orphan, "Mock orphan result", agents.orphan),
    row(ids.unrelated, "Mock unrelated", agents.unrelated),
    row(ids.empty, "Mock empty", agents.unrelated, {
      total_job_count: 0,
      latest_config_job_count: 0,
      last_result_at: null,
    }),
    row(ids.unreadable, "Mock unreadable workflow", agents.deleted),
  ];

  const hiddenBinding = {
    ...binding(
      { id: HIDDEN_AGENT, config: "cfg_mock_line_snapshot" },
      "terminal",
    ),
  };
  const bindings = {
    [base.id]: [binding(agents.base)],
    [ids.second]: [binding(agents.second)],
    [ids.secondDefault]: [binding(agents.second, "export_input")],
    [ids.third]: [binding(agents.third)],
    [ids.corrected]: [hiddenBinding],
    [ids.merged]: [binding(agents.merged)],
    [ids.other]: [binding(agents.other)],
    [ids.otherResult]: [binding(agents.otherResult)],
    [ids.orphan]: [binding(agents.orphan)],
    [ids.unrelated]: [binding(agents.unrelated)],
    [ids.empty]: [binding(agents.unrelated, "export", 0)],
    [ids.unreadable]: [binding(agents.deleted)],
  };
  /** 기본 Collection 의 스키마 없는 결과는 `bindings` 에 없고 Job 행에만 있다. */
  const jobRows = {
    [ids.thirdDefault]: [jobRow("job_mock_line_third", agents.third)],
    [ids.instruct]: [jobRow("job_mock_line_instruct", agents.instruct)],
  };

  const configs = new Map(
    [
      config(agents.base),
      config(agents.second, {
        provider: "collection",
        collection_ids: [base.id],
      }),
      // 형태 선택 형식
      config(agents.third, {
        provider: "collection",
        selection_version: 2,
        sources: [{ collection_id: ids.second, shape_ids: ["ish_mock"] }],
      }),
      config(agents.merged, {
        provider: "collection",
        collection_ids: [base.id, ids.third],
      }),
      config(agents.other),
      // 이전 단일 형식
      config(agents.otherResult, {
        provider: "collection",
        collection_id: ids.other,
      }),
      config(agents.orphan, {
        provider: "collection",
        collection_ids: [DELETED_COLLECTION],
      }),
      config(
        agents.instruct,
        { provider: "collection", collection_ids: [ids.third] },
        { exports: false },
      ),
      config(agents.unrelated),
    ].map(item => [item.id, item]),
  );

  const sourceJob = "job_mock_line_second";
  const correctedJob = "job_mock_line_corrected";
  const replacedJob = "job_mock_line_corrected_old";
  /** 유형이 여럿이면 `result_type_key` 없는 검색은 400 이다. */
  const jobSearch = {
    [ids.corrected]: {
      resultTypeKeys: [RESULT_TYPE_KEY, "mock_receipt"],
      rows: [{ id: correctedJob, source_job_id: correctedJob }],
    },
  };
  const jobs = new Map([
    [
      correctedJob,
      { id: correctedJob, model: HIDDEN_AGENT, source_job_id: replacedJob },
    ],
    [
      replacedJob,
      {
        id: replacedJob,
        model: HIDDEN_AGENT,
        source_job_id: sourceJob,
        is_deleted: true,
      },
    ],
    [
      sourceJob,
      { id: sourceJob, model: agents.second.id, source_job_id: null },
    ],
  ]);
  /** Job id → 그 Job 을 가진 Collection */
  const jobCollections = new Map([
    [sourceJob, new Set([ids.second, ids.secondDefault])],
  ]);

  return {
    base: baseRow,
    collections,
    bindings,
    configs,
    jobRows,
    jobSearch,
    jobs,
    jobCollections,
    hiddenAgent: HIDDEN_AGENT,
  };
}
