import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaveConfirmDialog } from "@/components/leave-confirm-dialog";
import {
  getLeaveConfirmRequest,
  requestLeaveConfirm,
} from "@/lib/leave-confirm";
import { renderWithIntl } from "@/test/render";

describe("LeaveConfirmDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 답을 기다리는 Promise 를 그대로 돌려준다(async 함수로 감싸면 답할 때까지 풀리지 않는다).
  const ask = (
    message: string,
    options?: Parameters<typeof requestLeaveConfirm>[1],
  ): Promise<boolean> => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = requestLeaveConfirm(message, options);
    });
    return answer;
  };

  it("요청이 없으면 아무것도 그리지 않는다", () => {
    renderWithIntl(<LeaveConfirmDialog />);
    expect(screen.queryByTestId("leave-confirm-dialog")).toBeNull();
  });

  it("요청 문구로 뜨고 나가기를 고르면 true 로 답한 뒤 닫힌다", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderWithIntl(<LeaveConfirmDialog />);
    const answer = ask("저장하지 않은 변경이 있습니다.");
    expect(confirm).not.toHaveBeenCalled();
    const dialog = screen.getByTestId("leave-confirm-dialog");
    expect(dialog).toHaveTextContent("이 화면을 떠날까요?");
    expect(dialog).toHaveTextContent("저장하지 않은 변경이 있습니다.");
    expect(screen.getByTestId("leave-confirm-button-stay")).toHaveFocus();
    await act(async () => {
      fireEvent.click(screen.getByTestId("leave-confirm-button-leave"));
    });
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByTestId("leave-confirm-dialog")).toBeNull();
    expect(getLeaveConfirmRequest()).toBeNull();
  });

  it("머무르기는 false 로 답한다", async () => {
    renderWithIntl(<LeaveConfirmDialog />);
    const answer = ask("leave?");
    await act(async () => {
      fireEvent.click(screen.getByTestId("leave-confirm-button-stay"));
    });
    await expect(answer).resolves.toBe(false);
    expect(screen.queryByTestId("leave-confirm-dialog")).toBeNull();
  });

  it("Esc 는 머무르기와 같다", async () => {
    renderWithIntl(<LeaveConfirmDialog />);
    const answer = ask("leave?");
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId("leave-confirm-dialog"), {
        key: "Escape",
      });
    });
    await expect(answer).resolves.toBe(false);
    expect(getLeaveConfirmRequest()).toBeNull();
  });

  it("제목·확인 버튼 문구를 바꿀 수 있다", async () => {
    renderWithIntl(<LeaveConfirmDialog />);
    const answer = ask("reload?", {
      title: "다시 불러올까요?",
      confirmLabel: "다시 불러오기",
    });
    expect(screen.getByTestId("leave-confirm-dialog")).toHaveTextContent(
      "다시 불러올까요?",
    );
    expect(screen.getByTestId("leave-confirm-button-leave")).toHaveTextContent(
      "다시 불러오기",
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("leave-confirm-button-leave"));
    });
    await expect(answer).resolves.toBe(true);
  });

  it("언마운트하면 남은 요청은 false 로 닫히고 다음 요청은 기본 확인 창으로 간다", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = renderWithIntl(<LeaveConfirmDialog />);
    const answer = ask("leave?");
    unmount();
    await expect(answer).resolves.toBe(false);
    await expect(requestLeaveConfirm("again?")).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith("again?");
  });
});
