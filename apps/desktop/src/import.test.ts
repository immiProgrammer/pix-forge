import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { scan } from "./bridge";
import type { Asset } from "./model";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
  convertFileSrc: (path: string) => `asset:${path}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const asset = (id: string) =>
  ({ id, originalName: `${id}.jpg`, thumbnail: `${id}.webp` }) as Asset;
let receive: (event: { payload: unknown }) => void;
const unlisten = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    receive = callback as typeof receive;
    return unlisten;
  });
});
describe("native import delivery", () => {
  it("recovers the final image from the completed batch without duplicating earlier events", async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const requestId = (args as { requestId: string }).requestId;
      const first = { requestId, asset: asset("first") };
      const last = { requestId, asset: asset("last") };
      receive({ payload: first });
      return [first, last];
    });
    const onAsset = vi.fn(),
      settled = vi.fn();
    await scan(["first.jpg", "last.jpg"], onAsset, vi.fn(), settled);
    expect(onAsset.mock.calls.map(([asset]) => asset.id)).toEqual([
      "first",
      "last",
    ]);
    expect(onAsset.mock.calls[1][0].thumbnail).toBe("asset:last.webp");
    expect(settled).toHaveBeenCalledTimes(2);
    expect(unlisten).toHaveBeenCalledOnce();
  });
  it("recovers a single image even if its event has not reached the UI", async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => [
      {
        requestId: (args as { requestId: string }).requestId,
        asset: asset("only"),
      },
    ]);
    const onAsset = vi.fn();
    await scan(["only.jpg"], onAsset, vi.fn());
    expect(onAsset.mock.calls[0][0].id).toBe("only");
  });
  it("reports unreadable files once and ignores other concurrent scans", async () => {
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const requestId = (args as { requestId: string }).requestId;
      const issue = { requestId, issue: "bad.jpg: unreadable" };
      receive({
        payload: { requestId: "another-request", asset: asset("unrelated") },
      });
      receive({ payload: issue });
      return [issue];
    });
    const onAsset = vi.fn(),
      onIssue = vi.fn(),
      settled = vi.fn();
    await scan(["bad.jpg"], onAsset, onIssue, settled);
    expect(onAsset).not.toHaveBeenCalled();
    expect(onIssue).toHaveBeenCalledExactlyOnceWith("bad.jpg: unreadable");
    expect(settled).toHaveBeenCalledOnce();
  });
  it("removes the listener if the native scan fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Scan failed"));
    await expect(scan(["image.jpg"], vi.fn(), vi.fn())).rejects.toThrow(
      "Scan failed",
    );
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
