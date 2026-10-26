import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFilenameSearch } from "./filename-search-job";
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    workers.push(this);
  }
}
const options = {
  query: "shoe",
  replacement: "boot",
  regex: false,
  caseSensitive: true,
};
const images = [{ id: "1", stem: "shoe", excluded: false }];
describe("cancellable filename worker jobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    workers.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("debounces and delivers one result, then terminates its worker", () => {
    const complete = vi.fn();
    startFilenameSearch(images, options, complete);
    expect(workers).toHaveLength(0);
    vi.advanceTimersByTime(180);
    expect(workers[0].postMessage).toHaveBeenCalledWith({ images, options });
    const matches = [
      { id: "1", before: "shoe", after: "boot", excluded: false },
    ];
    workers[0].onmessage?.({ data: { matches } });
    vi.advanceTimersByTime(3000);
    expect(complete).toHaveBeenCalledExactlyOnceWith({ matches, error: "" });
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });
  it("cancels before starting a worker", () => {
    const complete = vi.fn();
    startFilenameSearch(images, options, complete)();
    vi.runAllTimers();
    expect(workers).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
  });
  it("terminates a running job and ignores its late result", () => {
    const complete = vi.fn();
    const cancel = startFilenameSearch(images, options, complete);
    vi.advanceTimersByTime(180);
    cancel();
    workers[0].onmessage?.({ data: { matches: [] } });
    vi.runAllTimers();
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it("terminates a stuck regex after the time budget", () => {
    const complete = vi.fn();
    startFilenameSearch(images, options, complete);
    vi.advanceTimersByTime(2180);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0].error).toContain("too long");
    workers[0].onmessage?.({ data: { matches: [] } });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("returns pattern errors and worker startup errors without crashing", () => {
    const complete = vi.fn();
    startFilenameSearch(images, options, complete);
    vi.advanceTimersByTime(180);
    workers[0].onmessage?.({ data: { error: "Invalid regular expression" } });
    expect(complete.mock.calls[0][0].error).toContain("Invalid");
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("blocked");
        }
      },
    );
    startFilenameSearch(images, options, complete);
    vi.advanceTimersByTime(180);
    expect(complete.mock.calls[1][0].error).toContain("Unable to start");
  });
});
