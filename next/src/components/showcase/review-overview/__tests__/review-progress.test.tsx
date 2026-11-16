import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchCollectionDetail } from "@/lib/review-api/types";
import ko from "@/messages/ko.json";
import { renderWithIntl } from "@/test/render";
import { ReviewProgress } from "../review-progress";

const getReviewProgress = vi.hoisted(() => vi.fn());

vi.mock("@/lib/review-api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/review-api/client")>()),
  getReviewProgress,
}));

const collection: SearchCollectionDetail = {
  id: "col_1",
  total_job_count: 5,
  pending_job_count: 1,
  failed_job_count: 1,
};

describe("ReviewProgress", () => {
  beforeEach(() => {
    getReviewProgress.mockReset();
    getReviewProgress.mockResolvedValue({ done: 2, in_progress: 1 });
  });

  it("explains the denominator under the bar without changing the bar values", async () => {
    renderWithIntl(
      <ReviewProgress collection={collection} collectionId="col_1" />,
    );

    const bar = await screen.findByTestId("collection-detail-progress-bar");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(
      screen.getByTestId("collection-detail-progress-basis"),
    ).toHaveTextContent(ko.collections.progress.basis);
  });

  it("hides the basis when the Job count is unknown", async () => {
    renderWithIntl(
      <ReviewProgress collection={{ id: "col_1" }} collectionId="col_1" />,
    );

    expect(await screen.findByText("검수 완료 2")).toBeInTheDocument();
    expect(
      screen.queryByTestId("collection-detail-progress-basis"),
    ).not.toBeInTheDocument();
  });
});
