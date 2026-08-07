// Activity-bar sidebar: project actions + toolchain status. Pure
// presentation — every fact comes from the CLI (setup --check --json).

import * as vscode from "vscode";
import {
  CliNotFoundError, CliOutdatedError, currentBoard, findCli, runCli, sizeReport,
  workspaceRoot,
} from "./cli";

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
  { label: "Configure Board", icon: "settings-gear", command: "alloy.configureBoard", needsProject: true },
  { label: "Build", icon: "tools", command: "alloy.build", needsProject: true },
  // The framework's own claim, as a button: the same sources on every board.
  { label: "Build All Boards", icon: "checklist", command: "alloy.buildAll", needsProject: true },
  { label: "Memory & Partitions", icon: "server", command: "alloy.memory", needsProject: true },
  { label: "Flash", icon: "zap", command: "alloy.flash", needsProject: true },
  { label: "Update Device (UART)", icon: "cloud-upload", command: "alloy.updateDevice", needsProject: true },
  { label: "Run (Flash + Monitor)", icon: "vm-running", command: "alloy.run", needsProject: true },
  { label: "Monitor", icon: "pulse", command: "alloy.monitor", needsProject: true },
  { label: "Monitor Panel (filter + plot)", icon: "graph-line",
    command: "alloy.monitorPanel", needsProject: true },
  // Run the firmware with no hardware attached — nothing else in this space
  // can do it, and until now it had no button.
  { label: "Emulate (Renode)", icon: "play-circle", command: "alloy.emulate", needsProject: true },
  { label: "Debug", icon: "debug-alt", command: "alloy.debug", needsProject: true },
  { label: "Clean", icon: "trash", command: "alloy.clean", needsProject: true },
  { label: "Generate launch.json", icon: "json", command: "alloy.generateLaunchJson", needsProject: true },
  { label: "Generate CI Workflow", icon: "github-action", command: "alloy.ciInit", needsProject: true },
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

// ---- Memory view ---------------------------------------------------------
// What the last build costs. The build already ran `size`; this keeps the
// number on screen instead of letting it scroll away in the terminal, and
// against the chip's REAL memories so "is this close to full?" is answerable
// at a glance. Reads a built ELF — never triggers a compile.

interface MemRow {
  label: string;
  detail: string;
  icon: string;
  warn?: boolean;
  command?: string;
}

function bar(percent: number | null): string {
  if (percent === null) {
    return "";
  }
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${percent.toFixed(1)}%`;
}

function kb(bytes: number | null): string {
  if (bytes === null) {
    return "?";
  }
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}K` : `${bytes} B`;
}

export class MemoryProvider implements vscode.TreeDataProvider<MemRow> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(row: MemRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label);
    item.description = row.detail;
    item.iconPath = new vscode.ThemeIcon(
      row.icon,
      row.warn ? new vscode.ThemeColor("errorForeground") : undefined);
    item.tooltip = `${row.label} ${row.detail}`;
    if (row.command) {
      item.command = { command: row.command, title: row.label };
    }
    return item;
  }

  async getChildren(): Promise<MemRow[]> {
    const root = workspaceRoot();
    if (!root) {
      return [];
    }
    let report;
    try {
      report = await sizeReport(root);
    } catch (err) {
      return [{ label: "size unavailable", detail: (err as Error).message, icon: "warning" }];
    }
    if (!report.available) {
      return [{
        label: report.reason ?? "no build yet",
        detail: "click to build",
        icon: "circle-outline",
        command: "alloy.build",
      }];
    }
    const rows: MemRow[] = [
      {
        label: `Flash  ${kb(report.flash.used)} / ${kb(report.flash.total)}`,
        detail: bar(report.flash.percent),
        icon: "chip",
        warn: (report.flash.percent ?? 0) > 90,
      },
      {
        label: `RAM  ${kb(report.ram.used)} / ${kb(report.ram.total)}`,
        detail: bar(report.ram.percent),
        icon: "server",
        warn: (report.ram.percent ?? 0) > 90,
      },
    ];
    // Update slots: the number that decides whether a field update can ship.
    for (const region of report.slots?.regions ?? []) {
      if (region.fits === null) {
        continue;
      }
      rows.push({
        label: `${region.name}  ${kb(region.size)}`,
        detail: region.fits
          ? `image ${kb(report.slots?.image_bytes ?? null)} — fits`
          : `image ${kb(report.slots?.image_bytes ?? null)} — TOO BIG`,
        icon: region.fits ? "package" : "error",
        warn: !region.fits,
      });
    }
    return rows;
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

type ToolsNode = ToolRow | { error: string; action?: string };

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
      item.command = { command: node.action ?? "alloy.setup", title: "Fix" };
      return item;
    }
    const item = new vscode.TreeItem(node.tool);
    if (node.status === "missing") {
      item.iconPath = new vscode.ThemeIcon(
        "error", new vscode.ThemeColor("errorForeground"));
      item.description = node.kind === "system" ? node.remedy : "missing — click to install";
      item.tooltip = node.remedy ?? `install with: alloy setup`;
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
      if (err instanceof CliOutdatedError) {
        return [{ error: err.message, action: "alloy.upgradeCli" }];
      }
      if (err instanceof CliNotFoundError) {
        return [{ error: "alloy CLI not installed — click to set up" }];
      }
      throw err;
    }
    try {
      const { stdout } = await runCli(["setup", "--check", "--json"]);
      const envelope = JSON.parse(stdout) as { schema: string; tools: ToolRow[] };
      if (envelope.schema !== "alloy.setup.v1") {
        return [{ error: `unexpected envelope: ${envelope.schema}` }];
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
    "Installing toolchains in the terminal — click the ↻ in the panel when it finishes.",
  );
}
