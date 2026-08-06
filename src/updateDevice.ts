// "Update Device (UART)" — field firmware update from the editor. Picks a serial
// port (enumerated by the CLI), asks for a version, then runs ONE task that
// builds BOTH slot images and streams them with `alloy update
// --image-a/--image-b`: the device reports its target slot on HELLO and the CLI
// sends the matching image, so the user can't ship a wrong-slot binary. All
// protocol/logic lives in the CLI ("CLI is the brain"); this file is pure UX.

import * as vscode from "vscode";
import { currentBoard, findCli, listPorts, projectName, workspaceRoot } from "./cli";

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

  // 3. One task: build slot-A image, build slot-B image, stream the update.
  // `alloy image` takes the ELF directly (no objcopy on this machine needed).
  const cli = await findCli();
  const elf = `.alloy/build-tree/${board}/out/${name}.elf`;
  const q = (s: string) => `"${s}"`;
  const cmd = [
    `${q(cli)} build --slot a`,
    `${q(cli)} image ${q(elf)} --set-version ${version} -o .alloy/update/a.img`,
    `${q(cli)} build --slot b`,
    `${q(cli)} image ${q(elf)} --set-version ${version} -o .alloy/update/b.img`,
    `${q(cli)} update --port ${q(port)} --image-a .alloy/update/a.img --image-b .alloy/update/b.img`,
  ].join(" && ");
  const task = new vscode.Task(
    { type: "alloy", action: "update" },
    vscode.TaskScope.Workspace,
    `update (${port})`,
    "alloy",
    new vscode.ShellExecution(`mkdir -p .alloy/update && ${cmd}`, { cwd: root }),
    ["$gcc"],
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
  };
  await vscode.tasks.executeTask(task);
}
