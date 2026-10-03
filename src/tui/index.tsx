import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Component, type ReactNode } from "react";
import { App } from "./app";
import { loadDrafts } from "./drafts";
import { GramSource } from "./gram-source";
import { initialState } from "./state";
import type { DataSource } from "./types";

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

export async function runTui(source?: DataSource): Promise<void> {
  // everything that can fail before drawing happens before taking over the screen
  const src = source ?? (await GramSource.open());
  const initial = initialState(src.account(), src.accounts(), loadDrafts());
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
          <App source={src} initial={initial} onQuit={resolve} />
        </Crash>
      );
    });
  } finally {
    renderer.destroy();
    await src.close();
  }
  if (crashed) throw crashed;
}
