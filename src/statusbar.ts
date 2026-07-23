// PlatformIO-style status bar: board picker + one-click build/flash/monitor.

import * as vscode from "vscode";
import { currentBoard, workspaceRoot } from "./cli";

export class AlloyStatusBar {
  private readonly board: vscode.StatusBarItem;
  private readonly actions: vscode.StatusBarItem[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.board = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 52);
    this.board.command = "alloy.pickBoard";
    this.board.tooltip = "Alloy: pick board";
    context.subscriptions.push(this.board);

    const specs: Array<[string, string, string]> = [
      ["$(tools)", "alloy.build", "Alloy: build"],
      ["$(zap)", "alloy.flash", "Alloy: flash"],
      ["$(vm-running)", "alloy.run", "Alloy: run (flash + monitor)"],
      ["$(pulse)", "alloy.monitor", "Alloy: monitor"],
    ];
    let priority = 51;
    for (const [icon, command, tooltip] of specs) {
      const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left, priority--);
      item.text = icon;
      item.command = command;
      item.tooltip = tooltip;
      context.subscriptions.push(item);
      this.actions.push(item);
    }
  }

  refresh(): void {
    const root = workspaceRoot();
    if (!root) {
      this.board.hide();
      for (const item of this.actions) {
        item.hide();
      }
      return;
    }
    const board = currentBoard(root);
    this.board.text = `$(circuit-board) ${board ?? "pick board"}`;
    this.board.show();
    for (const item of this.actions) {
      item.show();
    }
  }
}
