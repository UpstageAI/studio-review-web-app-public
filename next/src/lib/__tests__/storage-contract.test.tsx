import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEW_FIELDS_KEY,
  type FieldChoices,
} from "@/components/job-review/field-filter";
import { useFieldChoices } from "@/components/job-review/use-field-filter";
import {
  useRecentJobs,
  useRecordRecentJob,
} from "@/components/showcase/home/recent-jobs-store";
import {
  REVIEW_QUEUE_ADVANCE_KEY,
  useQueueAdvance,
} from "@/components/showcase/review-queue/use-review-queue";
import { RECENT_JOBS_KEY, type RecentJob } from "@/lib/recent-jobs";
import {
  REVIEW_FEATURES_KEY,
  useReviewFeatures,
  type ReviewFeatures,
} from "@/lib/review-policy/review-features";
import {
  REVIEW_STEPS_KEY,
  useReviewSteps,
  type ReviewSteps,
} from "@/lib/review-policy/review-steps";

// 큐 훅 모듈이 라우터를 import 한다(이 테스트는 "완료하면 다음 Job 열기" 설정만 본다).
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// 알림 ①(같은 탭 + `storage` 이벤트) 저장소 키 5 개의 계약: 쓰는 글자, 읽기 기본값, 같은 탭 구독자 갱신,
// 다른 탭(`storage` 이벤트) 갱신. 값은 리터럴로 고정해 키·직렬화가 바뀌면 깨지게 한다.

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

/** 저장소 키 하나를 읽고 쓰는 방법(값은 비교하기 쉬운 글로 바꿔 둔다). */
type Contract = {
  key: string;
  /** 훅이 지금 보이는 값을 글로 */
  useShown: () => string;
  /** 훅을 그려 둔 채 값을 바꾸는 함수를 얻는다 */
  useWrite: () => () => void;
  /** `useWrite` 를 빈 저장소에서 부른 뒤 저장소에 남는 글 */
  written: string;
  /** 저장소에 아무것도 없을 때 보이는 값 */
  shownDefault: string;
  /** 읽어서 기본값이 되는 저장소 글(모양이 다른 값·깨진 JSON 등) */
  invalid: readonly string[];
  /** 다른 탭이 쓴 값과 그때 보이는 값 */
  external: { text: string; shown: string };
};

const features = (value: ReviewFeatures) => JSON.stringify(value);
const steps = (value: ReviewSteps) => JSON.stringify(value);
const fields = (value: FieldChoices) => JSON.stringify(value);
const recent = (value: readonly RecentJob[]) => JSON.stringify(value);

const NOW = "2026-01-02T03:04:05.000Z";

/** 최근 연 Job 을 기록하는 쪽(검수 화면)과 보는 쪽(홈)이 다른 훅이라 하나로 묶는다. */
function useRecentWriter(): () => void {
  const [entry, setEntry] = useState<Omit<RecentJob, "openedAt"> | null>(null);
  useRecordRecentJob(entry);
  return () =>
    setEntry({
      collectionId: "col-1",
      collectionName: "모음",
      jobId: "job-1",
      jobName: null,
    });
}

