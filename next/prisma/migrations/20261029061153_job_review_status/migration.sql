-- CreateEnum
CREATE TYPE "JobReviewState" AS ENUM ('IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "job_review_status" (
    "collection_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "state" "JobReviewState" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_review_status_pkey" PRIMARY KEY ("collection_id","job_id")
);

-- CreateIndex
CREATE INDEX "job_review_status_collection_id_state_idx" ON "job_review_status"("collection_id", "state");
