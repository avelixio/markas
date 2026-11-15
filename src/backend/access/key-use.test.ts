// @vitest-environment node

import { describe, expect, it } from "vitest";
import { covers, type Grant, judgeKeyUse, judgeTool, type KeyUse } from "./policy";

const key: KeyUse = {
  id: "key-1",
  name: "work-login",
  origin: "https://app.example.com",
  askEveryTime: false,
};

describe("access policy for saved keys", () => {
  it("asks below full access, and says which key and which site", () => {
    for (const level of ["ask", "read"] as const) {
      expect(judgeKeyUse(level, key)).toEqual({
        decision: "ask",
        kind: "tool",
        detail: 'Sign in to https://app.example.com with the key "work-login"',
        grant: { type: "key", id: "key-1", origin: "https://app.example.com" },
      });
    }
    expect(judgeKeyUse("full", key)).toEqual({ decision: "allow" });
  });

  it("asks every time for a key marked so, at every level, and offers no chat-long yes", () => {
    for (const level of ["ask", "read", "full"] as const) {
      const verdict = judgeKeyUse(level, { ...key, askEveryTime: true });
      expect(verdict).toMatchObject({ decision: "ask", grant: null });
      expect(covers([{ type: "key", id: key.id, origin: key.origin }], verdict)).toBe(false);
    }
  });

  it("lets a yes for the chat cover that key on that site and nothing else", () => {
    const grants: Grant[] = [{ type: "key", id: "key-1", origin: "https://app.example.com" }];
    expect(covers(grants, judgeKeyUse("ask", key))).toBe(true);
    expect(covers(grants, judgeKeyUse("ask", { ...key, id: "key-2" }))).toBe(false);
    // The same key moved to a sibling host is a new question.
    expect(
      covers(grants, judgeKeyUse("ask", { ...key, origin: "https://login.example.com" })),
    ).toBe(false);
    expect(covers([], judgeKeyUse("ask", key))).toBe(false);
  });

  it("keeps a key's yes apart from yeses for tools and folders, in both directions", () => {
    const keyGrant: Grant[] = [{ type: "key", id: "key-1", origin: "https://app.example.com" }];
    const scope = { level: "ask" as const, cwd: "/bots/atlas", ownRoots: [], protectedRoots: [] };
    expect(covers(keyGrant, judgeTool(scope, "WebFetch", { url: "https://example.com" }))).toBe(
      false,
    );
    expect(covers(keyGrant, judgeTool(scope, "Write", { file_path: "/projects/a.txt" }))).toBe(
      false,
    );
    expect(covers([{ type: "tool", name: "work-login" }], judgeKeyUse("ask", key))).toBe(false);
    expect(covers([{ type: "folder", kind: "write", root: "/" }], judgeKeyUse("read", key))).toBe(
      false,
    );
  });
});
