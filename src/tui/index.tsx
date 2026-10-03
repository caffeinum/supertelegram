import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Component, type ReactNode } from "react";
import { App } from "./app";
import { loadDrafts } from "./drafts";
import { loadPool, savePool } from "./cache";
import { LazySource } from "./lazy-source";
import { getCurrentAccount, listAccounts, migrateLegacyIfNeeded } from "../config/accounts";
import { initialState, visibleChats } from "./state";
import type { DataSource } from "./types";

function lazySource(account: string | undefined): DataSource {
  migrateLegacyIfNeeded();
  const name = account ?? getCurrentAccount() ?? "default";
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
  // last session's chat list: the first frame is complete; the live list replaces it a moment later
  if (cached) {
    Object.assign(initial, { chats: cached.chats, folders: cached.folders, chatsLoaded: true });
    initial.listSel = visibleChats(initial)[0]?.id;
  }
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
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
    await src.close();
  }
  if (crashed) throw crashed;
}
