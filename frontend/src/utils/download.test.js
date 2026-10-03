import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveBlob } from "./download.js";
import { stubObjectUrls, unstubObjectUrls } from "../test/helpers.js";

let clicked;

beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    clicked.push({ href: this.href, download: this.download, isConnected: this.isConnected });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  unstubObjectUrls();
});

describe("saveBlob", () => {
  it("M6-dl-01: clicks a temporary link to the blob's object URL, then removes it", () => {
    const urls = stubObjectUrls();
    const blob = new Blob(["id\r\n"], { type: "text/csv" });

    saveBlob(blob, "detecto-history-x.csv");

    expect(urls.create).toHaveBeenCalledTimes(1);
    expect(urls.create).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: "blob:mock/1", download: "detecto-history-x.csv", isConnected: true }]);
    expect(document.querySelectorAll("a[download]").length).toBe(0);
  });

  it("M6-dl-02: the object URL is revoked on a later tick, once per save", () => {
    vi.useFakeTimers();
    const urls = stubObjectUrls();

    saveBlob(new Blob(["a"]), "a.csv");
    expect(urls.revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(urls.revoke).toHaveBeenCalledTimes(1);
    expect(urls.revoke).toHaveBeenCalledWith("blob:mock/1");

    saveBlob(new Blob(["b"]), "b.csv");
    vi.runAllTimers();
    expect(urls.revoke.mock.calls).toEqual([["blob:mock/1"], ["blob:mock/2"]]);
  });
});
