// Activity-bar sidebar: project actions + toolchain status. Pure
// presentation — every fact comes from the CLI (setup --check --json).

import * as vscode from "vscode";
import { findCli, runCli, workspaceRoot, currentBoard, CliNotFoundError } from "./cli";

// ---- Project actions view ------------------------------------------------

interface ActionSpec {
  label: string;
  icon: string;
  command: string;
  detail?: string;
  needsProject: boolean;
}

const ACTIONS: ActionSpec[] = [
  { label: "New Project", icon: "new-folder", command: "alloy.newProject", needsProject: false },
  { label: "Setup Environment", icon: "desktop-download", command: "alloy.setup", needsProject: false },
  { label: "Pick Board", icon: "circuit-board", command: "alloy.pickBoard", needsProject: true },
  { label: "Build", icon: "tools", command: "alloy.build", needsProject: true },
  { label: "Flash", icon: "zap", command: "alloy.flash", needsProject: true },
  { label: "Run (Flash + Monitor)", icon: "vm-running", command: "alloy.run", needsProject: true },
  { label: "Monitor", icon: "pulse", command: "alloy.monitor", needsProject: true },
  { label: "Debug", icon: "debug-alt", command: "alloy.debug", needsProject: true },
  { label: "Clean", icon: "trash", command: "alloy.clean", needsProject: true },
  { label: "Generate launch.json", icon: "json", command: "alloy.generateLaunchJson", needsProject: true },
];

export class ActionsProvider implements vscode.TreeDataProvider<ActionSpec> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(spec: ActionSpec): vscode.TreeItem {
    const item = new vscode.TreeItem(spec.label);
    item.iconPath = new vscode.ThemeIcon(spec.icon);
    item.command = { command: spec.command, title: spec.label };
    if (spec.command === "alloy.pickBoard") {
      const root = workspaceRoot();
      const board = root ? currentBoard(root) : null;
      item.description = board ?? "";
    }
    return item;
  }

  getChildren(): ActionSpec[] {
    const hasProject = workspaceRoot() !== null;
    return ACTIONS.filter((a) => hasProject || !a.needsProject);
  }
}

// ---- Toolchains view -----------------------------------------------------

interface ToolRow {
  tool: string;
  check: string;
  kind: string;
  families: string[];
  status: "path" | "installed" | "missing";
  path: string | null;
  remedy?: string;
  installable?: boolean;
}

type ToolsNode = ToolRow | { error: string };

export class ToolsProvider implements vscode.TreeDataProvider<ToolsNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(node: ToolsNode): vscode.TreeItem {
    if ("error" in node) {
      const item = new vscode.TreeItem(node.error);
      item.iconPath = new vscode.ThemeIcon("warning");
      item.command = { command: "alloy.setup", title: "Setup" };
      return item;
    }
    const item = new vscode.TreeItem(node.tool);
    if (node.status === "missing") {
      item.iconPath = new vscode.ThemeIcon(
        "error", new vscode.ThemeColor("errorForeground"));
      item.description = node.kind === "system" ? node.remedy : "faltando — clique p/ instalar";
      item.tooltip = node.remedy ?? `instala via: alloy setup`;
      item.command = { command: "alloy.installTools", title: "Install" };
    } else {
      item.iconPath = new vscode.ThemeIcon(
        "check", new vscode.ThemeColor("testing.iconPassed"));
      item.description = node.status === "path" ? "PATH" : "~/.alloy/tools";
      item.tooltip = node.path ?? "";
    }
    return item;
  }

  async getChildren(): Promise<ToolsNode[]> {
    try {
      await findCli();
    } catch (err) {
      if (err instanceof CliNotFoundError) {
        return [{ error: "alloy CLI não instalado — clique para configurar" }];
      }
      throw err;
    }
    try {
      const { stdout } = await runCli(["setup", "--check", "--json"]);
      const envelope = JSON.parse(stdout) as { schema: string; tools: ToolRow[] };
      if (envelope.schema !== "alloy.setup.v1") {
        return [{ error: `envelope inesperado: ${envelope.schema}` }];
      }
      return envelope.tools;
    } catch (err) {
      return [{ error: (err as Error).message }];
    }
  }
}

export async function installTools(): Promise<void> {
  const cli = await findCli();
  const terminal = vscode.window.createTerminal({ name: "alloy setup" });
  terminal.show();
  terminal.sendText(`${/\s/.test(cli) ? `"${cli}"` : cli} setup`);
  void vscode.window.showInformationMessage(
    "Instalando toolchains no terminal — clique em ↻ no painel quando terminar.",
  );
}
