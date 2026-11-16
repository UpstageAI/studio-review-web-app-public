import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { SearchCollectionDetail } from "@/lib/review-api/types";
import ko from "@/messages/ko.json";
import { renderWithIntl } from "@/test/render";
import { CollectionSummary } from "../collection-summary";

const summary = ko.collections.summary;

const collection: SearchCollectionDetail = {
  id: "col_1",
  name: "Invoices",
  total_job_count: 5,
  latest_config_job_count: 4,
  latest_config_ids: ["cfg_1"],
};

describe("CollectionSummary", () => {
  it("shows the info button and tooltip for the total Job card", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CollectionSummary collection={collection} />);

    const card = screen.getByTestId("collection-detail-stat-totalJobs");
    expect(within(card).getByText("5")).toBeInTheDocument();
    const info = screen.getByTestId(
      "collection-detail-stat-button-info-totalJobs",
    );
    expect(info).toHaveAccessibleName(summary.totalJobsHelp);

    await user.hover(info);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      summary.totalJobsHint,
    );
  });

  it("puts an info button on the latest-config Job card but not on the config count", () => {
    renderWithIntl(<CollectionSummary collection={collection} />);

    expect(
      screen.getByTestId("collection-detail-stat-button-info-latestConfigJobs"),
    ).toHaveAccessibleName(summary.latestConfigJobsHelp);
    expect(
      screen.queryByTestId("collection-detail-stat-button-info-latestConfigs"),
    ).not.toBeInTheDocument();
  });

  it("shows visible table rows under the latest-config Job card only when given", () => {
    const { rerender } = renderWithIntl(
      <CollectionSummary collection={collection} />,
    );
    expect(
      screen.queryByTestId("collection-detail-stat-latestConfigJobs-rows"),
    ).not.toBeInTheDocument();

    rerender(
      <CollectionSummary
        collection={collection}
        visibleRows={{ count: 2, more: false }}
      />,
    );
    expect(
      screen.getByTestId("collection-detail-stat-latestConfigJobs-rows"),
    ).toHaveTextContent(summary.visibleRows.replace("{count}", "2"));

    rerender(
      <CollectionSummary
        collection={collection}
        visibleRows={{ count: 20, more: true }}
      />,
    );
    expect(
      screen.getByTestId("collection-detail-stat-latestConfigJobs-rows"),
    ).toHaveTextContent(summary.visibleRowsMore.replace("{count}", "20"));

    rerender(<CollectionSummary collection={collection} visibleRows={null} />);
    expect(
      screen.queryByTestId("collection-detail-stat-latestConfigJobs-rows"),
    ).not.toBeInTheDocument();
  });

  it("drops cards whose fields are missing", () => {
    renderWithIntl(
      <CollectionSummary
        collection={{ id: "col_2", total_job_count: 3 }}
        visibleRows={{ count: 1, more: false }}
      />,
    );

    expect(
      screen.getByTestId("collection-detail-stat-totalJobs"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("collection-detail-stat-latestConfigJobs"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("collection-detail-stat-latestConfigs"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("collection-detail-stat-latestConfigJobs-rows"),
    ).not.toBeInTheDocument();
  });
});
