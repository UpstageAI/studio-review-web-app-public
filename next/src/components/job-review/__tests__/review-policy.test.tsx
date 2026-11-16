import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { memo, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REVIEW_FEATURES_KEY,
  useReviewFeatures,
} from "@/lib/review-policy/review-features";
import { REVIEW_STEPS_KEY } from "@/lib/review-policy/review-steps";
import { ReviewPolicyProvider } from "../review-policy";
import { useReviewPolicy } from "../review-policy-context";

afterEach(() => {
  localStorage.clear();
});

/** `PolicyProbe` 가 그려진(commit 된) 기록. */
const commits: string[] = [];

/** provider 아래에서 정책 값을 글로 보인다. */
function PolicyProbe() {
  const { features, steps } = useReviewPolicy();
  useEffect(() => {
    commits.push("policy");
  });
  return (
    <p data-testid="policy">
      {`organizer=${features.organizer} filmstrip=${features.filmstrip} parse=${steps.parse}`}
    </p>
  );
}

/** provider 밖에서 store 훅을 직접 쓰는 곳(설정 메뉴 역할). */
function OutsideMenu() {
  const [, setFeature] = useReviewFeatures();
  return (
    <button
      type="button"
      data-testid="outside-organizer-on"
      onClick={() => setFeature("organizer", true)}
    />
  );
}

function renderScreen() {
  return render(
    <>
      <OutsideMenu />
      <ReviewPolicyProvider>
        <PolicyProbe />
      </ReviewPolicyProvider>
    </>,
  );
}

// props 가 없어 부모 렌더로는 다시 그리지 않고, Context 값이 바뀔 때만 다시 그린다.
const MemoProbe = memo(PolicyProbe);

const text = () => screen.getByTestId("policy").textContent;

describe("ReviewPolicyProvider", () => {
  it("저장소 초기값을 읽어 내린다", () => {
    localStorage.setItem(REVIEW_FEATURES_KEY, '{"organizer":true}');
    localStorage.setItem(REVIEW_STEPS_KEY, '{"parse":true}');
    renderScreen();
    expect(text()).toBe("organizer=true filmstrip=true parse=true");
  });

  it("provider 밖의 store setter 로 바꾸면 provider 아래가 바로 다시 그려진다", () => {
    renderScreen();
    expect(text()).toBe("organizer=false filmstrip=true parse=false");
    fireEvent.click(screen.getByTestId("outside-organizer-on"));
    expect(text()).toBe("organizer=true filmstrip=true parse=false");
  });

  it("setFeature 는 store 훅의 setter 와 같은 글을 저장소에 쓴다", () => {
    const direct = renderHook(() => useReviewFeatures());
    act(() => direct.result.current[1]("jsonMenu", true));
    const expected = localStorage.getItem(REVIEW_FEATURES_KEY);
    direct.unmount();
    localStorage.clear();

    const viaPolicy = renderHook(() => useReviewPolicy(), {
      wrapper: ReviewPolicyProvider,
    });
    act(() => viaPolicy.result.current.setFeature("jsonMenu", true));
    expect(localStorage.getItem(REVIEW_FEATURES_KEY)).toBe(expected);
    expect(viaPolicy.result.current.features.jsonMenu).toBe(true);
  });

  it("다른 탭의 storage 이벤트로도 갱신된다", () => {
    renderScreen();
    act(() => {
      localStorage.setItem(REVIEW_FEATURES_KEY, '{"filmstrip":false}');
      localStorage.setItem(REVIEW_STEPS_KEY, '{"parse":true}');
      window.dispatchEvent(
        new StorageEvent("storage", { key: REVIEW_FEATURES_KEY }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: REVIEW_STEPS_KEY }),
      );
    });
    expect(text()).toBe("organizer=false filmstrip=false parse=true");
  });

  it("부모가 다시 그려져도 정책이 같으면 소비자는 따라 그리지 않는다", () => {
    function Parent({ tick }: { tick: number }) {
      return (
        <div data-tick={tick}>
          <ReviewPolicyProvider>
            <MemoProbe />
          </ReviewPolicyProvider>
        </div>
      );
    }
    const view = render(<Parent tick={0} />);
    const before = commits.length;
    view.rerender(<Parent tick={1} />);
    expect(commits.length).toBe(before);
  });

  it("provider 밖에서 쓰면 알리고 throw 한다", () => {
    expect(() => renderHook(() => useReviewPolicy())).toThrow(
      "ReviewPolicyProvider",
    );
  });
});
