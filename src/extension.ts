// Activation: register commands + statusbar + task provider. No logic
// here beyond wiring (NORTH_STAR: the CLI is the brain).

import * as vscode from "vscode";
import { offerUpgrade, setupEnvironment } from "./bootstrap";
import { runAction, AlloyTaskProvider } from "./tasks";
import { newProject, pickBoard } from "./wizard";
import { startDebug, generateLaunchJson } from "./debug";
import { AlloyStatusBar } from "./statusbar";
import { ActionsProvider, MemoryProvider, ToolsProvider, installTools } from "./views";
import { LibrariesProvider, addLibrary } from "./libraries";
import { configureBoard } from "./boardEditor";
import { updateDevice } from "./updateDevice";
import { showMatrix, showMemory } from "./panels";
import { openMonitor } from "./monitorPanel";
import { workspaceRoot } from "./cli";

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = new AlloyStatusBar(context);

  const wrap =
    (fn: (...args: unknown[]) => Promise<void>) =>
    async (...args: unknown[]) => {
      try {
        await fn(...args);
      } catch (err) {
        void vscode.window.showErrorMessage(`Alloy: ${(err as Error).message}`);
      }
    };

  context.subscriptions.push(
    vscode.commands.registerCommand("alloy.setup", wrap(setupEnvironment)),
    vscode.commands.registerCommand("alloy.upgradeCli", wrap(() =>
      offerUpgrade("Update the alloy CLI to the version this extension needs?"))),
    vscode.commands.registerCommand("alloy.newProject", wrap(() => newProject(context))),
    vscode.commands.registerCommand("alloy.pickBoard",
      wrap(() => pickBoard(() => statusBar.refresh()))),
    vscode.commands.registerCommand("alloy.build", wrap(() => runAction("build"))),
    vscode.commands.registerCommand("alloy.flash", wrap(() => runAction("flash"))),
    vscode.commands.registerCommand("alloy.run", wrap(() => runAction("run"))),
    vscode.commands.registerCommand("alloy.monitor", wrap(() => runAction("monitor"))),
    vscode.commands.registerCommand("alloy.clean", wrap(() => runAction("clean"))),
    vscode.commands.registerCommand("alloy.emulate", wrap(() => runAction("emulate"))),
    vscode.commands.registerCommand("alloy.buildAll", wrap(showMatrix)),
    vscode.commands.registerCommand("alloy.memory", wrap(showMemory)),
    vscode.commands.registerCommand("alloy.monitorPanel",
      wrap(() => openMonitor(context.extensionUri))),
    vscode.commands.registerCommand("alloy.ciInit", wrap(async () => {
      await runAction("ci-init");
    })),
    vscode.commands.registerCommand("alloy.debug", wrap(startDebug)),
    vscode.commands.registerCommand("alloy.generateLaunchJson", wrap(generateLaunchJson)),
    vscode.tasks.registerTaskProvider("alloy", new AlloyTaskProvider()),
  );

  const actions = new ActionsProvider();
  const tools = new ToolsProvider();
  const libraries = new LibrariesProvider();
  const memory = new MemoryProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("alloyActions", actions),
    vscode.window.registerTreeDataProvider("alloyTools", tools),
    vscode.window.registerTreeDataProvider("alloyLibraries", libraries),
    vscode.window.registerTreeDataProvider("alloyMemory", memory),
    vscode.commands.registerCommand("alloy.refreshMemory", () => memory.refresh()),
    // A finished build changes the numbers — refresh then, so the panel is
    // never showing the previous binary's size.
    vscode.tasks.onDidEndTask((e) => {
      if (e.execution.task.source === "alloy") {
        memory.refresh();
      }
    }),
    vscode.commands.registerCommand("alloy.refreshTools", () => tools.refresh()),
    vscode.commands.registerCommand("alloy.installTools", wrap(installTools)),
    vscode.commands.registerCommand("alloy.refreshLibraries", () => libraries.refresh()),
    vscode.commands.registerCommand("alloy.addLibrary",
      wrap((name?: unknown) =>
        addLibrary(() => libraries.refresh(), typeof name === "string" ? name : undefined))),
    vscode.commands.registerCommand("alloy.updateDevice", wrap(updateDevice)),
    vscode.commands.registerCommand("alloy.configureBoard",
      wrap(() => configureBoard(() => { actions.refresh(); statusBar.refresh(); }))),
  );

  // A freshly-scaffolded custom board opens the visual configurator once its
  // window loads (the wizard hands the path off through globalState).
  const pending = context.globalState.get<string>("alloy.configureOnOpen");
  if (pending && workspaceRoot() === pending) {
    void context.globalState.update("alloy.configureOnOpen", undefined);
    void vscode.commands.executeCommand("alloy.configureBoard");
  }

  const watcher = vscode.workspace.createFileSystemWatcher("**/alloy.toml");
  const refreshAll = () => {
    statusBar.refresh();
    actions.refresh();
    libraries.refresh();
  };
  watcher.onDidChange(refreshAll);
  watcher.onDidCreate(refreshAll);
  watcher.onDidDelete(refreshAll);
  context.subscriptions.push(watcher);

  statusBar.refresh();
}

export function deactivate(): void {}
