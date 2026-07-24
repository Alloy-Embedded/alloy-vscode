// Project wizard + board picker — QuickPick over `alloy boards --json`.

import * as path from "node:path";
import * as vscode from "vscode";
import { listBoards, runCli, workspaceRoot } from "./cli";

function vendorOf(chip: string): string {
  return chip.split("/")[0] || "other";
}

export async function newProject(): Promise<void> {
  const boards = await listBoards();

  // Step 1/3 — vendor. Grouping keeps the picker manageable as the board list
  // grows (PlatformIO-style: choose the silicon vendor first).
  const vendors = [...new Set(boards.map((b) => vendorOf(b.chip)))].sort();
  const vendor = await vscode.window.showQuickPick(
    vendors.map((v) => ({
      label: v,
      description: `${boards.filter((b) => vendorOf(b.chip) === v).length} board(s)`,
    })),
    { placeHolder: "New project (1/3) — MCU vendor" },
  );
  if (!vendor) {
    return;
  }

  // Step 2/3 — board within that vendor.
  const picked = await vscode.window.showQuickPick(
    boards
      .filter((b) => vendorOf(b.chip) === vendor.label)
      .map((b) => ({
        label: b.id,
        description: b.name,
        detail: `chip: ${b.chip}   probe: ${b.probe ?? "none"}   roles: ${b.roles.join(", ")}`,
      })),
    { placeHolder: "New project (2/3) — board", matchOnDescription: true, matchOnDetail: true },
  );
  if (!picked) {
    return;
  }

  // Step 3/3 — name.
  const name = await vscode.window.showInputBox({
    prompt: "Project name",
    validateInput: (v) =>
      /^[a-z][a-z0-9_]*$/.test(v) ? null : "lowercase letters, digits and _ (must start with a letter)",
  });
  if (!name) {
    return;
  }
  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Create project here",
  });
  if (!parent?.[0]) {
    return;
  }
  const parentPath = parent[0].fsPath;
  await runCli(["new", name, "--board", picked.label], parentPath);
  const projectPath = vscode.Uri.file(path.join(parentPath, name));
  await vscode.commands.executeCommand("vscode.openFolder", projectPath, {
    forceNewWindow: false,
  });
}

export async function pickBoard(onChanged: () => void): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  const boards = await listBoards(root);
  const picked = await vscode.window.showQuickPick(
    boards.map((b) => ({ label: b.id, description: b.name })),
    { placeHolder: "Switch board" },
  );
  if (!picked) {
    return;
  }
  await runCli(["set-board", picked.label], root);
  onChanged();
  void vscode.window.showInformationMessage(`Alloy board: ${picked.label}`);
}
