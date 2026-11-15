# ADR 0001: A headless Bun host replaces the Electron shell

- Status: accepted, changed in part by ADR 0004 (a thin desktop shell now wraps the host)
- Date: 2026-11-11

## Context

The first version of Markas was an Electron desktop app.
Its backend ran in the Electron main process and talked to the UI over IPC.
Markas has to run unattended as a background service, start at login, and be reachable from scripts.

## Decision

The Electron main process, preload script and packaging are removed.
The backend runs in a Bun process that listens on 127.0.0.1 and serves the same SolidJS UI as a web page.

- Every former IPC handler is one entry in `src/host/methods.ts` and is reached with `POST /api/<name>`.
- Events reach the UI over server-sent events at `GET /api/events`.
- The HTTP surface is a pure function of the request (`src/host/handler.ts`), and `src/host/main.ts` only wires it to `Bun.serve`.
- The UI keeps the API shape it had (`window.markas`), now implemented with `fetch` and `EventSource` in `src/renderer/src/host-client.ts`.

## Consequences

- The handler is tested without opening a socket, under Vitest on Node.
- Native dialogs are gone: file picking uses the browser's picker and uploads bytes, and exports are written to `~/.markas/exports/`.
- Desktop notifications, the application menu and the in-app updater are gone and must be rebuilt in the web UI where still wanted.
- macOS screen recording and accessibility permission checks have no host equivalent, so Computer Use reports as unavailable.
