import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_FILTER_DEBOUNCE_MS,
  useDocumentFilterQuery,
} from "../use-document-filter-query";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentFilterQuery", () => {
  it("디바운스 시간은 300ms 다", () => {
    expect(DOCUMENT_FILTER_DEBOUNCE_MS).toBe(300);
  });

  it("입력은 바로, 목록에 적용할 값은 입력이 300ms 멎은 뒤 바뀐다", () => {
    const { result } = renderHook(() => useDocumentFilterQuery());
    act(() => result.current.setQuery("계약"));
    expect(result.current.query).toBe("계약");
    expect(result.current.debouncedQuery).toBe("");

    act(() => vi.advanceTimersByTime(299));
    expect(result.current.debouncedQuery).toBe("");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debouncedQuery).toBe("계약");
  });

  it("연속으로 입력하면 마지막 입력에서 300ms 뒤 마지막 값만 반영한다", () => {
    const { result } = renderHook(() => useDocumentFilterQuery());
    act(() => result.current.setQuery("a"));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current.setQuery("ab"));
    act(() => vi.advanceTimersByTime(200));
    // 첫 입력에서 300ms 가 지났어도 다시 입력해 기다림이 처음부터다.
    expect(result.current.debouncedQuery).toBe("");
    act(() => result.current.setQuery("abc"));
    act(() => vi.advanceTimersByTime(299));
    expect(result.current.debouncedQuery).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debouncedQuery).toBe("abc");
  });

  it("clearQuery 는 타이머를 기다리지 않고 둘 다 바로 비운다", () => {
    const { result } = renderHook(() => useDocumentFilterQuery());
    act(() => result.current.setQuery("계약"));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.debouncedQuery).toBe("계약");

    act(() => result.current.clearQuery());
    expect(result.current.query).toBe("");
    expect(result.current.debouncedQuery).toBe("");
  });

  it("clearQuery 는 기다리던 입력도 버린다", () => {
    const { result } = renderHook(() => useDocumentFilterQuery());
    act(() => result.current.setQuery("계약"));
    act(() => result.current.clearQuery());
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.query).toBe("");
    expect(result.current.debouncedQuery).toBe("");
  });

  it("빈 문자열을 직접 넣으면 지우기와 달리 300ms 를 기다린다", () => {
    const { result } = renderHook(() => useDocumentFilterQuery());
    act(() => result.current.setQuery("계약"));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.setQuery(""));
    expect(result.current.query).toBe("");
    expect(result.current.debouncedQuery).toBe("계약");
    act(() => vi.advanceTimersByTime(299));
    expect(result.current.debouncedQuery).toBe("계약");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debouncedQuery).toBe("");
  });

  it("언마운트하면 기다리던 타이머를 정리한다", () => {
    const { result, unmount } = renderHook(() => useDocumentFilterQuery());
    act(() => result.current.setQuery("계약"));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
