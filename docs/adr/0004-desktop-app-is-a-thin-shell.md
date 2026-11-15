# ADR 0004: The desktop app is a thin shell around the host

- Status: accepted
- Date: 2026-11-11
- Changes: ADR 0001, which said there would be no desktop shell

## Context

ADR 0001 removed the desktop shell and served the interface in the person's browser.
In use, that read as "a website", not as an app: a browser tab, an address bar, and nothing in the taskbar or tray.
The designs show an app, and the signal and the beacon need native always-on-top windows that a browser tab cannot give.

## Decision

Markas ships as a desktop app again, built with Electron.
The shell is deliberately thin.

- The host stays exactly as it is: a separate program that owns bots, keys and data, and serves the interface over HTTP on 127.0.0.1.
- The shell starts the host if none is running, and stops it on quit only if it started it.
- The app window loads the host's own pages and nothing else.
Web links open in the person's browser.
- The window has no Node access: context isolation and the sandbox are on, and there is no preload script.
All app behaviour still goes through the host's HTTP methods.
- Closing the window keeps Markas in the tray, so bots and rounds carry on.
- The shell's own code is `src/desktop/`, bundled into one file.
No `node_modules` are shipped in the app.

The headless `markas` program remains for servers and scripts.
Run alone, it opens the interface as a standalone browser window when it can, and as a tab otherwise.

## Consequences

- The download grows by about 90 MB for the Electron runtime.
- A macOS build needs a Mac, and should be signed and notarised before it is shared widely.
- Native features now have a home: tray, notifications, launch at login, and later the signal and the beacon as their own windows.
- Because the shell holds no logic, it has almost nothing to test beyond how it finds and reaches the host, which is covered in `src/desktop/host-link.test.ts`.
