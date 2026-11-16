import { describe, expect, it } from "vitest";
import { securityHeaderRoutes } from "../security-headers";

describe("securityHeaderRoutes", () => {
  const routes = securityHeaderRoutes();
  const keysOf = (source: string) =>
    routes.find(r => r.source === source)?.headers.map(h => h.key);

  it("모든 경로에 CSP·nosniff·Referrer-Policy 를 붙이고 프레이밍은 막지 않는다", () => {
    expect(keysOf("/:path*")).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
    ]);
    for (const route of routes) {
      for (const header of route.headers) {
        expect(header.key).not.toBe("X-Frame-Options");
        expect(header.value).not.toContain("frame-ancestors");
      }
    }
  });

  it("/api 는 전역 CSP 뒤에 와서 default-src 'none' 으로 덮어쓴다", () => {
    const sources = routes.map(r => r.source);
    expect(sources.indexOf("/api/:path*")).toBeGreaterThan(
      sources.indexOf("/:path*"),
    );
    const csp = routes
      .find(r => r.source === "/api/:path*")
      ?.headers.find(h => h.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("default-src 'none'");
  });

  it("어떤 CSP 도 리소스 로드를 제한하지 않는다(페이지 쪽)", () => {
    const pageCsp = routes
      .find(r => r.source === "/:path*")
      ?.headers.find(h => h.key === "Content-Security-Policy")?.value;
    for (const directive of [
      "default-src",
      "script-src",
      "img-src",
      "style-src",
      "connect-src",
      "font-src",
      "upgrade-insecure-requests",
    ]) {
      expect(pageCsp).not.toContain(directive);
    }
    for (const route of routes) {
      for (const header of route.headers) {
        for (const directive of [
          "script-src",
          "img-src",
          "style-src",
          "connect-src",
          "upgrade-insecure-requests",
        ]) {
          expect(header.value).not.toContain(directive);
        }
      }
    }
  });
});
