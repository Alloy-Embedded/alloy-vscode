// Activation: register commands + statusbar + task provider. No logic
// here beyond wiring (NORTH_STAR: the CLI is the brain).

import * as vscode from "vscode";
import { setupEnvironment } from "./bootstrap";
import { runAction, AlloyTaskProvider } from "./tasks";
import { newProject, pickBoard } from "./wizard";
import { startDebug, generateLaunchJson } from "./debug";
import { AlloyStatusBar } from "./statusbar";
import { ActionsProvider, ToolsProvider, installTools } from "./views";

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
    vscode.commands.registerCommand("alloy.debug", wrap(startDebug)),
    vscode.commands.registerCommand("alloy.generateLaunchJson", wrap(generateLaunchJson)),
    vscode.tasks.registerTaskProvider("alloy", new AlloyTaskProvider()),
  );

  const actions = new ActionsProvider();
  const tools = new ToolsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("alloyActions", actions),
    vscode.window.registerTreeDataProvider("alloyTools", tools),
    vscode.commands.registerCommand("alloy.refreshTools", () => tools.refresh()),
    vscode.commands.registerCommand("alloy.installTools", wrap(installTools)),
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/alloy.toml");
  const refreshAll = () => {
    statusBar.refresh();
    actions.refresh();
  };
  watcher.onDidChange(refreshAll);
  watcher.onDidCreate(refreshAll);
  watcher.onDidDelete(refreshAll);
  context.subscriptions.push(watcher);

  statusBar.refresh();
}

export function deactivate(): void {}
