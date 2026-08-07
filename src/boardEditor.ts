// The board configurator, host side.
//
// This file is now only a shell and a message loop: it fetches the three CLI
// payloads, serves a page that loads the separately-bundled webview app, and
// answers what that app asks for. Every chip fact still comes from the CLI, and
// all rendering lives in src/webview/editor.ts where it can be tested.
//
// Two rules shape the behaviour:
//
//  1. Any board opens. A curated one is read-only — rewriting it would change
//     every project that uses it — with a one-click "duplicate to edit".
//  2. Saving does not close the panel. It writes, re-runs validation, and sends
//     the result back, so fixing a problem is a loop instead of a reopen.

import * as fs from "node:fs";
import * as vscode from "vscode";
import { BoardJson, EditorData } from "./shared/board";
import {
  boardInfo, chipInfo, clockGraph, cloneBoard, currentBoard, workspaceRoot,
} from "./cli";

export async function configureBoard(refresh: () => void): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  const detail = await boardInfo(currentBoard(root) ?? undefined, root);
  const chip = await chipInfo(detail.chip, root);
  const board = JSON.parse(fs.readFileSync(detail.path, "utf8")) as BoardJson;

  const panel = vscode.window.createWebviewPanel(
    "alloyBoardConfig",
    `${detail.editable ? "Configure" : "View"} ${detail.id}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri(), "dist"),
                           vscode.Uri.joinPath(extensionUri(), "media")],
    },
  );
  panel.webview.html = shellHtml(panel.webview, { detail, chip, board });

  panel.webview.onDidReceiveMessage(async (msg: {
    type: string; mhz?: number; profile?: string; board?: BoardJson;
  }) => {
    if (msg.type === "clockGraph") {
      // One call returns the whole tree AND, for a solved frequency, the
      // profile to write into board.json.
      try {
        const graph = await clockGraph(
          detail.chip, { mhz: msg.mhz, profile: msg.profile }, root);
        void panel.webview.postMessage({ type: "clockGraph", graph });
      } catch (err) {
        void panel.webview.postMessage({ type: "clockError", message: (err as Error).message });
      }
      return;
    }

    if (msg.type === "duplicate") {
      const newId = await vscode.window.showInputBox({
        prompt: `Name for your editable copy of ${detail.id}`,
        value: `${detail.id}_custom`,
        validateInput: (v) =>
          /^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)
            ? null : "letters, digits and _ (must start with a letter)",
      });
      if (!newId) {
        return;
      }
      await cloneBoard(detail.id, newId, root);
      panel.dispose();
      refresh();
      void vscode.window.showInformationMessage(
        `Board “${newId}” is now yours to edit.`);
      await configureBoard(refresh);
      return;
    }

    if (msg.type === "save" && msg.board) {
      if (!detail.editable) {
        void vscode.window.showWarningMessage(
          `${detail.id} is a framework board — duplicate it to make changes.`);
        return;
      }
      fs.writeFileSync(detail.path, `${JSON.stringify(msg.board, null, 2)}\n`);
      refresh();
      // The emitter is the judge: re-read the board and send back what it now
      // thinks, so the panel shows the result of the edit that was just made.
      const after = await boardInfo(detail.id, root);
      void panel.webview.postMessage({ type: "validated", issues: after.issues });
    }
  });
}

function extensionUri(): vscode.Uri {
  const ext = vscode.extensions.getExtension("alloy-embedded.alloy-vscode");
  if (!ext) {
    throw new Error("alloy extension not found — cannot resolve its resources");
  }
  return ext.extensionUri;
}

function mhz(hz: number | null): string {
  return hz ? `${Math.round(hz / 1_000_000)} MHz` : "?";
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/**
 * The static page. Everything dynamic is rendered by the webview bundle from
 * the payload below; this only lays out the containers it fills.
 */
function shellHtml(webview: vscode.Webview, data: EditorData): string {
  const nonce = Array.from({ length: 32 },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri(), "dist", "webview.js"));
  const style = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri(), "media", "board-editor.css"));

  const { detail, chip, board } = data;
  const readOnly = !detail.editable;
  const isCustom = !!board.clock;
  const pinCount = (chip.pins ?? []).length;
  const clockOptions = chip.clock_profiles
    .map((p) => `<option value="${esc(p.name)}"`
      + `${p.name === board.clock_profile ? " selected" : ""}>`
      + `${mhz(p.sysclk_hz)} — ${esc(p.description || p.name)}</option>`)
    .join("");
  const currentMhz = board.clock && typeof board.clock.sysclk_hz === "number"
    ? Math.round((board.clock.sysclk_hz as number) / 1_000_000) : 64;

  const csp = `default-src 'none'; style-src ${webview.cspSource}; `
    + `script-src 'nonce-${nonce}'; img-src ${webview.cspSource};`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${style}">
</head><body>
<h1>${readOnly ? "View" : "Configure"} ${esc(detail.id)}</h1>
<p class="sub">${esc(detail.chip)}${detail.part ? ` · ${esc(detail.part)}` : ""}`
    + `${pinCount ? ` · ${pinCount} pins in data` : ""} · ${esc(detail.source)} board</p>

<div id="issues"></div>
${readOnly ? `<div class="banner">
  <div><b>${esc(detail.id)} is a framework board — read-only.</b>
  Editing it would change every project that uses it. Duplicate it to get an
  editable copy with all of these settings already filled in.</div>
  <button id="duplicate">Duplicate to edit</button>
</div>` : ""}

<div class="cols">
<div>
<fieldset><legend>Pinout</legend>
${pinCount ? `
  <div class="filters">
    <input type="search" id="search" placeholder="search pins or functions…">
    <select id="periph_filter"></select>
  </div>
  <div class="legendrow">
    <span><span class="dot" style="background:var(--vscode-charts-green,#2e7d32)"></span>GPIO</span>
    <span><span class="dot" style="background:var(--vscode-charts-blue,#1565c0)"></span>Alternate function</span>
    <span><span class="dot" style="background:var(--vscode-charts-purple,#6a1b9a)"></span>Board role (locked)</span>
    <span><span class="dot" style="background:var(--vscode-editorError-foreground,#f14c4c)"></span>Problem</span>
  </div>
  <div id="pin_map"></div>
  <div class="hint">Click a pin to assign a function and a name. Role pins are managed in the role panels.</div>
` : `<p>This CLI predates the per-pin map — update alloy (uv tool upgrade alloy-embedded).</p>`}
</fieldset>

<fieldset id="pin_detail"><legend>Pin</legend>
  <p id="pd_empty">Select a pin on the left.</p>
  <div id="pd_body" style="display:none">
    <div class="row">
      <div><label>Pin</label><div id="pd_name" style="font-weight:600;font-size:15px;padding:3px 0">—</div></div>
      <div><label>Function</label><select id="pd_fn"></select></div>
    </div>
    <label>Name (optional — becomes a code alias)</label>
    <input type="text" id="pd_label" placeholder="e.g. LED_STATUS">
    <div class="row" style="margin-top:10px">
      <div><button id="pd_apply" style="width:100%"${readOnly ? " disabled" : ""}>Apply</button></div>
      <div><button id="pd_clear" class="secondary" style="width:100%"${readOnly ? " disabled" : ""}>Clear pin</button></div>
    </div>
  </div>
</fieldset>

<fieldset><legend>System clock</legend>
  <label>Source</label>
  <select id="clock_mode"${readOnly ? " disabled" : ""}>
    <option value="preset"${isCustom ? "" : " selected"}>Preset profile</option>
    <option value="custom"${isCustom ? " selected" : ""}>Custom PLL — any frequency</option>
  </select>
  <div id="preset_body" class="${isCustom ? "off" : ""}">
    <label>Profile</label>
    <select id="clock"${readOnly ? " disabled" : ""}>${clockOptions}</select>
  </div>
  <div id="custom_body" class="${isCustom ? "" : "off"}">
    <div class="row">
      <div><label>Target frequency (MHz)</label>
        <input type="number" id="target_mhz" value="${currentMhz}" min="1"${readOnly ? " disabled" : ""}></div>
      <div style="display:flex;align-items:flex-end">
        <button id="compute" style="width:100%"${readOnly ? " disabled" : ""}>Compute PLL</button></div>
    </div>
    <div id="clock_status" class="hint">${
      isCustom ? esc(String(board.clock?.description ?? "")) : "Enter a frequency and compute."}</div>
  </div>
  <div id="clock_tree"></div>
</fieldset>
</div>

<div>
<div id="roles"></div>
${readOnly ? "" : `<div class="savebar">
  <button id="save">Apply to board.json</button>
  <span id="status" class="status"></span>
</div>`}
</div>
</div>

<script nonce="${nonce}">window.__ALLOY__ = ${
  JSON.stringify(data).replace(/</g, "\\u003c")};</script>
<script nonce="${nonce}" src="${script}"></script>
</body></html>`;
}
