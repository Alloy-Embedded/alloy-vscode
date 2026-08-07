// ARM debug via Cortex-Debug: facts come from `alloy debug-info --json`
// (servertype/configFiles/device — CLI-owned knowledge); the extension
// starts a DYNAMIC session so no user file is rewritten. "Generate
// launch.json" exists for users who want the file (explicit, one-shot).

import * as vscode from "vscode";
import { output, runCli, workspaceRoot } from "./cli";

const CORTEX_DEBUG_ID = "marus25.cortex-debug";

interface DebugInfo {
  schema: string;
  board: string;
  chip: string;
  elf: string | null;
  supported: boolean;
  servertype?: string;
  interface_cfg?: string;
  target_cfg?: string;
  device?: string;
  reason?: string;
}

async function fetchDebugInfo(root: string): Promise<DebugInfo> {
  const { stdout } = await runCli(["debug-info", "--json"], root);
  const info = JSON.parse(stdout) as DebugInfo;
  if (info.schema !== "alloy.debug_info.v1") {
    throw new Error(`unsupported debug-info envelope: ${info.schema}`);
  }
  return info;
}

async function ensureCortexDebug(): Promise<boolean> {
  if (vscode.extensions.getExtension(CORTEX_DEBUG_ID)) {
    return true;
  }
  const choice = await vscode.window.showInformationMessage(
    "ARM debugging uses the Cortex-Debug extension. Install it?",
    "Install",
    "Cancel",
  );
  if (choice !== "Install") {
    return false;
  }
  await vscode.commands.executeCommand(
    "workbench.extensions.installExtension",
    CORTEX_DEBUG_ID,
  );
  return true;
}

/** Relative to the project, so the generated launch.json stays portable. */
const SVD_PATH = ".alloy/registers.svd";

/**
 * Write a CMSIS-SVD for the board's chip so the debugger can show peripheral
 * registers by name. The data is already curated in alloy-devices; this only
 * asks for it. Returns null when the chip is not something SVD describes (a
 * non-ARM core) — debugging still works, just without the register view.
 */
async function ensureSvd(root: string): Promise<string | null> {
  try {
    await runCli(["svd", "-o", SVD_PATH], root);
    return SVD_PATH;
  } catch (err) {
    output.appendLine(`no register view: ${(err as Error).message}`);
    return null;
  }
}

function toLaunchConfig(info: DebugInfo, svd: string | null): vscode.DebugConfiguration {
  return {
    name: `Alloy: ${info.board}`,
    type: "cortex-debug",
    request: "launch",
    cwd: "${workspaceFolder}",
    executable: info.elf,
    servertype: info.servertype,
    device: info.device,
    configFiles: [info.interface_cfg, info.target_cfg],
    runToEntryPoint: "main",
    ...(svd ? { svdFile: "${workspaceFolder}/" + svd } : {}),
  };
}

export async function startDebug(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  let info = await fetchDebugInfo(root);
  if (!info.supported) {
    void vscode.window.showWarningMessage(
      `Alloy: debug not available for ${info.board} — ${info.reason}`,
    );
    return;
  }
  if (!(await ensureCortexDebug())) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Alloy: building…" },
    () => runCli(["build"], root),
  );
  info = await fetchDebugInfo(root); // elf path exists now
  if (!info.elf) {
    throw new Error("build did not produce an ELF (see the alloy terminal)");
  }
  const svd = await ensureSvd(root);
  const folder = vscode.workspace.workspaceFolders?.[0];
  await vscode.debug.startDebugging(folder, toLaunchConfig(info, svd));
}

export async function generateLaunchJson(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  const info = await fetchDebugInfo(root);
  if (!info.supported) {
    void vscode.window.showWarningMessage(
      `Alloy: debug not available for ${info.board} — ${info.reason}`,
    );
    return;
  }
  const config = toLaunchConfig(info, await ensureSvd(root));
  // Make the file board-agnostic where we can: elf under the per-board tree.
  config.executable =
    "${workspaceFolder}/.alloy/build-tree/" + info.board + "/out/" +
    (info.elf ? info.elf.split("/").pop() : "app.elf");
  const launch = vscode.workspace.getConfiguration("launch",
    vscode.workspace.workspaceFolders?.[0]);
  const existing = launch.get<vscode.DebugConfiguration[]>("configurations") ?? [];
  const filtered = existing.filter((c) => c.name !== config.name);
  await launch.update("configurations", [...filtered, config],
    vscode.ConfigurationTarget.WorkspaceFolder);
  void vscode.window.showInformationMessage(
    `Alloy: launch configuration "${config.name}" written to .vscode/launch.json`,
  );
}
