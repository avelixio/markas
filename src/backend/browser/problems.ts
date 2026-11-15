export type BrowserProblemCode =
  | "no-browser"
  | "profile-locked"
  | "page-crashed"
  | "navigation-timeout"
  | "unreachable"
  | "tab-closed"
  | "person-in-control"
  | "page-changed"
  | "element-missing"
  | "wrong-site"
  | "invalid-request"
  | "action-failed";

/**
 * Something the browser could not do, said so a person or a bot knows what to do next.
 * Every problem leaves the browser in a state that can carry on: the message says how.
 */
export class BrowserProblem extends Error {
  readonly code: BrowserProblemCode;

  constructor(code: BrowserProblemCode, message: string) {
    super(message);
    this.name = "BrowserProblem";
    this.code = code;
  }
}

export const PAGE_CRASHED =
  "The page crashed. Reload it to carry on, or close the tab and open the page again.";
export const TAB_CLOSED_BY_PERSON =
  "That tab was closed in the browser window. Open the page again to carry on.";
export const TAB_CLOSED = "That tab is closed. Open the page again to carry on.";
export const BROWSER_CLOSED =
  "The browser window was closed, so that tab is gone. Open the page again to carry on; the sign-ins are kept.";
export const TAB_UNKNOWN = "There is no tab with that id. List the tabs to see what is open.";
export const PROFILE_LOCKED =
  "This bot's browser profile is in use by another program. Close the other browser window that uses it, or the other copy of Markas, then try again.";
export const PAGE_CHANGED =
  "The page has changed since you last read it. Read it again and use the new references.";
export const ELEMENT_MISSING =
  "That reference is not on the page any more. Read the page again and use the new references.";
