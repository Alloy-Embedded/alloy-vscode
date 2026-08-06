// THE seam between the extension and the alloy CLI. Everything the
// extension knows arrives through here: locate the binary, spawn verbs,
// parse versioned JSON envelopes. No domain logic lives in TypeScript
// (NORTH_STAR guardrail #1).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const execFileP = promisify(execFile);

export const output = vscode.window.createOutputChannel("Alloy");

export const MIN_CLI_VERSION = "0.1.0";

export interface BoardInfo {
  id: string;
  name: string;
  chip: string;
  probe: string | null;
  roles: string[];
}

export class CliNotFoundError extends Error {}

let cachedCliPath: string | null = null;

export function invalidateCliCache(): void {
  cachedCliPath = null;
}

/** Locate the alloy CLI: setting > uv tool shim > PATH. */
export async function findCli(): Promise<string> {
  if (cachedCliPath) {
    return cachedCliPath;
  }
  const configured = vscode.workspace.getConfiguration("alloy").get<string>("cliPath");
  const candidates = [
    ...(configured ? [configured] : []),
    path.join(os.homedir(), ".local", "bin", exeName("alloy")), // uv tool shims
    "alloy", // PATH
  ];
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileP(candidate, ["--version"], { timeout: 10_000 });
      // Handshake: OUR CLI prints a bare semver. A real-world collision
      // exists (the legacy ecosystem shipped an `alloy` printing
      // "alloy 0.5.1.dev10+…"), so exit-0 alone is not proof.
      const version = stdout.trim();
      if (!/^\d+\.\d+\.\d+$/.test(version) || !versionAtLeast(version, MIN_CLI_VERSION)) {
        output.appendLine(
          `rejected ${candidate}: --version printed "${version}" ` +
          `(want bare semver >= ${MIN_CLI_VERSION} — a legacy 'alloy' CLI?)`,
        );
        continue;
      }
      cachedCliPath = candidate;
      output.appendLine(`using CLI: ${candidate} (v${version})`);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new CliNotFoundError(
    "alloy CLI not found — run “Alloy: Setup Environment” or set alloy.cliPath",
  );
}

function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return true;
}

function exeName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run a CLI verb and return its output (throws with stderr on failure). */
export async function runCli(
  args: string[],
  cwd?: string,
): Promise<RunResult> {
  const cli = await findCli();
  output.appendLine(`$ ${cli} ${args.join(" ")}${cwd ? `  (cwd: ${cwd})` : ""}`);
  try {
    const { stdout, stderr } = await execFileP(cli, args, {
      cwd,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (err) {
    const anyErr = err as { stderr?: string; message: string };
    throw new Error(`${anyErr.stderr?.trim() || anyErr.message} (cli: ${cli})`);
  }
}

/** boards --json (alloy.boards.v1). */
export async function listBoards(cwd?: string): Promise<BoardInfo[]> {
  const { stdout } = await runCli(["boards", "--json"], cwd);
  const envelope = JSON.parse(stdout) as { schema: string; boards: BoardInfo[] };
  if (envelope.schema !== "alloy.boards.v1") {
    const cli = await findCli();
    throw new Error(
      `unsupported boards envelope "${envelope.schema}" from ${cli} — ` +
      "a legacy 'alloy' CLI may be shadowing the real one; set alloy.cliPath",
    );
  }
  return envelope.boards;
}

export interface LibraryInfo {
  name: string;
  category: string;
  summary: string;
  version: string;
  concepts: string[];
  source: string;
}

/** lib list --json (alloy.libs.v1) — the ecosystem driver registry. */
export async function listLibraries(cwd?: string): Promise<LibraryInfo[]> {
  const { stdout } = await runCli(["lib", "list", "--json"], cwd);
  const envelope = JSON.parse(stdout) as { schema: string; libraries: LibraryInfo[] };
  if (envelope.schema !== "alloy.libs.v1") {
    const cli = await findCli();
    throw new Error(
      `unsupported libraries envelope "${envelope.schema}" from ${cli} — ` +
      "an out-of-date alloy CLI? update with: uv tool upgrade alloy-embedded",
    );
  }
  return envelope.libraries;
}

export interface ChipInfo {
  id: string;
  vendor: string;
  chip: string;
  family: string;
  core: string | null;
}

/** chips --json (alloy.chips.v1) — every MCU you can scaffold a clean board for. */
export async function listChips(): Promise<ChipInfo[]> {
  const { stdout } = await runCli(["chips", "--json"]);
  const envelope = JSON.parse(stdout) as { schema: string; chips: ChipInfo[] };
  if (envelope.schema !== "alloy.chips.v1") {
    throw new Error(
      `unsupported chips envelope "${envelope.schema}" — update the alloy CLI ` +
      "(uv tool upgrade alloy-embedded)",
    );
  }
  return envelope.chips;
}

export interface PinFunction {
  peripheral: string;
  signal: string;
  af?: number;
}

export interface PinInfo {
  name: string;
  port: string | null;
  index: number | null;
  functions: PinFunction[];
}

export interface ChipDetail {
  chip: string;
  family: string | null;
  clock_profiles: { name: string; description: string; sysclk_hz: number | null }[];
  boot_profile: string | null;
  gpio_pins: string[];
  /** Per-pin function map (CubeMX-style picker data). Absent on pre-pins CLIs. */
  pins?: PinInfo[];
  peripherals: {
    debug_uart: { peripheral: string; tx?: string; rx?: string }[];
    i2c: { peripheral: string; scl?: string; sda?: string }[];
    spi: { peripheral: string; sck?: string; mosi?: string; miso?: string }[];
  };
}

/** chip-info <chip> — clock profiles + pins + peripherals for the visual editor. */
export async function chipInfo(chip: string, cwd?: string): Promise<ChipDetail> {
  const { stdout } = await runCli(["chip-info", chip], cwd);
  const info = JSON.parse(stdout) as ChipDetail & { schema: string };
  if ((info as { schema: string }).schema !== "alloy.chip_info.v1") {
    throw new Error("unsupported chip-info envelope — update the alloy CLI");
  }
  return info;
}

/** The board currently selected in the workspace's alloy.toml. */
export function currentBoard(workspaceRoot: string): string | null {
  const tomlPath = path.join(workspaceRoot, "alloy.toml");
  if (!fs.existsSync(tomlPath)) {
    return null;
  }
  const text = fs.readFileSync(tomlPath, "utf8");
  const match = /\[board\]\s*\n\s*id\s*=\s*"([^"]+)"/.exec(text);
  return match ? match[1] : null;
}

export function workspaceRoot(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }
  return fs.existsSync(path.join(folder.uri.fsPath, "alloy.toml"))
    ? folder.uri.fsPath
    : null;
}
