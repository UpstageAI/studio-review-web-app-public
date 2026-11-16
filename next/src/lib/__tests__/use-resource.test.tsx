import { act, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it } from "vitest";
import { type ResourceState, useResource } from "@/lib/use-resource";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Call {
  key: string;
  signal: AbortSignal;
  request: Deferred<string>;
}

/** 요청마다 따로 끝낼 수 있는 fetcher 와 그 호출 기록. */
function fakeFetcher() {
  const calls: Call[] = [];
  const fetcherFor = (key: string) => (signal: AbortSignal) => {
    const request = deferred<string>();
    calls.push({ key, signal, request });
    return request.promise;
  };
  return { calls, fetcherFor };
}

type Commit = { key: string } & (
  | { phase: "loading" }
  | { phase: "ready"; data: string }
  | { phase: "error"; error: unknown }
);

let latest: (ResourceState<string> & { retry(): void }) | null = null;

/** 커밋된 화면만 기록한다(렌더 중 버려진 렌더는 남지 않는다). */
function Probe({
  resourceKey,
  fetcher,
  commits,
}: {
  resourceKey: string;
  fetcher: (signal: AbortSignal) => Promise<string>;
  commits: Commit[];
}) {
  const state = useResource(resourceKey, fetcher);
  useLayoutEffect(() => {
    latest = state;
    if (state.phase === "ready") {
      commits.push({ key: resourceKey, phase: "ready", data: state.data });
    } else if (state.phase === "error") {
      commits.push({ key: resourceKey, phase: "error", error: state.error });
    } else {
      commits.push({ key: resourceKey, phase: "loading" });
    }
  });
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

describe("useResource", () => {
  it("loading 으로 시작해 응답이 오면 ready", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    expect(commits).toEqual([{ key: "a", phase: "loading" }]);
    expect(calls).toHaveLength(1);

    calls[0].request.resolve("A");
    await flush();
    expect(commits.at(-1)).toEqual({ key: "a", phase: "ready", data: "A" });
  });

  it("실패하면 error 와 그 오류", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    const failure = new Error("boom");
    calls[0].request.reject(failure);
    await flush();
    expect(commits.at(-1)).toEqual({
      key: "a",
      phase: "error",
      error: failure,
    });
  });

  it("키가 바뀌면 같은 커밋에서 loading — 이전 data 가 새 키와 함께 그려지지 않는다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    const { rerender } = render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    calls[0].request.resolve("A");
    await flush();

    rerender(
      <Probe resourceKey="b" fetcher={fetcherFor("b")} commits={commits} />,
    );
    expect(commits.filter(c => c.key === "b")).toEqual([
      { key: "b", phase: "loading" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].key).toBe("b");

    calls[1].request.resolve("B");
    await flush();
    expect(commits.at(-1)).toEqual({ key: "b", phase: "ready", data: "B" });
  });

  it("키가 바뀐 뒤 늦게 온 이전 응답·실패는 버린다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    const { rerender } = render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    rerender(
      <Probe resourceKey="b" fetcher={fetcherFor("b")} commits={commits} />,
    );
    calls[0].request.resolve("A");
    await flush();
    expect(commits.at(-1)).toEqual({ key: "b", phase: "loading" });

    calls[1].request.resolve("B");
    await flush();
    rerender(
      <Probe resourceKey="c" fetcher={fetcherFor("c")} commits={commits} />,
    );
    calls[1].request.reject(new Error("late"));
    await flush();
    expect(commits.at(-1)).toEqual({ key: "c", phase: "loading" });
    expect(commits.some(c => c.phase === "ready" && c.data === "A")).toBe(
      false,
    );
  });

  it("retry() 는 같은 커밋에서 loading 으로 돌아가 다시 요청한다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    calls[0].request.reject(new Error("boom"));
    await flush();
    expect(commits.at(-1)?.phase).toBe("error");

    const before = commits.length;
    act(() => latest!.retry());
    expect(commits.slice(before)).toEqual([{ key: "a", phase: "loading" }]);
    expect(calls).toHaveLength(2);

    calls[1].request.resolve("A2");
    await flush();
    expect(commits.at(-1)).toEqual({ key: "a", phase: "ready", data: "A2" });

    // ready 에서 부른 retry 도 다음 커밋이 바로 loading 이다.
    const readyCount = commits.length;
    act(() => latest!.retry());
    expect(commits.slice(readyCount)).toEqual([{ key: "a", phase: "loading" }]);
    expect(calls).toHaveLength(3);
    expect(calls[1].signal.aborted).toBe(true);
  });

  it("retry 는 렌더 사이에 같은 함수다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const { rerender } = render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={[]} />,
    );
    const first = latest!.retry;
    calls[0].request.resolve("A");
    await flush();
    rerender(<Probe resourceKey="a" fetcher={fetcherFor("a")} commits={[]} />);
    expect(latest!.retry).toBe(first);
  });

  it("언마운트하면 요청을 취소하고 늦은 응답을 버린다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    const { unmount } = render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].request.resolve("A");
    await flush();
    expect(commits).toEqual([{ key: "a", phase: "loading" }]);
  });

  it("취소로 인한 reject(AbortError)는 error 가 되지 않는다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    render(
      <Probe resourceKey="a" fetcher={fetcherFor("a")} commits={commits} />,
    );
    calls[0].request.reject(abortError());
    await flush();
    expect(commits).toEqual([{ key: "a", phase: "loading" }]);
  });

  it("fetcher 정체성이 바뀌어도 다시 요청하지 않고, 다음 요청에는 최신 fetcher 를 쓴다", async () => {
    const { calls, fetcherFor } = fakeFetcher();
    const commits: Commit[] = [];
    const { rerender } = render(
      <Probe resourceKey="a" fetcher={fetcherFor("first")} commits={commits} />,
    );
    rerender(
      <Probe
        resourceKey="a"
        fetcher={fetcherFor("second")}
        commits={commits}
      />,
    );
    expect(calls.map(c => c.key)).toEqual(["first"]);
    calls[0].request.resolve("A");
    await flush();

    act(() => latest!.retry());
    expect(calls.map(c => c.key)).toEqual(["first", "second"]);
  });
});
