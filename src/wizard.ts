// Project wizard + board picker — QuickPick over `alloy boards --json`.

import * as path from "node:path";
import * as vscode from "vscode";
import { listBoards, runCli, workspaceRoot } from "./cli";

export async function newProject(): Promise<void> {
  const boards = await listBoards();
  const picked = await vscode.window.showQuickPick(
    boards.map((b) => ({
      label: b.id,
      description: b.name,
      detail: `chip: ${b.chip}   probe: ${b.probe ?? "none"}   roles: ${b.roles.join(", ")}`,
    })),
    { placeHolder: "Board for the new project", matchOnDescription: true },
  );
  if (!picked) {
    return;
  }
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
