/// <reference types="vite/client" />

import type { MarkasDesktopApi } from "../../shared/ipc";

declare global {
  interface Window {
    markas: MarkasDesktopApi;
  }
}
