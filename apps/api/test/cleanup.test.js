import test from "node:test";
import assert from "node:assert/strict";
import { insideJob } from "../../worker/src/cleanup.js";

test("cleanup only ever deletes inside storage/jobs/<job id>/", () => {
  const jobs = "/data/storage/jobs";
  assert.ok(insideJob(jobs, "/data/storage/jobs/87/video-my.mp4", 87));
  assert.ok(!insideJob(jobs, "/data/storage/jobs/870/video-my.mp4", 87)); // another job
  assert.ok(!insideJob(jobs, "/data/storage/jobs/87/../88/video.mp4", 87));
  assert.ok(!insideJob(jobs, "/data/storage/uploads/5/photo.jpg", 87));
  assert.ok(!insideJob(jobs, "/data/storage/jobs/87", 87)); // the folder itself is not a file of it
  assert.ok(!insideJob(jobs, null, 87));
});