const CONTRACTS: readonly Contract[] = [
  {
    key: REVIEW_FEATURES_KEY,
    useShown: () => features(useReviewFeatures()[0]),
    useWrite: () => {
      const [, setFeature] = useReviewFeatures();
      return () => setFeature("organizer", true);
    },
    written:
      '{"pageTools":false,"filmstrip":true,"organizer":true,"jsonMenu":false,"history":false}',
    shownDefault:
      '{"pageTools":false,"filmstrip":true,"organizer":false,"jsonMenu":false,"history":false}',
    invalid: ["", "{", "[]", "null", "true", '"x"', '{"filmstrip":"no"}'],
    external: {
      text: '{"history":true,"filmstrip":false}',
      shown:
        '{"pageTools":false,"filmstrip":false,"organizer":false,"jsonMenu":false,"history":true}',
    },
  },
  {
    key: REVIEW_STEPS_KEY,
    useShown: () => steps(useReviewSteps()[0]),
    useWrite: () => {
      const [, setStep] = useReviewSteps();
      return () => setStep("parse", true);
    },
    written:
      '{"parse":true,"classify":true,"split":true,"extract":true,"validate":true,"match":true,"merge":true,"instruct":false,"export":true}',
    shownDefault:
      '{"parse":false,"classify":true,"split":true,"extract":true,"validate":true,"match":true,"merge":true,"instruct":false,"export":true}',
    invalid: ["", "{", "[]", '[{"parse":true}]', "null", '{"parse":1}'],
    external: {
      text: '{"export":false}',
      shown:
        '{"parse":false,"classify":true,"split":true,"extract":true,"validate":true,"match":true,"merge":true,"instruct":false,"export":false}',
    },
  },
  {
    key: REVIEW_FIELDS_KEY,
    useShown: () => fields(useFieldChoices()[0]),
    useWrite: () => {
      const [, setStepFields] = useFieldChoices();
      return () => setStepFields("step-1", ["b", "a"]);
    },
    written: '{"step-1":["b","a"]}',
    shownDefault: "{}",
    invalid: ["", "{", "[]", "null", "3", '{"step-1":"a"}'],
    external: {
      text: '{"s":["x","x",1,"y"]}',
      shown: '{"s":["x","y"]}',
    },
  },
  {
    key: RECENT_JOBS_KEY,
    useShown: () => recent(useRecentJobs()),
    useWrite: useRecentWriter,
    written: `[{"collectionId":"col-1","collectionName":"모음","jobId":"job-1","jobName":null,"openedAt":"${NOW}"}]`,
    shownDefault: "[]",
    invalid: ["", "{", "{}", "null", '[{"collectionId":"a b"}]'],
    external: {
      text: `[{"collectionId":"c","jobId":"j","openedAt":"${NOW}","jobName":"  "}]`,
      shown: `[{"collectionId":"c","collectionName":null,"jobId":"j","jobName":null,"openedAt":"${NOW}"}]`,
    },
  },
  {
    key: REVIEW_QUEUE_ADVANCE_KEY,
    useShown: () => String(useQueueAdvance()[0]),
    useWrite: () => {
      const [, setAdvance] = useQueueAdvance();
      return () => setAdvance(false);
    },
    written: "0",
    shownDefault: "true",
    invalid: ["", "1", "false", "true", "00"],
    external: { text: "0", shown: "false" },
  },
];

describe.each(CONTRACTS)("저장소 계약 $key", contract => {
  const { key } = contract;

  it("(a) 값을 바꾸면 저장소에 정해진 글을 그대로 쓴다", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const writer = renderHook(() => contract.useWrite());
    act(() => writer.result.current());
    expect(localStorage.getItem(key)).toBe(contract.written);
  });

  it("(b) 없는 키·모양이 다른 값·깨진 JSON 은 기본값으로 읽는다", () => {
    const empty = renderHook(() => contract.useShown());
    expect(empty.result.current).toBe(contract.shownDefault);
    empty.unmount();
    for (const text of contract.invalid) {
      localStorage.setItem(key, text);
      const view = renderHook(() => contract.useShown());
      expect(view.result.current, JSON.stringify(text)).toBe(
        contract.shownDefault,
      );
      view.unmount();
    }
  });

  it("(b) 서버 렌더는 저장소 값과 상관없이 기본값이다", () => {
    localStorage.setItem(key, contract.external.text);
    let shown = "";
    function Probe() {
      shown = contract.useShown();
      return null;
    }
    renderToString(<Probe />);
    expect(shown).toBe(contract.shownDefault);
  });

  it("(c) 같은 탭에서 바꾸면 다른 구독자가 다시 그려진다", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    const reader = renderHook(() => contract.useShown());
    const writer = renderHook(() => contract.useWrite());
    expect(reader.result.current).toBe(contract.shownDefault);
    act(() => writer.result.current());
    expect(reader.result.current).not.toBe(contract.shownDefault);
    expect(reader.result.current).toBe(
      renderHook(() => contract.useShown()).result.current,
    );
  });

  it("(d) 다른 탭의 storage 이벤트(같은 키·key null)에 다시 읽고 다른 키에는 반응하지 않는다", () => {
    let renders = 0;
    const reader = renderHook(() => {
      renders += 1;
      return contract.useShown();
    });
    expect(reader.result.current).toBe(contract.shownDefault);

    localStorage.setItem(key, contract.external.text);
    const before = renders;
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `${key}-x` }));
      window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    });
    expect(renders).toBe(before);
    expect(reader.result.current).toBe(contract.shownDefault);

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    expect(reader.result.current).toBe(contract.external.shown);

    localStorage.removeItem(key);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(reader.result.current).toBe(contract.shownDefault);
  });

  it("(d) 언마운트하면 storage 이벤트 구독을 푼다", () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const reader = renderHook(() => contract.useShown());
    const handlers = added.mock.calls
      .filter(([type]) => type === "storage")
      .map(([, handler]) => handler);
    expect(handlers.length).toBeGreaterThan(0);
    reader.unmount();
    const released = removed.mock.calls
      .filter(([type]) => type === "storage")
      .map(([, handler]) => handler);
    for (const handler of handlers) expect(released).toContain(handler);
    added.mockRestore();
    removed.mockRestore();
  });
});
