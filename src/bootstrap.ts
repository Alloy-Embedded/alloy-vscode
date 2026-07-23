// Setup flow. The extension NEVER installs toolchains (guardrail #2) —
// it runs `alloy setup` in a terminal so every download is visible. When
// the CLI itself is missing, it guides installation; the one-click
// `uv tool install alloy` path activates once the packages are published.

import * as vscode from "vscode";
import { findCli, CliNotFoundError, invalidateCliCache } from "./cli";

export async function setupEnvironment(): Promise<void> {
  try {
    const cli = await findCli();
    const terminal = vscode.window.createTerminal({ name: "alloy setup" });
    terminal.show();
    // --check first is instant; the user re-runs without it to install.
    terminal.sendText(`${quote(cli)} setup --check`);
    const choice = await vscode.window.showInformationMessage(
      "Checked toolchains in the terminal. Install anything missing?",
      "Install missing",
      "Done",
    );
    if (choice === "Install missing") {
      terminal.sendText(`${quote(cli)} setup`);
    }
  } catch (err) {
    if (!(err instanceof CliNotFoundError)) {
      throw err;
    }
    const choice = await vscode.window.showWarningMessage(
      "The alloy CLI is not installed.",
      "Installation instructions",
      "I installed it — recheck",
    );
    if (choice === "Installation instructions") {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/Alloy-Embedded/alloy#installation"),
      );
    } else if (choice === "I installed it — recheck") {
      invalidateCliCache();
      await setupEnvironment();
    }
  }
}

function quote(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}
