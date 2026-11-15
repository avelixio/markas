// @vitest-environment node

import { describe, expect, it } from "vitest";
import { covers, type Grant, judgeSite, judgeTool } from "./policy";

describe("judgeSite", () => {
  it("asks before a bot below full access uses a website", () => {
    for (const level of ["ask", "read"] as const) {
      expect(judgeSite(level, "https://shop.example.com/orders?page=2")).toEqual({
        decision: "ask",
        kind: "network",
        detail: "https://shop.example.com/orders?page=2",
        grant: { type: "site", origin: "https://shop.example.com" },
      });
    }
    expect(judgeSite("full", "https://shop.example.com/")).toEqual({ decision: "allow" });
  });

  it("lets an empty tab through, because it reaches nothing", () => {
    expect(judgeSite("ask", "about:blank")).toEqual({ decision: "allow" });
  });

  it("never offers a yes for the whole chat for something that is not a website", () => {
    for (const address of ["file:///etc/passwd", "not an address", "chrome://settings"]) {
      expect(judgeSite("ask", address)).toMatchObject({ decision: "ask", grant: null });
    }
  });

  it("remembers a yes for one exact site only", () => {
    const grants: Grant[] = [{ type: "site", origin: "https://shop.example.com" }];
    expect(covers(grants, judgeSite("ask", "https://shop.example.com/cart"))).toBe(true);
    // Not a sibling, not the parent, not another port and not plain http.
    for (const other of [
      "https://admin.example.com/",
      "https://example.com/",
      "https://shop.example.com:8443/",
      "http://shop.example.com/",
    ]) {
      expect(covers(grants, judgeSite("ask", other))).toBe(false);
    }
  });

  it("keeps a site yes apart from tool and folder permissions", () => {
    const site: Grant[] = [{ type: "site", origin: "https://shop.example.com" }];
    const scope = { level: "ask" as const, cwd: "/bots/atlas", ownRoots: [], protectedRoots: [] };
    const fetch = judgeTool(scope, "WebFetch", { url: "https://shop.example.com/" });
    expect(covers(site, fetch)).toBe(false);
    const tool: Grant[] = [{ type: "tool", name: "WebFetch" }];
    expect(covers(tool, judgeSite("ask", "https://shop.example.com/"))).toBe(false);
  });
});
