# ADR 0003: Injectable engine clients and a browser contract

- Status: accepted
- Date: 2026-11-11

## Context

Before this change, `AgentService` built its Codex and Claude clients itself, so tests had to place fake executables on disk.
Those fakes are POSIX shell scripts and cannot run on Windows.
`AgentService` also imported its browser tool definitions from the Electron browser implementation, so loading the service loaded Electron.

## Decision

- `AgentService` takes an `AgentClientFactory`.
The default, `createInstalledCliClient`, resolves the installed CLIs as before.
- `src/backend/testing/fake-agent-client.ts` is an in-process engine that speaks the same app-server contract.
New tools are tested against it.
- The browser tool definitions and a `BrowserService` interface live in `src/backend/browser-tools.ts`, with no Electron import.
- Until phase 1b, the host runs `UnavailableBrowserService`, which refuses every browser action with a clear message.

## Consequences

- A third engine (ACP) plugs in by extending the factory, not by editing `AgentService`.
- Tests written against the fake client run on every operating system.
- Agents are still told about the browser tools in their instructions and get an honest "unavailable" answer when they call one.
