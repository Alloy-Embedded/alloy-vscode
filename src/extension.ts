// Activation: register commands + statusbar + task provider. No logic
// here beyond wiring (NORTH_STAR: the CLI is the brain).

import * as vscode from "vscode";
import { setupEnvironment } from "./bootstrap";
import { runAction, AlloyTaskProvider } from "./tasks";
import { newProject, pickBoard } from "./wizard";
import { AlloyStatusBar } from "./statusbar";

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new AlloyStatusBar(context);

  const wrap = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (err) {
      void vscode.window.showErrorMessage(`Alloy: ${(err as Error).message}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("alloy.setup", wrap(setupEnvironment)),
    vscode.commands.registerCommand("alloy.newProject", wrap(newProject)),
    vscode.commands.registerCommand("alloy.pickBoard",
      wrap(() => pickBoard(() => statusBar.refresh()))),
    vscode.commands.registerCommand("alloy.build", wrap(() => runAction("build"))),
    vscode.commands.registerCommand("alloy.flash", wrap(() => runAction("flash"))),
    vscode.commands.registerCommand("alloy.run", wrap(() => runAction("run"))),
    vscode.commands.registerCommand("alloy.monitor", wrap(() => runAction("monitor"))),
    vscode.commands.registerCommand("alloy.clean", wrap(() => runAction("clean"))),
    vscode.tasks.registerTaskProvider("alloy", new AlloyTaskProvider()),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/alloy.toml");
  watcher.onDidChange(() => statusBar.refresh());
  watcher.onDidCreate(() => statusBar.refresh());
  watcher.onDidDelete(() => statusBar.refresh());
  context.subscriptions.push(watcher);

  statusBar.refresh();
}

export function deactivate(): void {}
