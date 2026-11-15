import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { arch, release as osRelease, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentService } from "../backend/agent-service";
import type { BrowserService } from "../backend/browser-tools";
import type { MailboxStore } from "../backend/mailbox-store";
import type { BotSummary, ExportResult } from "../shared/ipc";

const execFileAsync = promisify(execFile);

interface MaintenanceContext {
  service: AgentService;
  browser: BrowserService;
  mailbox: MailboxStore;
  /** Exports are written here; the web UI cannot show a native save dialog. */
  exportsRoot: string;
  version: string;
}

export async function exportMarkasData(
  context: Pick<MaintenanceContext, "service" | "mailbox" | "exportsRoot" | "version">,
): Promise<ExportResult> {
  const destination = await chooseExportDestination(
    context.exportsRoot,
    `Markas-backup-${new Date().toISOString().slice(0, 10)}.zip`,
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "markas-export-"));
  const exportRoot = join(temporaryRoot, "Markas Backup");
  const archiveCandidate = `${destination}.${randomUUID()}.tmp.zip`;
  try {
    await mkdir(exportRoot, { recursive: true, mode: 0o700 });
    const bots = context.service.listBots();
    const [conversations, queues, attachments] = await Promise.all([
      Promise.all(bots.map((bot) => context.service.readConversation(bot.id))),
      Promise.resolve(bots.map((bot) => context.service.listQueue(bot.id))),
      context.mailbox.listExportAttachments(),
    ]);
    const manifest = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      application: { name: "Markas", version: context.version },
      scope: {
        includes: ["agent profiles", "conversation snapshots", "queues", "attachments"],
        excludes: ["Codex credentials", "browser cookies", "agent workspace files"],
      },
      bots: bots.map(toBackupBot),
      conversations,
      queues,
    };
    await writeFile(
      join(exportRoot, "markas-data.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    for (const attachment of attachments) {
      const target = join(exportRoot, attachment.relativePath);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(attachment.sourcePath, target);
    }
    if (process.platform === "win32") {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -LiteralPath '${powerShellLiteral(exportRoot)}' -DestinationPath '${powerShellLiteral(archiveCandidate)}' -Force`,
      ]);
    } else {
      await execFileAsync("/usr/bin/ditto", [
        "-c",
        "-k",
        "--keepParent",
        exportRoot,
        archiveCandidate,
      ]);
    }
    await rename(archiveCandidate, destination);
    return { saved: true, path: destination };
  } finally {
    await Promise.all([
      rm(temporaryRoot, { recursive: true, force: true }),
      rm(archiveCandidate, { force: true }),
    ]);
  }
}

function powerShellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

export async function exportDiagnostics(
  context: Pick<MaintenanceContext, "service" | "browser" | "exportsRoot" | "version">,
): Promise<ExportResult> {
  const destination = await chooseExportDestination(
    context.exportsRoot,
    `Markas-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
  );
  const status = context.service.getStatus();
  const bots = context.service.listBots();
  const queueCounts = bots.map((bot) => {
    const queue = context.service.listQueue(bot.id);
    return {
      botId: bot.id,
      paused: queue.paused,
      deliveries: Object.fromEntries(
        ["queued", "starting", "running", "completed", "failed", "interrupted", "cancelled"].map(
          (deliveryStatus) => [
            deliveryStatus,
            queue.deliveries.filter((delivery) => delivery.status === deliveryStatus).length,
          ],
        ),
      ),
    };
  });
  const diagnostics = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    application: {
      version: context.version,
      platform: process.platform,
      architecture: arch(),
      osRelease: osRelease(),
      bun: process.versions.bun ?? null,
      node: process.versions.node,
    },
    agent: {
      phase: status.phase,
      cliVersion: status.cliVersion,
      authentication: status.auth.kind,
      capabilities: status.capabilities,
      fullAccess: status.fullAccess,
      botCount: bots.length,
      queues: queueCounts,
    },
    browser: {
      tabCount: context.browser.listTabs().length,
      activeControlCount: context.browser.getControlState().sessions.length,
    },
    privacy:
      "Contains no conversations, URLs, email addresses, tokens, file contents, file paths, or raw error messages.",
  };
  await writeFile(destination, `${JSON.stringify(diagnostics, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return { saved: true, path: destination };
}

async function chooseExportDestination(exportsRoot: string, defaultName: string): Promise<string> {
  await mkdir(exportsRoot, { recursive: true, mode: 0o700 });
  return join(exportsRoot, defaultName);
}

function toBackupBot(bot: BotSummary): Omit<BotSummary, "workspacePath"> {
  return {
    id: bot.id,
    name: bot.name,
    role: bot.role,
    description: bot.description,
    notifications: bot.notifications,
    model: bot.model,
    reasoningEffort: bot.reasoningEffort,
    threadId: bot.threadId,
    preview: bot.preview,
    updatedAt: bot.updatedAt,
    avatarShape: bot.avatarShape,
    avatarColor: bot.avatarColor,
    access: bot.access,
  };
}
