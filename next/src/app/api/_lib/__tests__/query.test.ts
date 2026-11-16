import { describe, expect, it } from "vitest";

import { pickQuery } from "../query";

const SPEC = {
  kind: { enum: ["documents", "table"] },
  flag: { bool: true },
  limit: { int: { min: 1, max: 100 } },
  q: { length: { min: 2, max: 5 } },
  after: { cursor: true },
  id: { pattern: /^[\w-]{1,8}$/ },
} as const;

const pick = (query: string) => pickQuery(new URLSearchParams(query), SPEC);

async function errorOf(query: string) {
  const result = pick(query);
  expect(result.error).toBeDefined();
  const res = result.error!;
  expect(res.status).toBe(400);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  return (await res.json()).error as { code: string; param: string };
}

describe("pickQuery", () => {
  it("허용한 값만 타입에 맞게 돌려준다", () => {
    expect(
      pick("kind=table&flag=false&limit=20&q=ab&after=c_1%3D&id=x-1").values,
    ).toEqual({
      kind: "table",
      flag: false,
      limit: 20,
      q: "ab",
      after: "c_1=",
      id: "x-1",
    });
  });

  it("화이트리스트 밖 이름은 무시한다", () => {
    expect(pick("kind=documents&apply=manual&project_id=p").values).toEqual({
      kind: "documents",
    });
  });

  it("빈 값은 보내지 않은 것으로 본다", () => {
    expect(pick("q=&limit=").values).toEqual({});
  });

  it("같은 이름이 반복되면 첫 값을 쓴다", () => {
    expect(pick("limit=5&limit=500").values).toEqual({ limit: 5 });
  });

  it.each([
    ["kind=other", "kind"],
    ["flag=1", "flag"],
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["limit=2.5", "limit"],
    ["limit=-1", "limit"],
    ["limit=1e2", "limit"],
    ["q=a", "q"],
    ["q=abcdef", "q"],
    ["after=a%20b", "after"],
    ["after=a%0Ab", "after"],
    [`after=${"x".repeat(4097)}`, "after"],
    ["id=a.b", "id"],
  ])("%s → 400 invalid_value", async (query, param) => {
    expect(await errorOf(query)).toMatchObject({
      code: "invalid_value",
      param,
    });
  });

  it("서명 토큰 형태의 긴 커서도 받는다", () => {
    const cursor = `eyJ${"a".repeat(1000)}.sig-_`;
    expect(pick(`after=${cursor}`).values).toEqual({ after: cursor });
  });

  it("q 길이는 코드 포인트로 센다", () => {
    expect(pick(`q=${encodeURIComponent("😀😀")}`).values).toEqual({
      q: "😀😀",
    });
    expect(pick(`q=${encodeURIComponent("가나다라마")}`).values).toEqual({
      q: "가나다라마",
    });
  });
});
