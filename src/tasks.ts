// Task provider: `alloy` tasks run in the integrated terminal with the
// exact command line visible (NORTH_STAR: no opaque orchestration) and a
// GCC problem matcher so build errors land in the Problems panel.

import * as vscode from "vscode";
import { findCli, workspaceRoot } from "./cli";

export interface AlloyTaskDefinition extends vscode.TaskDefinition {
  action: string;
  board?: string;
}

const ACTIONS = ["build", "flash", "run", "monitor", "clean", "gen"];

export class AlloyTaskProvider implements vscode.TaskProvider {
  async provideTasks(): Promise<vscode.Task[]> {
    if (!workspaceRoot()) {
      return [];
    }
    const tasks: vscode.Task[] = [];
    for (const action of ACTIONS) {
      tasks.push(await makeTask({ type: "alloy", action }));
    }
    return tasks;
  }

  async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    const def = task.definition as AlloyTaskDefinition;
    if (def.action && ACTIONS.includes(def.action)) {
      return makeTask(def);
    }
    return undefined;
  }
}

export async function makeTask(def: AlloyTaskDefinition): Promise<vscode.Task> {
  const cli = await findCli();
  const args = [def.action, ...(def.board ? ["--board", def.board] : [])];
  const label = def.board ? `${def.action} (${def.board})` : def.action;
  const task = new vscode.Task(
    def,
    vscode.TaskScope.Workspace,
    label,
    "alloy",
    new vscode.ProcessExecution(cli, args),
    def.action === "build" || def.action === "flash" || def.action === "run"
      ? ["$gcc"]
      : [],
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
  };
  if (def.action === "build") {
    task.group = vscode.TaskGroup.Build;
  }
  return task;
}

export async function runAction(action: string, board?: string): Promise<void> {
  const task = await makeTask({ type: "alloy", action, board });
  await vscode.tasks.executeTask(task);
}
