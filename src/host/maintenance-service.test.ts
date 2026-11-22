// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentService } from "../backend/agent-service";
import type { MailboxStore } from "../backend/mailbox-store";
import { exportMarkasData } from "./maintenance-service";

const execFileAsync = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "markas-maintenance-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the data backup", () => {
  it.runIf(process.platform === "darwin")(
    "holds only Markas's own files, without macOS's hidden ._ files",
    async () => {
      const service = {
        listBots: () => [],
        readConversation: async () => null,
        listQueue: () => null,
      } as unknown as AgentService;
      const mailbox = { listExportAttachments: async () => [] } as unknown as MailboxStore;

      const result = await exportMarkasData({
        service,
        mailbox,
        exportsRoot: join(root, "exports"),
        version: "0.0.0-test",
      });

      expect(result.saved).toBe(true);
      const path = (result as { path: string }).path;
      const { stdout } = await execFileAsync("/usr/bin/zipinfo", ["-1", path]);
      expect(stdout.trim().split("\n").sort()).toEqual([
        "Markas Backup/",
        "Markas Backup/markas-data.json",
      ]);
    },
  );
});
