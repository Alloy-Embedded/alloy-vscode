// Visual board configurator — a webview form for the clock, LED, and bus pins,
// so a beginner never hand-edits board.json. It reads the project's local board
// (only custom boards are editable), asks the CLI for the chip's options
// (`alloy chip-info`), renders a form, and writes the roles back on save.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ChipDetail, chipInfo, currentBoard, workspaceRoot } from "./cli";

interface Board {
  schema?: string;
  id: string;
  name?: string;
  chip: string;
  clock_profile?: string;
  roles?: Record<string, Record<string, unknown>>;
}

function localBoardPath(root: string): string | null {
  const id = currentBoard(root);
  if (!id) {
    return null;
  }
  const p = path.join(root, "boards", id, "board.json");
  return fs.existsSync(p) ? p : null;
}

export async function configureBoard(refresh: () => void): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  const boardPath = localBoardPath(root);
  if (!boardPath) {
    void vscode.window.showInformationMessage(
      "The visual editor works on custom boards. Create one with New Project → “Custom board — choose an MCU”.",
    );
    return;
  }
  const board = JSON.parse(fs.readFileSync(boardPath, "utf8")) as Board;
  const info = await chipInfo(board.chip, root);

  const panel = vscode.window.createWebviewPanel(
    "alloyBoardConfig",
    `Configure ${board.id}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html = renderHtml(board, info);

  panel.webview.onDidReceiveMessage((msg: { type: string; config?: FormConfig }) => {
    if (msg.type === "save" && msg.config) {
      writeBoard(boardPath, board, info, msg.config);
      refresh();
      void vscode.window.showInformationMessage(
        `Board “${board.id}” updated — build to pick up the changes.`,
      );
      panel.dispose();
    }
  });
}

interface FormConfig {
  clock: string;
  led: { on: boolean; pin: string; active: string };
  uart: { on: boolean; peripheral: string; baud: number };
  i2c: { on: boolean; peripheral: string };
}

function writeBoard(boardPath: string, board: Board, info: ChipDetail, cfg: FormConfig): void {
  board.clock_profile = cfg.clock;
  const roles: Record<string, Record<string, unknown>> = {};
  if (cfg.led.on && cfg.led.pin) {
    roles.led = { pin: cfg.led.pin, active: cfg.led.active };
  }
  if (cfg.uart.on && cfg.uart.peripheral) {
    const u = info.peripherals.debug_uart.find((x) => x.peripheral === cfg.uart.peripheral);
    roles.debug_uart = { peripheral: cfg.uart.peripheral, baud: cfg.uart.baud, ...(u?.tx ? { tx: u.tx } : {}), ...(u?.rx ? { rx: u.rx } : {}) };
  }
  if (cfg.i2c.on && cfg.i2c.peripheral) {
    const b = info.peripherals.i2c.find((x) => x.peripheral === cfg.i2c.peripheral);
    roles.i2c = { peripheral: cfg.i2c.peripheral, ...(b?.scl ? { scl: b.scl } : {}), ...(b?.sda ? { sda: b.sda } : {}) };
  }
  board.roles = roles;
  fs.writeFileSync(boardPath, JSON.stringify(board, null, 2) + "\n");
}

function mhz(hz: number | null): string {
  return hz ? `${Math.round(hz / 1_000_000)} MHz` : "?";
}

function renderHtml(board: Board, info: ChipDetail): string {
  const nonce = String(Math.random()).slice(2);
  const roles = board.roles ?? {};
  const led = roles.led ?? {};
  const uart = roles.debug_uart ?? {};
  const i2c = roles.i2c ?? {};

  const clockOptions = info.clock_profiles
    .map((p) => `<option value="${p.name}" ${p.name === board.clock_profile ? "selected" : ""}>${mhz(p.sysclk_hz)} — ${esc(p.description || p.name)}</option>`)
    .join("");
  const pinOptions = (sel: unknown) =>
    info.gpio_pins.map((p) => `<option value="${p}" ${p === sel ? "selected" : ""}>${p}</option>`).join("");
  const uartOptions = info.peripherals.debug_uart
    .map((u) => `<option value="${u.peripheral}" ${u.peripheral === uart.peripheral ? "selected" : ""}>${u.peripheral}${u.tx ? ` (tx ${u.tx} / rx ${u.rx})` : ""}</option>`)
    .join("");
  const i2cOptions = info.peripherals.i2c
    .map((b) => `<option value="${b.peripheral}" ${b.peripheral === i2c.peripheral ? "selected" : ""}>${b.peripheral}${b.scl ? ` (scl ${b.scl} / sda ${b.sda})` : ""}</option>`)
    .join("");

  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px 20px;font-size:13px}
  h1{font-size:18px;font-weight:500;margin:0 0 2px}
  .sub{color:var(--vscode-descriptionForeground);margin:0 0 18px}
  fieldset{border:1px solid var(--vscode-panel-border);border-radius:6px;margin:0 0 14px;padding:12px 14px}
  legend{padding:0 6px;font-weight:500}
  label{display:block;margin:8px 0 3px;color:var(--vscode-descriptionForeground)}
  select,input[type=number]{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;padding:5px 8px;font-family:inherit;font-size:13px}
  .row{display:flex;gap:14px}.row>div{flex:1}
  .toggle{display:flex;align-items:center;gap:8px;color:var(--vscode-foreground);margin:0}
  .body.off{opacity:.4;pointer-events:none}
  button{margin-top:6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:8px 18px;font-size:13px;cursor:pointer}
  button:hover{background:var(--vscode-button-hoverBackground)}
  code{color:var(--vscode-textPreformat-foreground)}
</style></head><body>
<h1>Configure ${esc(board.id)}</h1>
<p class="sub">${esc(board.chip)}${info.family ? ` · ${esc(info.family)}` : ""}</p>

<fieldset><legend>System clock</legend>
  <label>Clock profile</label>
  <select id="clock">${clockOptions}</select>
</fieldset>

<fieldset><legend>LED</legend>
  <label class="toggle"><input type="checkbox" id="led_on" ${roles.led ? "checked" : ""}> Enable LED (for blink)</label>
  <div class="body" id="led_body">
    <div class="row">
      <div><label>GPIO pin</label><select id="led_pin">${pinOptions(led.pin)}</select></div>
      <div><label>Active level</label><select id="led_active">
        <option value="high" ${led.active !== "low" ? "selected" : ""}>Active high</option>
        <option value="low" ${led.active === "low" ? "selected" : ""}>Active low</option>
      </select></div>
    </div>
  </div>
</fieldset>

<fieldset><legend>Debug UART</legend>
  <label class="toggle"><input type="checkbox" id="uart_on" ${roles.debug_uart ? "checked" : ""} ${uartOptions ? "" : "disabled"}> Enable serial console</label>
  <div class="body" id="uart_body">
    <div class="row">
      <div><label>Peripheral</label><select id="uart_periph">${uartOptions || "<option>none available</option>"}</select></div>
      <div><label>Baud</label><input type="number" id="uart_baud" value="${Number(uart.baud) || 115200}"></div>
    </div>
  </div>
</fieldset>

<fieldset><legend>I²C</legend>
  <label class="toggle"><input type="checkbox" id="i2c_on" ${roles.i2c ? "checked" : ""} ${i2cOptions ? "" : "disabled"}> Enable I²C</label>
  <div class="body" id="i2c_body">
    <label>Peripheral</label><select id="i2c_periph">${i2cOptions || "<option>none available</option>"}</select>
  </div>
</fieldset>

<button id="save">Save board</button>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  function sync(box, body){ $(body).classList.toggle('off', !$(box).checked); }
  const pairs = [['led_on','led_body'],['uart_on','uart_body'],['i2c_on','i2c_body']];
  for (const [b,d] of pairs){ sync(b,d); $(b).addEventListener('change',()=>sync(b,d)); }
  $('save').addEventListener('click',()=>{
    vscode.postMessage({ type:'save', config:{
      clock: $('clock').value,
      led: { on: $('led_on').checked, pin: $('led_pin').value, active: $('led_active').value },
      uart: { on: $('uart_on').checked, peripheral: $('uart_periph').value, baud: Number($('uart_baud').value)||115200 },
      i2c: { on: $('i2c_on').checked, peripheral: $('i2c_periph').value },
    }});
  });
</script></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
