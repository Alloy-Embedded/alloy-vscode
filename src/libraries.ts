// Libraries view + "Add Library" — the driver ecosystem, browsable and
// one-click installable. Pure presentation: the registry and the vendoring both
// come from the CLI (`alloy lib list --json`, `alloy lib add`).

import * as vscode from "vscode";
import { LibraryInfo, listLibraries, runCli, workspaceRoot } from "./cli";

type LibNode =
  | { kind: "category"; name: string; libs: LibraryInfo[] }
  | { kind: "lib"; lib: LibraryInfo }
  | { kind: "error"; message: string };

export class LibrariesProvider implements vscode.TreeDataProvider<LibNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(node: LibNode): vscode.TreeItem {
    if (node.kind === "error") {
      const item = new vscode.TreeItem(node.message);
      item.iconPath = new vscode.ThemeIcon("warning");
      return item;
    }
    if (node.kind === "category") {
      const item = new vscode.TreeItem(
        node.name,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("folder-library");
      item.description = `${node.libs.length}`;
      return item;
    }
    const { lib } = node;
    const item = new vscode.TreeItem(lib.name);
    item.description = lib.summary;
    item.tooltip = `${lib.summary}\nconcepts: ${lib.concepts.join(", ")}\nversion ${lib.version}`;
    item.iconPath = new vscode.ThemeIcon("library");
    // Clicking a library adds THAT one (the palette command adds via a picker).
    item.command = {
      command: "alloy.addLibrary",
      title: "Add Library",
      arguments: [lib.name],
    };
    return item;
  }

  async getChildren(node?: LibNode): Promise<LibNode[]> {
    if (node) {
      return node.kind === "category" ? node.libs.map((lib) => ({ kind: "lib", lib })) : [];
    }
    try {
      const libs = await listLibraries(workspaceRoot() ?? undefined);
      const byCategory = new Map<string, LibraryInfo[]>();
      for (const lib of libs) {
        const list = byCategory.get(lib.category) ?? [];
        list.push(lib);
        byCategory.set(lib.category, list);
      }
      return [...byCategory.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, group]) => ({ kind: "category", name, libs: group }));
    } catch (err) {
      return [{ kind: "error", message: (err as Error).message }];
    }
  }
}

/**
 * Add a library to the current project. With `name`, adds it directly (tree
 * click); without, shows a picker (command palette / view title button).
 */
export async function addLibrary(refresh: () => void, name?: string): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }

  let chosen = name;
  if (!chosen) {
    const libs = await listLibraries(root);
    const picked = await vscode.window.showQuickPick(
      libs.map((l) => ({
        label: l.name,
        description: `${l.category} · v${l.version}`,
        detail: l.summary,
        name: l.name,
      })),
      { placeHolder: "Add a driver to this project", matchOnDetail: true },
    );
    if (!picked) {
      return;
    }
    chosen = picked.name;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Adding ${chosen}…` },
    () => runCli(["lib", "add", chosen as string], root),
  );
  refresh();
  void vscode.window.showInformationMessage(
    `Added ${chosen} — include it with #include <${chosen}.hpp> (namespace alloy::lib).`,
  );
}
