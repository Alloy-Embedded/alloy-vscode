// Project wizard + board picker. Two ways to start a project: from a curated
// board (`alloy boards --json`), or a clean board for any MCU (`alloy chips
// --json` → `alloy new --chip`), so the user isn't limited to ready-made boards.

import * as path from "node:path";
import * as vscode from "vscode";
import { listBoards, listChips, runCli, workspaceRoot } from "./cli";

function vendorOf(chip: string): string {
  return chip.split("/")[0] || "other";
}

async function askNameAndParent(): Promise<{ name: string; parent: string } | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: "Project name",
    validateInput: (v) =>
      /^[a-z][a-z0-9_]*$/.test(v) ? null : "lowercase letters, digits and _ (must start with a letter)",
  });
  if (!name) {
    return undefined;
  }
  const parent = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Create project here",
  });
  if (!parent?.[0]) {
    return undefined;
  }
  return { name, parent: parent[0].fsPath };
}

async function openProject(parentPath: string, name: string): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(path.join(parentPath, name)),
    { forceNewWindow: false },
  );
}

export async function newProject(): Promise<void> {
  const mode = await vscode.window.showQuickPick(
    [
      { label: "$(circuit-board) From a supported board", detail: "A ready-made board — recommended", mode: "board" },
      { label: "$(cpu) Custom board — choose an MCU", detail: "Any chip; you fill in the pins yourself", mode: "chip" },
    ],
    { placeHolder: "New alloy project" },
  );
  if (!mode) {
    return;
  }
  await (mode.mode === "chip" ? newFromChip() : newFromBoard());
}

async function newFromBoard(): Promise<void> {
  const boards = await listBoards();
  const vendors = [...new Set(boards.map((b) => vendorOf(b.chip)))].sort();
  const vendor = await vscode.window.showQuickPick(
    vendors.map((v) => ({
      label: v,
      description: `${boards.filter((b) => vendorOf(b.chip) === v).length} board(s)`,
    })),
    { placeHolder: "Board project (1/3) — MCU vendor" },
  );
  if (!vendor) {
    return;
  }
  const picked = await vscode.window.showQuickPick(
    boards
      .filter((b) => vendorOf(b.chip) === vendor.label)
      .map((b) => ({
        label: b.id,
        description: b.name,
        detail: `chip: ${b.chip}   probe: ${b.probe ?? "none"}   roles: ${b.roles.join(", ")}`,
      })),
    { placeHolder: "Board project (2/3) — board", matchOnDescription: true, matchOnDetail: true },
  );
  if (!picked) {
    return;
  }
  const np = await askNameAndParent();
  if (!np) {
    return;
  }
  await runCli(["new", np.name, "--board", picked.label], np.parent);
  await openProject(np.parent, np.name);
}

async function newFromChip(): Promise<void> {
  const chips = await listChips();
  const vendors = [...new Set(chips.map((c) => c.vendor))].sort();
  const vendor = await vscode.window.showQuickPick(
    vendors.map((v) => ({
      label: v,
      description: `${chips.filter((c) => c.vendor === v).length} MCU(s)`,
    })),
    { placeHolder: "Custom board (1/3) — MCU vendor" },
  );
  if (!vendor) {
    return;
  }
  const chip = await vscode.window.showQuickPick(
    chips
      .filter((c) => c.vendor === vendor.label)
      .map((c) => ({ label: c.id, description: c.family, detail: c.core ?? "" })),
    { placeHolder: "Custom board (2/3) — MCU (type to filter)", matchOnDescription: true },
  );
  if (!chip) {
    return;
  }
  const np = await askNameAndParent();
  if (!np) {
    return;
  }
  await runCli(["new", np.name, "--chip", chip.label], np.parent);
  void vscode.window.showInformationMessage(
    `Clean board for ${chip.label} created. Edit boards/${np.name}/board.json to add your pins (led, uart, i2c…).`,
  );
  await openProject(np.parent, np.name);
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
