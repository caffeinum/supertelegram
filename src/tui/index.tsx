// must stay first: gramjs decides "browser or node" once, when telegram/platform is first loaded, by checking
// `typeof window` — and opentui's renderer sets global.window = {}. loaded after it, gramjs thinks it's in a
// browser and crashes on window.location (0.13.0 shipped offline because of this)
import "telegram/platform";
import { createCliRenderer } from "@opentui/core";
import { appendFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { createRoot } from "@opentui/react";
import { Component, type ReactNode } from "react";
import { App } from "./app";
import { loadDrafts } from "./drafts";
import { loadPool, savePool } from "./cache";
import { getConfig } from "../config/manager";
import { LazySource } from "./lazy-source";
import { getCurrentAccount, listAccounts, migrateLegacyIfNeeded } from "../config/accounts";
import { initialState, visibleChats } from "./state";
import type { DataSource } from "./types";

const LOG = join(homedir(), ".supertelegram", "tui.log");

function redirectConsole(): () => void {
  // owner-only even if an older version created it world-readable (it can hold chat details)
  if (existsSync(LOG)) chmodSync(LOG, 0o600);
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const write = (level: string) => (...args: unknown[]) => {
    const line = args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : inspect(a))).join(" ");
    appendFileSync(LOG, `${new Date().toISOString()} ${level} ${line}\n`, { mode: 0o600 });
  };
  Object.assign(console, { log: write("log"), info: write("info"), warn: write("warn"), error: write("error"), debug: write("debug") });
  return () => Object.assign(console, saved);
}

function lazySource(account: string | undefined): DataSource {
  migrateLegacyIfNeeded();
  // -a wins; then the account the tui showed last; then the cli's active one
  const last = getConfig().tuiAccount;
  const known = listAccounts().map((a) => a.name);
  const name = account ?? (last && known.includes(last) ? last : undefined) ?? getCurrentAccount() ?? "default";
  const meta = listAccounts().find((a) => a.name === name)?.meta;
  return new LazySource(name, meta?.username ? `@${meta.username}` : (meta?.name ?? ""), listAccounts().map((a) => a.name));
}

// a render error ends the session with the error instead of leaving a dead screen behind
class Crash extends Component<{ onCrash: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    this.props.onCrash(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

// account: an explicit -a, else the active one. nothing here loads gramjs before the first frame
export async function runTui(source?: DataSource, account?: string): Promise<void> {
  const src = source ?? lazySource(account);
  const cached = loadPool(src.account());
  // no cached list: connect first, so a logged-out account fails with the cli's normal error before taking the screen.
  // with one: draw it now and let the connection land behind it
  if (!cached) await src.ready;
  const initial = initialState(src.account(), src.accounts(), loadDrafts(), src.accountLabel());
  const images = getConfig().images;
  if (images === "auto" || images === "kitty" || images === "sixel" || images === "blocks") initial.imageProtocol = images;
  // last session's chat list: the first frame is complete; the live list replaces it a moment later
  if (cached) {
    Object.assign(initial, { chats: cached.chats, folders: cached.folders, chatsLoaded: true });
    initial.listSel = visibleChats(initial)[0]?.id;
  }
  // library chatter (gramjs logs, warnings) goes to a file: printing would draw over the ui
  const restoreConsole = redirectConsole();
  const renderer = await createCliRenderer({ exitOnCtrlC: false, consoleMode: "disabled", openConsoleOnError: false });
  let crashed: unknown;
  try {
    await new Promise<void>((resolve) => {
      createRoot(renderer).render(
        <Crash
          onCrash={(e) => {
            crashed = e;
            resolve();
          }}
        >
          <App source={src} initial={initial} onQuit={resolve} persistPool={savePool} />
        </Crash>
      );
    });
  } finally {
    renderer.destroy();
    restoreConsole();
    await src.close();
  }
  if (crashed) throw crashed;
}
