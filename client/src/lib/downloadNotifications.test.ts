import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishBatchDownload,
  getDownloadNotifications,
  notifyFileDownloaded,
  startBatchDownload,
  subscribeDownloadNotifications,
  tickBatchDownload,
} from "@/lib/downloadNotifications";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Flushes every auto-dismiss timer any test below scheduled, so a
  // left-behind notification from one test can't leak into the next one's
  // `getDownloadNotifications()` read.
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("downloadNotifications", () => {
  it("starts a batch at 0/total and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDownloadNotifications(listener);

    const id = startBatchDownload(5);

    expect(getDownloadNotifications().find((entry) => entry.id === id)).toEqual({ id, total: 5, current: 0, done: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ticks the current count as files complete, without touching total or done", () => {
    const id = startBatchDownload(3);
    tickBatchDownload(id, 1);
    tickBatchDownload(id, 2);

    expect(getDownloadNotifications().find((entry) => entry.id === id)).toEqual({ id, total: 3, current: 2, done: false });
  });

  it("marks a batch done and auto-dismisses it a few seconds later", () => {
    const id = startBatchDownload(2);
    tickBatchDownload(id, 2);
    finishBatchDownload(id);

    expect(getDownloadNotifications().find((entry) => entry.id === id)?.done).toBe(true);

    vi.advanceTimersByTime(4000);
    expect(getDownloadNotifications().find((entry) => entry.id === id)).toBeUndefined();
  });

  it("reports a lone-file download already done, carrying its file name", () => {
    notifyFileDownloaded("report.pdf");

    const entry = getDownloadNotifications().find((candidate) => candidate.fileName === "report.pdf");
    expect(entry).toMatchObject({ total: 1, current: 1, done: true, fileName: "report.pdf" });

    vi.advanceTimersByTime(4000);
    expect(getDownloadNotifications().find((candidate) => candidate.fileName === "report.pdf")).toBeUndefined();
  });
});
