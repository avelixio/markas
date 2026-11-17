// @vitest-environment node

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { judgedCalls, permissionRules, sessionSettings } from "./rules";

describe("the rules an OpenCode session runs under", () => {
  it("ask about everything below full access, with Markas's own tools let through", () => {
    for (const level of ["ask", "read"] as const) {
      const rules = permissionRules(level);
      expect(rules["*"]).toBe("ask");
      for (const name of ["read", "edit", "bash", "external_directory", "webfetch", "skill"]) {
        expect(rules[name]).toBe("ask");
      }
      expect(rules["markas_*"]).toBe("allow");
    }
  });

  it("switch off what OpenCode cannot ask about over this connection", () => {
    for (const level of ["ask", "read", "full"] as const) {
      expect(permissionRules(level).question).toBe("deny");
    }
    expect(permissionRules("ask").task).toBe("deny");
    expect(permissionRules("full").task).toBeUndefined();
  });

  it("put the general rule first, so the named ones after it win", () => {
    expect(Object.keys(permissionRules("ask"))[0]).toBe("*");
    expect(Object.keys(permissionRules("full"))[0]).toBe("*");
  });

  it("are given twice: for the session and for the agent, which is read last", () => {
    const settings = sessionSettings({
      level: "ask",
      instructionsFile: "/tmp/instructions.md",
      tools: { markas: { url: "http://127.0.0.1:1/mcp/a/markas", token: "secret" } },
    }) as {
      permission: unknown;
      agent: { build: { permission: unknown } };
      mcp: Record<string, unknown>;
      experimental: { mcp_timeout: number; continue_loop_on_deny: boolean };
    };
    expect(settings.agent.build.permission).toEqual(settings.permission);
    expect(settings.mcp.markas).toEqual({
      type: "remote",
      url: "http://127.0.0.1:1/mcp/a/markas",
      headers: { Authorization: "Bearer secret" },
      oauth: false,
      enabled: true,
    });
    // A tool that waits for the person must not be cut off by OpenCode.
    expect(settings.experimental.mcp_timeout).toBeGreaterThan(24 * 60 * 60 * 1000);
    // A "no" is told to the bot instead of cutting its reply off.
    expect(settings.experimental.continue_loop_on_deny).toBe(true);
  });
});

describe("an OpenCode tool call in the words of Markas's access rules", () => {
  const cwd = resolve("/work/atlas");

  it("is judged by the call it belongs to, not by what OpenCode calls the question", () => {
    expect(judgedCalls(cwd, "external_directory", "read", { filePath: "/etc/hosts" }, {})).toEqual([
      { toolName: "Read", input: { file_path: "/etc/hosts" } },
    ]);
    expect(judgedCalls(cwd, "bash", "bash", { command: "ls" }, {})).toEqual([
      { toolName: "Bash", input: { command: "ls" } },
    ]);
  });

  it("names file changes, searches and the internet the way the other engines do", () => {
    expect(judgedCalls(cwd, "edit", "write", { filePath: "a.md" }, {})[0].toolName).toBe("Write");
    expect(judgedCalls(cwd, "edit", "edit", { filePath: "a.md" }, {})[0].toolName).toBe("Edit");
    expect(judgedCalls(cwd, "glob", "glob", { pattern: "**/*.ts", path: "src" }, {})).toEqual([
      { toolName: "Glob", input: { path: "src", pattern: "**/*.ts" } },
    ]);
    expect(judgedCalls(cwd, "webfetch", "webfetch", { url: "https://example.com" }, {})).toEqual([
      { toolName: "WebFetch", input: { url: "https://example.com" } },
    ]);
    expect(judgedCalls(cwd, "websearch", "websearch", { query: "x" }, {})[0].toolName).toBe(
      "WebSearch",
    );
  });

  it("uses what came with the question when the call itself is not known", () => {
    expect(judgedCalls(cwd, "edit", null, undefined, { filepath: "/tmp/a.md" })).toEqual([
      { toolName: "Edit", input: { file_path: "/tmp/a.md" } },
    ]);
  });

  it("judges every file of a patch on its own", () => {
    const calls = judgedCalls(
      cwd,
      "edit",
      "apply_patch",
      { patchText: "..." },
      {
        files: [{ filePath: "a.md" }, { filePath: "/tmp/b.md", movePath: "/tmp/c.md" }],
      },
    );
    expect(calls).toEqual([
      { toolName: "Write", input: { file_path: resolve(cwd, "a.md") } },
      { toolName: "Write", input: { file_path: resolve("/tmp/b.md") } },
      { toolName: "Write", input: { file_path: resolve("/tmp/c.md") } },
    ]);
  });

  it("gives a call it cannot read a name the rules do not know, so it is always asked about", () => {
    expect(judgedCalls(cwd, "some_tool", null, undefined, undefined)).toEqual([
      { toolName: "opencode:some_tool", input: {} },
    ]);
    expect(judgedCalls(cwd, "edit", "apply_patch", {}, {})).toEqual([
      { toolName: "opencode:patch", input: {} },
    ]);
  });
});
