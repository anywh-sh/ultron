import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { DownloadToasts } from "@/components/files/DownloadToasts";
import { finishBatchDownload, notifyFileDownloaded, startBatchDownload, tickBatchDownload } from "@/lib/downloadNotifications";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  // Flushes every notification's auto-dismiss timer so one test's toast
  // never lingers into the next.
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("DownloadToasts", () => {
  it("renders nothing with no active download", () => {
    render(<DownloadToasts />);
    expect(document.body.querySelector(".fixed.bottom-4")).toBeNull();
  });

  it("shows the live count for a batch, then the done count once it finishes", () => {
    render(<DownloadToasts />);

    let id = "";
    act(() => {
      id = startBatchDownload(3);
    });
    expect(screen.getByText("Baixando 0/3 arquivos")).toBeInTheDocument();

    act(() => tickBatchDownload(id, 1));
    expect(screen.getByText("Baixando 1/3 arquivos")).toBeInTheDocument();

    act(() => {
      tickBatchDownload(id, 3);
      finishBatchDownload(id);
    });
    expect(screen.getByText("Baixado 3/3 arquivos")).toBeInTheDocument();
  });

  it("shows the lone-file phrasing, truncated in a fixed-width toast, with the full name on hover", () => {
    render(<DownloadToasts />);

    const longName = "a-suspiciously-long-report-filename-nobody-should-actually-use.pdf";
    act(() => notifyFileDownloaded(longName));

    const toast = screen.getByText(`Arquivo ${longName} baixado`);
    expect(toast).toHaveClass("truncate");
    expect(toast.closest("div[title]")).toHaveAttribute("title", longName);
  });
});
