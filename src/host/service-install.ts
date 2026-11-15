import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SERVICE_LABEL = "id.markas.host";
const WINDOWS_TASK = "Markas Host";

export interface ServiceCommand {
  /** Absolute path of the runtime, normally the Bun executable. */
  runtime: string;
  /** Arguments that start the host, normally [cli.ts, "serve"]. */
  args: string[];
  logsRoot: string;
}

export interface InstallResult {
  kind: "launchd" | "task-scheduler" | "systemd";
  location: string;
}

/**
 * Registers the host to start at login and restart if it exits.
 * macOS is the primary target (launchd agent); Windows and Linux get the native equivalent.
 */
export async function installService(command: ServiceCommand): Promise<InstallResult> {
  await mkdir(command.logsRoot, { recursive: true, mode: 0o700 });
  switch (process.platform) {
    case "darwin":
      return installLaunchdAgent(command);
    case "win32":
      return installScheduledTask(command);
    case "linux":
      return installSystemdUnit(command);
    default:
      throw new Error(`Autostart is not supported on ${process.platform}.`);
  }
}

export async function uninstallService(): Promise<void> {
  switch (process.platform) {
    case "darwin": {
      const plist = launchdPlistPath();
      await execFileAsync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}`, plist]).catch(
        () => undefined,
      );
      await rm(plist, { force: true });
      return;
    }
    case "win32":
      await execFileAsync("schtasks.exe", ["/Delete", "/TN", WINDOWS_TASK, "/F"]).catch(
        () => undefined,
      );
      return;
    case "linux":
      await execFileAsync("systemctl", ["--user", "disable", "--now", "markas.service"]).catch(
        () => undefined,
      );
      await rm(systemdUnitPath(), { force: true });
      return;
    default:
      throw new Error(`Autostart is not supported on ${process.platform}.`);
  }
}

export function launchdPlist(command: ServiceCommand): string {
  const programArguments = [command.runtime, ...command.args]
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(command.logsRoot, "host.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(command.logsRoot, "host.err.log"))}</string>
</dict>
</plist>
`;
}

export function scheduledTaskXml(command: ServiceCommand): string {
  const args = command.args.map(quoteWindowsArgument).join(" ");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs the Markas host at sign-in and restarts it if it stops.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Hidden>true</Hidden>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(command.runtime)}</Command>
      <Arguments>${escapeXml(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

export function systemdUnit(command: ServiceCommand): string {
  const exec = [command.runtime, ...command.args].map(quoteSystemdArgument).join(" ");
  return `[Unit]
Description=Markas host

[Service]
ExecStart=${exec}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

async function installLaunchdAgent(command: ServiceCommand): Promise<InstallResult> {
  const location = launchdPlistPath();
  const domain = `gui/${process.getuid?.() ?? 0}`;
  await mkdir(dirname(location), { recursive: true });
  await execFileAsync("launchctl", ["bootout", domain, location]).catch(() => undefined);
  await writeFile(location, launchdPlist(command), { encoding: "utf8", mode: 0o644 });
  await execFileAsync("launchctl", ["bootstrap", domain, location]);
  return { kind: "launchd", location };
}

async function installScheduledTask(command: ServiceCommand): Promise<InstallResult> {
  const definition = join(command.logsRoot, "markas-host-task.xml");
  // schtasks only reads UTF-16 task definitions with a byte-order mark.
  await writeFile(definition, `\ufeff${scheduledTaskXml(command)}`, { encoding: "utf16le" });
  try {
    await execFileAsync("schtasks.exe", ["/Create", "/TN", WINDOWS_TASK, "/XML", definition, "/F"]);
    await execFileAsync("schtasks.exe", ["/Run", "/TN", WINDOWS_TASK]);
  } finally {
    await rm(definition, { force: true });
  }
  return { kind: "task-scheduler", location: WINDOWS_TASK };
}

async function installSystemdUnit(command: ServiceCommand): Promise<InstallResult> {
  const location = systemdUnitPath();
  await mkdir(dirname(location), { recursive: true });
  await writeFile(location, systemdUnit(command), { encoding: "utf8", mode: 0o644 });
  await execFileAsync("systemctl", ["--user", "daemon-reload"]);
  await execFileAsync("systemctl", ["--user", "enable", "--now", "markas.service"]);
  return { kind: "systemd", location };
}

function launchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function systemdUnitPath(): string {
  return join(homedir(), ".config", "systemd", "user", "markas.service");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function quoteWindowsArgument(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function quoteSystemdArgument(value: string): string {
  return /[\s"\\]/.test(value)
    ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
    : value;
}
