import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIST_URL_STATE,
  normalizeListSearch,
  parseListUrlState,
  serializeListUrlState,
  type ListUrlState,
} from "../list-url-state";

const parse = (query: string) => parseListUrlState(new URLSearchParams(query));

describe("serializeListUrlState", () => {
  it("모두 기본값이면 빈 문자열이다", () => {
    expect(serializeListUrlState(DEFAULT_LIST_URL_STATE)).toBe("");
  });

  it("기본값이 아닌 값만 적는다", () => {
    expect(
      serializeListUrlState({
        ...DEFAULT_LIST_URL_STATE,
        sort: { column: "name", direction: "asc" },
        source: ["agent_export"],
      }),
    ).toBe("sort=name.asc&source=agent_export");
  });

  it("출처를 여러 개 고르면 쉼표로 이어 적는다", () => {
    expect(
      serializeListUrlState({
        ...DEFAULT_LIST_URL_STATE,
        source: ["agent_link", "standalone"],
      }),
    ).toBe("source=agent_link,standalone");
  });

  it("관계 보기는 view 로 적고 목록 보기는 적지 않는다", () => {
    expect(
      serializeListUrlState({ ...DEFAULT_LIST_URL_STATE, view: "lineage" }),
    ).toBe("view=lineage");
    expect(
      serializeListUrlState({ ...DEFAULT_LIST_URL_STATE, view: "list" }),
    ).toBe("");
  });

  it("페이지는 그 블록까지의 커서와 함께 적는다", () => {
    const query = serializeListUrlState({
      ...DEFAULT_LIST_URL_STATE,
      order: "asc",
      pageIndex: 11,
      cursors: ["c1", "c2", "c3"],
    });
    expect(query).toBe("order=asc&page=12&cursor=c1&cursor=c2");
  });

  it("첫 블록 안 페이지는 커서 없이 적는다", () => {
    expect(
      serializeListUrlState({
        ...DEFAULT_LIST_URL_STATE,
        pageIndex: 3,
        cursors: ["c1"],
      }),
    ).toBe("page=4");
  });

  it("커서가 모자라면 페이지를 적지 않는다", () => {
    expect(
      serializeListUrlState({ ...DEFAULT_LIST_URL_STATE, pageIndex: 6 }),
    ).toBe("");
  });
});

describe("parseListUrlState", () => {
  it("빈 query 는 기본값이다", () => {
    expect(parse("")).toEqual(DEFAULT_LIST_URL_STATE);
  });

  it("모르는 view 는 목록 보기다", () => {
    expect(parse("view=graph").view).toBe("list");
  });

  it("직렬화한 값을 그대로 되읽는다", () => {
    const state: ListUrlState = {
      view: "lineage",
      order: "asc",
      sort: { column: "lastResult", direction: "desc" },
      source: ["agent_link", "standalone"],
      pageIndex: 7,
      cursors: ["a/b+c=="],
    };
    expect(parse(serializeListUrlState(state))).toEqual(state);
  });

  it("모르는 값은 기본값으로 둔다", () => {
    expect(parse("order=up&sort=zzz&source=nope&default=yes&page=abc")).toEqual(
      DEFAULT_LIST_URL_STATE,
    );
  });

  it("출처 필터는 쉼표 목록과 값 하나짜리 옛 주소를 모두 읽는다", () => {
    expect(parse("source=agent_link,standalone").source).toEqual([
      "agent_link",
      "standalone",
    ]);
    expect(parse("source=agent_link%2Cstandalone").source).toEqual([
      "agent_link",
      "standalone",
    ]);
    expect(parse("source=agent_link").source).toEqual(["agent_link"]);
    expect(parse("source=all").source).toEqual([]);
  });

  it("출처 필터 왕복 결과는 순서·중복과 무관하게 같은 주소다", () => {
    const state = parse("source=standalone,agent_link,standalone,nope");
    expect(serializeListUrlState(state)).toBe("source=agent_link,standalone");
    expect(parse(serializeListUrlState(state))).toEqual(state);
  });

  it("정렬은 열과 방향을 모두 검사한다", () => {
    expect(parse("sort=source.asc").sort).toBeNull();
    expect(parse("sort=name.up").sort).toBeNull();
    expect(parse("sort=name").sort).toBeNull();
    expect(parse("sort=jobs.desc").sort).toEqual({
      column: "jobs",
      direction: "desc",
    });
  });

  it("커서 수가 페이지 블록과 맞지 않으면 1 페이지로 되돌린다", () => {
    expect(parse("page=9")).toMatchObject({ pageIndex: 0, cursors: [] });
    expect(parse("page=3&cursor=c1")).toMatchObject({
      pageIndex: 0,
      cursors: [],
    });
    expect(parse("page=12&cursor=c1")).toMatchObject({
      pageIndex: 0,
      cursors: [],
    });
    expect(parse("page=6&cursor=")).toMatchObject({
      pageIndex: 0,
      cursors: [],
    });
  });

  it("커서가 맞으면 페이지를 복원한다", () => {
    expect(parse("page=6&cursor=c1")).toMatchObject({
      pageIndex: 5,
      cursors: ["c1"],
    });
    expect(parse("page=3")).toMatchObject({ pageIndex: 2, cursors: [] });
  });

  it("page 는 2 이상의 정수만 받는다", () => {
    expect(parse("page=1").pageIndex).toBe(0);
    expect(parse("page=0").pageIndex).toBe(0);
    expect(parse("page=-2").pageIndex).toBe(0);
    expect(parse("page=2.5").pageIndex).toBe(0);
  });

  it("깨진 정렬·페이지는 정렬 없음·1 페이지다", () => {
    expect(parse("page=9&sort=zzz")).toEqual(DEFAULT_LIST_URL_STATE);
  });
});

describe("normalizeListSearch", () => {
  it("앞의 ? 를 받고 모르는 값을 버린다", () => {
    expect(
      normalizeListSearch("?source=file_upload&default=only&foo=bar&sort=x"),
    ).toBe("source=file_upload");
    expect(normalizeListSearch("")).toBe("");
  });

  it("저장해 둔 옛 값(출처 하나)과 새 값(여러 개)을 모두 이어 읽는다", () => {
    expect(normalizeListSearch("?source=agent_link&page=1")).toBe(
      "source=agent_link",
    );
    expect(normalizeListSearch("source=standalone,agent_export")).toBe(
      "source=agent_export,standalone",
    );
    expect(normalizeListSearch("source=all")).toBe("");
  });
});
