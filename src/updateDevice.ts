// "Update Device (UART)" — field firmware update from the editor. Picks a serial
// port (enumerated by the CLI), asks for a version, then runs ONE task that
// builds BOTH slot images and streams them with `alloy update
// --image-a/--image-b`: the device reports its target slot on HELLO and the CLI
// sends the matching image, so the user can't ship a wrong-slot binary. All
// protocol/logic lives in the CLI ("CLI is the brain"); this file is pure UX.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { currentBoard, findCli, listPorts, projectName, runCli, workspaceRoot } from "./cli";

export async function updateDevice(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  const board = currentBoard(root);
  const name = projectName(root);
  if (!board || !name) {
    void vscode.window.showWarningMessage("alloy.toml must declare [project] name and [board] id.");
    return;
  }

  // 1. Serial port — enumerated, with a manual escape hatch (socket:// etc.).
  const ports = await listPorts(root);
  const manual = { label: "$(edit) Enter port manually…", description: "" };
  const picked = await vscode.window.showQuickPick(
    [...ports.map((p) => ({ label: p.device, description: p.description })), manual],
    { placeHolder: "Update device (1/2) — serial port" },
  );
  if (!picked) {
    return;
  }
  let port = picked.label;
  if (picked === manual) {
    const typed = await vscode.window.showInputBox({
      prompt: "Serial port or pyserial URL (e.g. /dev/ttyUSB0, socket://host:3456)",
    });
    if (!typed) {
      return;
    }
    port = typed;
  }

  // 2. Monotonic image version — default to the epoch second, which is naturally
  // increasing between releases.
  const version = await vscode.window.showInputBox({
    prompt: "Image version (monotonic — higher is newer)",
    value: String(Math.floor(Date.now() / 1000)),
    validateInput: (v) => (/^\d+$/.test(v) ? undefined : "must be a non-negative integer"),
  });
  if (!version) {
    return;
  }

  // 3. Build both slot images, then stream the update.
  //
  // The preparation runs through the CLI directly and the directory is made
  // from Node — an earlier version chained it all with `mkdir -p … && …` in a
  // ShellExecution, which cannot work on Windows: VS Code's default shell
  // there is PowerShell, where `mkdir -p` is not valid and 5.1 has no `&&` at
  // all. Only the streaming step gets a terminal, because that is the one with
  // output worth watching.
  const elf = path.join(".alloy", "build-tree", board, "out", `${name}.elf`);
  const imageA = path.join(".alloy", "update", "a.img");
  const imageB = path.join(".alloy", "update", "b.img");
  fs.mkdirSync(path.join(root, ".alloy", "update"), { recursive: true });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification,
      title: "Alloy: building both slot images…" },
    async () => {
      for (const [slot, image] of [["a", imageA], ["b", imageB]] as const) {
        await runCli(["build", "--slot", slot], root);
        await runCli(["image", elf, "--set-version", version, "-o", image], root);
      }
    });

  // ProcessExecution, not ShellExecution: the arguments reach the CLI as an
  // argv array, so a path with a space needs no quoting and no shell is
  // involved on any platform.
  const cli = await findCli();
  const task = new vscode.Task(
    { type: "alloy", action: "update" },
    vscode.TaskScope.Workspace,
    `update (${port})`,
    "alloy",
    new vscode.ProcessExecution(cli, [
      "update", "--port", port, "--image-a", imageA, "--image-b", imageB,
    ], { cwd: root }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
  };
  await vscode.tasks.executeTask(task);
}
