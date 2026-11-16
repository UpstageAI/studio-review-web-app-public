import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CONSOLE_API_URL,
  allowLoopbackImageUrls,
  getUpstageEnv,
  isLoopbackHost,
} from "../env";
import { UpstageConfigError } from "../errors";

afterEach(() => {
  vi.unstubAllEnvs();
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected function to throw");
}

describe("getUpstageEnv", () => {
  it.each([undefined, "", "   "])(
    "UPSTAGE_API_KEY 가 %j 이면 UpstageConfigError",
    value => {
      vi.stubEnv("UPSTAGE_API_KEY", value);
      const err = captureError(getUpstageEnv);
      expect(err).toBeInstanceOf(UpstageConfigError);
      expect((err as UpstageConfigError).variable).toBe("UPSTAGE_API_KEY");
    },
  );

  it("키 앞뒤 공백을 제거한다", () => {
    vi.stubEnv("UPSTAGE_API_KEY", "  key-123  ");
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", undefined);
    expect(getUpstageEnv().apiKey).toBe("key-123");
  });

  it.each([undefined, ""])("URL 이 %j 이면 기본값을 쓴다", value => {
    vi.stubEnv("UPSTAGE_API_KEY", "key");
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", value);
    expect(getUpstageEnv().consoleApiUrl).toBe(DEFAULT_CONSOLE_API_URL);
  });

  it("URL 끝의 / 를 제거한다", () => {
    vi.stubEnv("UPSTAGE_API_KEY", "key");
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test/");
    expect(getUpstageEnv().consoleApiUrl).toBe("https://example.test");
  });

  it.each(["not a url", "ftp://example.test"])(
    "URL 이 %j 이면 UpstageConfigError",
    value => {
      vi.stubEnv("UPSTAGE_API_KEY", "key");
      vi.stubEnv("UPSTAGE_CONSOLE_API_URL", value);
      const err = captureError(getUpstageEnv);
      expect(err).toBeInstanceOf(UpstageConfigError);
      expect((err as UpstageConfigError).variable).toBe(
        "UPSTAGE_CONSOLE_API_URL",
      );
    },
  );

  it.each([
    "http://example.com",
    "http://10.0.0.5:4010",
    "http://127.0.0.1.example.com",
  ])("원격 http URL %j 은 UpstageConfigError", value => {
    vi.stubEnv("UPSTAGE_API_KEY", "key");
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", value);
    const err = captureError(getUpstageEnv);
    expect(err).toBeInstanceOf(UpstageConfigError);
    expect((err as UpstageConfigError).variable).toBe(
      "UPSTAGE_CONSOLE_API_URL",
    );
    expect((err as Error).message).toContain("must use https");
  });

  it.each([
    "http://127.0.0.1:4010",
    "http://localhost:4010",
    "http://[::1]:4010",
  ])("loopback http URL %j 은 허용한다", value => {
    vi.stubEnv("UPSTAGE_API_KEY", "key");
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", value);
    expect(getUpstageEnv().consoleApiUrl).toBe(value);
  });

  it.each(["https://u:p@api.example.test", "http://u@127.0.0.1:4010"])(
    "자격증명이 든 URL %j 은 UpstageConfigError",
    value => {
      vi.stubEnv("UPSTAGE_API_KEY", "key");
      vi.stubEnv("UPSTAGE_CONSOLE_API_URL", value);
      const err = captureError(getUpstageEnv);
      expect(err).toBeInstanceOf(UpstageConfigError);
      expect((err as Error).message).toContain("credentials");
    },
  );

  it("호출 시점의 값을 읽는다", () => {
    vi.stubEnv("UPSTAGE_API_KEY", "first");
    expect(getUpstageEnv().apiKey).toBe("first");
    vi.stubEnv("UPSTAGE_API_KEY", "second");
    expect(getUpstageEnv().apiKey).toBe("second");
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])("%j 는 loopback", host => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["example.com", "127.0.0.2", "::1", "localhost.example"])(
    "%j 는 loopback 이 아니다",
    host => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});

describe("allowLoopbackImageUrls", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "UPSTAGE_ALLOW_HTTP_IMAGE_URLS 가 %j 이면 false",
    value => {
      vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", value);
      expect(allowLoopbackImageUrls()).toBe(false);
    },
  );

  it.each(["1", " 1 "])(
    "UPSTAGE_ALLOW_HTTP_IMAGE_URLS 가 %j 이면 true",
    value => {
      vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", value);
      expect(allowLoopbackImageUrls()).toBe(true);
    },
  );

  it("키가 없어도 던지지 않고 호출 시점의 값을 읽는다", () => {
    vi.stubEnv("UPSTAGE_API_KEY", undefined);
    vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", "1");
    expect(allowLoopbackImageUrls()).toBe(true);
    vi.stubEnv("UPSTAGE_ALLOW_HTTP_IMAGE_URLS", "0");
    expect(allowLoopbackImageUrls()).toBe(false);
  });
});
