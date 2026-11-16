import { describe, expect, it } from "vitest";

import { assertSameOrigin, rejectCrossSite } from "../same-origin";

function post(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/x", {
    method: "POST",
    headers,
  });
}

function get(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/x", { headers });
}

describe("assertSameOrigin", () => {
  it("Origin·Sec-Fetch-Site 가 없으면 허용한다", () => {
    expect(assertSameOrigin(post({ host: "localhost:3000" }))).toBeNull();
  });

  it("Origin 의 host 가 Host 와 같으면 허용한다", () => {
    const req = post({
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
    });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("Sec-Fetch-Site 가 same-origin 이면 Origin 과 Host 가 달라도 허용한다(프록시 뒤)", () => {
    const req = post({
      host: "127.0.0.1:3000",
      origin: "https://review.example.test",
      "sec-fetch-site": "same-origin",
    });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("Sec-Fetch-Site 가 none 이면 허용한다", () => {
    const req = post({ host: "localhost:3000", "sec-fetch-site": "none" });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("Sec-Fetch-Site 가 없고 Origin 의 host 가 다르면 403", async () => {
    const res = assertSameOrigin(
      post({ host: "localhost:3000", origin: "https://evil.test" }),
    );
    expect(res?.status).toBe(403);
    expect((await res!.json()).error.code).toBe("forbidden");
  });

  it("Sec-Fetch-Site 가 없고 Origin 의 host 가 같으면 허용한다", () => {
    const req = post({
      host: "localhost:3000",
      origin: "http://localhost:3000",
    });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("Sec-Fetch-Site 가 cross-site 면 403", () => {
    const res = assertSameOrigin(
      post({ host: "localhost:3000", "sec-fetch-site": "cross-site" }),
    );
    expect(res?.status).toBe(403);
  });

  it("Sec-Fetch-Site 가 same-site 면 Origin 이 같아도 403", () => {
    const res = assertSameOrigin(
      post({
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-site",
      }),
    );
    expect(res?.status).toBe(403);
  });

  it("Origin 이 null 같은 잘못된 값이면 403", () => {
    const res = assertSameOrigin(
      post({ host: "localhost:3000", origin: "null" }),
    );
    expect(res?.status).toBe(403);
  });
});

describe("rejectCrossSite", () => {
  it("Sec-Fetch-Site 가 cross-site 면 403", async () => {
    const res = rejectCrossSite(get({ "sec-fetch-site": "cross-site" }));
    expect(res?.status).toBe(403);
    expect((await res!.json()).error.code).toBe("forbidden");
  });

  it("Sec-Fetch-Site 가 same-site 면 403", () => {
    expect(
      rejectCrossSite(get({ "sec-fetch-site": "same-site" }))?.status,
    ).toBe(403);
  });

  it("same-origin·none·헤더 없음은 허용한다", () => {
    expect(
      rejectCrossSite(get({ "sec-fetch-site": "same-origin" })),
    ).toBeNull();
    expect(rejectCrossSite(get({ "sec-fetch-site": "none" }))).toBeNull();
    expect(rejectCrossSite(get({}))).toBeNull();
  });
});
