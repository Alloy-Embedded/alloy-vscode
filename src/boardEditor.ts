// Visual chip/board configurator — the CubeMX-style webview: an interactive
// per-port PIN MAP (click a pin, pick its function from the chip's real route
// table, give it a name), a CLOCK TREE that renders the parametric PLL solve as
// a diagram, and the role toggles (LED / debug UART / I²C). Only custom
// (project-local) boards are editable; everything is written back to board.json
// and the CLI remains the single source of truth for all chip facts
// (`alloy chip-info`, `alloy clock`).
//
// The pin map shows exactly what the data knows: builder-generated chips carry
// their full AF matrix, hand-curated ones their curated subset — never a guessed
// pinout. Pins consumed by a role (LED, UART tx/rx, I²C scl/sda) are marked and
// locked in the map; free pins accept GPIO in/out or any listed function plus a
// user label (stored in board.json "pins"; codegen aliases are the emitter's
// follow-up).

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { ChipDetail, chipInfo, currentBoard, runCli, workspaceRoot } from "./cli";

interface PinAssign {
  function: string; // "gpio_out" | "gpio_in" | "<peripheral>:<signal>"
  label?: string;
}

interface Board {
  schema?: string;
  id: string;
  name?: string;
  chip: string;
  clock_profile?: string;
  clock?: Record<string, unknown>;
  roles?: Record<string, Record<string, unknown>>;
  pins?: Record<string, PinAssign>;
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

  panel.webview.onDidReceiveMessage(async (msg: { type: string; config?: FormConfig; mhz?: number }) => {
    if (msg.type === "solveClock" && typeof msg.mhz === "number") {
      try {
        const { stdout } = await runCli(["clock", "--chip", board.chip, "--mhz", String(msg.mhz)], root);
        void panel.webview.postMessage({ type: "clockResult", result: JSON.parse(stdout) });
      } catch (err) {
        void panel.webview.postMessage({ type: "clockError", message: (err as Error).message });
      }
    } else if (msg.type === "save" && msg.config) {
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
  clock: { mode: "preset" | "custom"; profile: string; custom?: Record<string, unknown> };
  led: { on: boolean; pin: string; active: string };
  uart: { on: boolean; peripheral: string; baud: number };
  i2c: { on: boolean; peripheral: string };
  pins: Record<string, PinAssign>;
}

function writeBoard(boardPath: string, board: Board, info: ChipDetail, cfg: FormConfig): void {
  if (cfg.clock.mode === "custom" && cfg.clock.custom) {
    board.clock = cfg.clock.custom;          // inline solved PLL profile
    board.clock_profile = "custom";
  } else {
    delete board.clock;
    board.clock_profile = cfg.clock.profile; // a named chip profile
  }
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
  if (Object.keys(cfg.pins).length > 0) {
    board.pins = cfg.pins;
  } else {
    delete board.pins;
  }
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
  const isCustom = !!board.clock;

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
  const curMhz = board.clock && typeof board.clock.sysclk_hz === "number"
    ? Math.round((board.clock.sysclk_hz as number) / 1_000_000) : 64;

  // Data the pin map runs on (older CLIs without "pins" degrade to no map).
  const pinData = info.pins ?? [];
  const havePinMap = pinData.length > 0;

  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:14px 18px;font-size:13px}
  h1{font-size:18px;font-weight:500;margin:0 0 2px}
  .sub{color:var(--vscode-descriptionForeground);margin:0 0 14px}
  .cols{display:grid;grid-template-columns:minmax(340px,1fr) minmax(340px,1fr);gap:16px;align-items:start}
  fieldset{border:1px solid var(--vscode-panel-border);border-radius:6px;margin:0 0 14px;padding:12px 14px}
  legend{padding:0 6px;font-weight:500}
  label{display:block;margin:8px 0 3px;color:var(--vscode-descriptionForeground)}
  select,input[type=number],input[type=text]{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:3px;padding:5px 8px;font-family:inherit;font-size:13px}
  .row{display:flex;gap:14px}.row>div{flex:1}
  .toggle{display:flex;align-items:center;gap:8px;color:var(--vscode-foreground);margin:0}
  .off{opacity:.4;pointer-events:none}
  button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:8px 18px;font-size:13px;cursor:pointer}
  button:hover{background:var(--vscode-button-hoverBackground)}
  button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
  .warn{color:var(--vscode-editorWarning-foreground,#cca700)}
  .save{margin-top:6px}
  /* ── pin map ── */
  .port{margin:0 0 10px}
  .portname{font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--vscode-descriptionForeground);margin-bottom:4px}
  .pins{display:flex;flex-wrap:wrap;gap:4px}
  .pin{min-width:44px;text-align:center;padding:5px 4px;border-radius:4px;border:1px solid var(--vscode-panel-border);cursor:pointer;font-size:11px;background:transparent;color:var(--vscode-foreground)}
  .pin:hover{border-color:var(--vscode-focusBorder)}
  .pin.sel{outline:2px solid var(--vscode-focusBorder)}
  .pin.gpio{background:var(--vscode-charts-green,#2e7d32);color:#fff;border-color:transparent}
  .pin.af{background:var(--vscode-charts-blue,#1565c0);color:#fff;border-color:transparent}
  .pin.role{background:var(--vscode-charts-purple,#6a1b9a);color:#fff;border-color:transparent;cursor:not-allowed}
  .pin small{display:block;font-size:9px;opacity:.85;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .legendrow{display:flex;gap:12px;margin:2px 0 10px;font-size:11px;color:var(--vscode-descriptionForeground)}
  .dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
  #pin_detail{position:sticky;top:8px}
  #pd_empty{color:var(--vscode-descriptionForeground)}
  .hint{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:6px}
  /* ── clock tree ── */
  #clock_tree{margin-top:10px;width:100%;overflow-x:auto}
  .ct-box{fill:var(--vscode-input-background);stroke:var(--vscode-panel-border)}
  .ct-box.hot{stroke:var(--vscode-charts-blue,#1565c0);stroke-width:1.5}
  .ct-t{fill:var(--vscode-foreground);font-size:11px;font-family:var(--vscode-font-family)}
  .ct-s{fill:var(--vscode-descriptionForeground);font-size:9px;font-family:var(--vscode-font-family)}
  .ct-w{stroke:var(--vscode-descriptionForeground);marker-end:url(#arr)}
</style></head><body>
<h1>Configure ${esc(board.id)}</h1>
<p class="sub">${esc(board.chip)}${info.family ? ` · ${esc(info.family)}` : ""}${havePinMap ? ` · ${pinData.length} pins` : ""}</p>

<div class="cols">
<div><!-- LEFT: pin map -->
<fieldset><legend>Pinout</legend>
${havePinMap ? `
  <div class="legendrow">
    <span><span class="dot" style="background:var(--vscode-charts-green,#2e7d32)"></span>GPIO</span>
    <span><span class="dot" style="background:var(--vscode-charts-blue,#1565c0)"></span>Alternate function</span>
    <span><span class="dot" style="background:var(--vscode-charts-purple,#6a1b9a)"></span>Board role (locked)</span>
  </div>
  <div id="pin_map"></div>
  <div class="hint">Click a pin to assign a function and a name. Role pins (LED / UART / I²C) are managed in the panels on the right.</div>
` : `<p id="pd_empty">This CLI predates the per-pin map — update alloy (uv tool upgrade alloy-embedded).</p>`}
</fieldset>
</div>

<div><!-- RIGHT: detail + clock + roles -->
<fieldset id="pin_detail"><legend>Pin</legend>
  <p id="pd_empty">Select a pin on the left.</p>
  <div id="pd_body" style="display:none">
    <div class="row">
      <div><label>Pin</label><div id="pd_name" style="font-weight:600;font-size:15px;padding:3px 0">—</div></div>
      <div><label>Function</label><select id="pd_fn"></select></div>
    </div>
    <label>Name (optional — becomes a code alias)</label>
    <input type="text" id="pd_label" placeholder="e.g. LED_STATUS" pattern="[A-Za-z_][A-Za-z0-9_]*">
    <div class="row" style="margin-top:10px">
      <div><button id="pd_apply" style="width:100%">Apply</button></div>
      <div><button id="pd_clear" class="secondary" style="width:100%">Clear pin</button></div>
    </div>
  </div>
</fieldset>

<fieldset><legend>System clock</legend>
  <label>Source</label>
  <select id="clock_mode">
    <option value="preset" ${isCustom ? "" : "selected"}>Preset profile</option>
    <option value="custom" ${isCustom ? "selected" : ""}>Custom PLL — any frequency</option>
  </select>
  <div id="preset_body" class="${isCustom ? "off" : ""}">
    <label>Profile</label>
    <select id="clock">${clockOptions}</select>
  </div>
  <div id="custom_body" class="${isCustom ? "" : "off"}">
    <div class="row">
      <div><label>Target frequency (MHz)</label><input type="number" id="target_mhz" value="${curMhz}" min="1"></div>
      <div style="display:flex;align-items:flex-end"><button id="compute" style="width:100%">Compute PLL</button></div>
    </div>
    <div id="clock_status" class="hint">${isCustom ? esc(String(board.clock?.description ?? "")) : "Enter a frequency and compute."}</div>
    <div id="clock_tree"></div>
  </div>
</fieldset>

<fieldset><legend>LED</legend>
  <label class="toggle"><input type="checkbox" id="led_on" ${roles.led ? "checked" : ""}> Enable LED (for blink)</label>
  <div id="led_body">
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
  <div id="uart_body">
    <div class="row">
      <div><label>Peripheral</label><select id="uart_periph">${uartOptions || "<option>none available</option>"}</select></div>
      <div><label>Baud</label><input type="number" id="uart_baud" value="${Number(uart.baud) || 115200}"></div>
    </div>
  </div>
</fieldset>

<fieldset><legend>I²C</legend>
  <label class="toggle"><input type="checkbox" id="i2c_on" ${roles.i2c ? "checked" : ""} ${i2cOptions ? "" : "disabled"}> Enable I²C</label>
  <div id="i2c_body">
    <label>Peripheral</label><select id="i2c_periph">${i2cOptions || "<option>none available</option>"}</select>
  </div>
</fieldset>

<button id="save" class="save">Save board</button>
</div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const PINS = ${JSON.stringify(pinData)};
  const ROLES = ${JSON.stringify(roles)};
  let assigns = ${JSON.stringify(board.pins ?? {})};   // {pin:{function,label}}
  let selected = null;
  let solved = ${isCustom ? "true" : "null"} && ${JSON.stringify(board.clock ?? null)};

  // ── pins consumed by roles (locked in the map, live-updated) ──
  function rolePins(){
    const m = {};
    if ($('led_on').checked) m[$('led_pin').value] = 'led';
    if ($('uart_on') && $('uart_on').checked){
      const u = ${JSON.stringify(info.peripherals.debug_uart)}.find(x=>x.peripheral===$('uart_periph').value);
      if (u){ if(u.tx) m[u.tx]='uart tx'; if(u.rx) m[u.rx]='uart rx'; }
    }
    if ($('i2c_on') && $('i2c_on').checked){
      const b = ${JSON.stringify(info.peripherals.i2c)}.find(x=>x.peripheral===$('i2c_periph').value);
      if (b){ if(b.scl) m[b.scl]='i2c scl'; if(b.sda) m[b.sda]='i2c sda'; }
    }
    return m;
  }

  // ── pin map rendering ──
  function fnShort(f){
    if (f === 'gpio_out') return 'out';
    if (f === 'gpio_in') return 'in';
    return f.replace(':', ' ');
  }
  function renderMap(){
    const host = $('pin_map');
    if (!host) return;
    const rp = rolePins();
    const ports = {};
    for (const p of PINS) (ports[p.port ?? '?'] ??= []).push(p);
    let html = '';
    for (const port of Object.keys(ports).sort()){
      html += '<div class="port"><div class="portname">Port ' + port + '</div><div class="pins">';
      for (const p of ports[port].sort((a,b)=>(a.index??0)-(b.index??0))){
        const a = assigns[p.name]; const role = rp[p.name];
        let cls = 'pin', sub = '';
        if (role){ cls += ' role'; sub = role; }
        else if (a){ cls += a.function.startsWith('gpio') ? ' gpio' : ' af'; sub = a.label || fnShort(a.function); }
        if (p.name === selected) cls += ' sel';
        html += '<button class="' + cls + '" data-pin="' + p.name + '">' + p.name + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
      }
      html += '</div></div>';
    }
    host.innerHTML = html;
    for (const el of host.querySelectorAll('.pin')){
      el.addEventListener('click', ()=>selectPin(el.dataset.pin));
    }
  }

  function selectPin(name){
    const rp = rolePins();
    if (rp[name]) return;          // locked: managed by the role panels
    selected = name;
    const p = PINS.find(x=>x.name===name);
    $('pd_empty').style.display = 'none';
    $('pd_body').style.display = '';
    $('pd_name').textContent = name;
    const a = assigns[name];
    let opts = '<option value="">— free —</option>'
      + '<option value="gpio_out">GPIO output</option>'
      + '<option value="gpio_in">GPIO input</option>';
    for (const f of p.functions){
      const v = f.peripheral + ':' + f.signal;
      opts += '<option value="' + v + '">' + f.peripheral + ' ' + f.signal.toUpperCase()
            + (f.af !== undefined ? ' (AF' + f.af + ')' : '') + '</option>';
    }
    $('pd_fn').innerHTML = opts;
    $('pd_fn').value = a ? a.function : '';
    $('pd_label').value = (a && a.label) || '';
    renderMap();
  }

  if ($('pin_map')){
    $('pd_apply').addEventListener('click', ()=>{
      if (!selected) return;
      const fn = $('pd_fn').value;
      const label = $('pd_label').value.trim();
      if (label && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)){
        $('pd_label').style.borderColor = 'var(--vscode-editorWarning-foreground,#cca700)'; return;
      }
      $('pd_label').style.borderColor = '';
      if (!fn) delete assigns[selected];
      else assigns[selected] = { function: fn, ...(label ? { label } : {}) };
      renderMap();
    });
    $('pd_clear').addEventListener('click', ()=>{
      if (!selected) return;
      delete assigns[selected]; $('pd_fn').value=''; $('pd_label').value='';
      renderMap();
    });
    renderMap();
  }

  // ── role toggles (and the map lock follows them live) ──
  function syncBox(box, body){ $(body).classList.toggle('off', !$(box).checked); renderMap(); }
  for (const [b,d] of [['led_on','led_body'],['uart_on','uart_body'],['i2c_on','i2c_body']]){
    syncBox(b,d); $(b).addEventListener('change',()=>syncBox(b,d));
  }
  for (const id of ['led_pin','uart_periph','i2c_periph']){
    if ($(id)) $(id).addEventListener('change', renderMap);
  }

  // ── clock: preset/custom + the tree diagram ──
  function syncMode(){
    const custom = $('clock_mode').value === 'custom';
    $('custom_body').classList.toggle('off', !custom);
    $('preset_body').classList.toggle('off', custom);
  }
  syncMode(); $('clock_mode').addEventListener('change', syncMode);

  function box(x, label, value, hot){
    return '<rect class="ct-box' + (hot?' hot':'') + '" x="'+x+'" y="18" width="86" height="40" rx="5"/>'
      + '<text class="ct-t" x="'+(x+43)+'" y="34" text-anchor="middle">'+label+'</text>'
      + '<text class="ct-s" x="'+(x+43)+'" y="48" text-anchor="middle">'+value+'</text>';
  }
  function wire(x){ return '<line class="ct-w" x1="'+x+'" y1="38" x2="'+(x+14)+'" y2="38"/>'; }
  function renderTree(r){
    const pll = r.pll || {};
    const src = (r.profile && r.profile.source) || 'HSI';
    const segs = [
      ['Source', src],
      ['÷M', 'M = ' + (pll.m ?? '?')],
      ['×N', 'N = ' + (pll.n ?? '?')],
      ['VCO', Math.round((pll.vco_hz||0)/1e6) + ' MHz'],
      ['÷' + (pll.div ?? '?'), 'post-divide'],
      ['SYSCLK', Math.round((r.sysclk_hz||0)/1e6) + ' MHz'],
    ];
    let x = 4, svg = '';
    for (let i = 0; i < segs.length; i++){
      svg += box(x, segs[i][0], segs[i][1], i === segs.length-1);
      x += 86; if (i < segs.length-1){ svg += wire(x); x += 14; }
    }
    svg += '<text class="ct-s" x="4" y="74">flash wait states: ' + (r.wait_states ?? '?')
        + (r.silicon_validated ? '  ·  silicon-validated ✓' : '') + '</text>';
    $('clock_tree').innerHTML =
      '<svg viewBox="0 0 ' + (x+4) + ' 80" width="100%" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">'
      + '<path d="M0,0 L6,3 L0,6 z" fill="var(--vscode-descriptionForeground)"/></marker></defs>'
      + svg + '</svg>';
  }

  $('compute').addEventListener('click', ()=>{
    $('clock_status').textContent = 'Solving…';
    vscode.postMessage({ type:'solveClock', mhz: Number($('target_mhz').value)||64 });
  });
  window.addEventListener('message', (e)=>{
    const m = e.data;
    if (m.type === 'clockResult'){
      solved = m.result.profile;
      const v = m.result.silicon_validated;
      $('clock_status').innerHTML = m.result.profile.description
        + (v ? '' : ' <span class="warn">— computed, not silicon-validated</span>');
      renderTree(m.result);
    } else if (m.type === 'clockError'){
      solved = null; $('clock_status').textContent = 'Error: ' + m.message;
      $('clock_tree').innerHTML = '';
    }
  });

  // ── save ──
  $('save').addEventListener('click', ()=>{
    const mode = $('clock_mode').value;
    if (mode === 'custom' && !solved){ $('clock_status').textContent = 'Compute a PLL first.'; return; }
    const rp = rolePins();
    const pins = {};
    for (const [k,v] of Object.entries(assigns)) if (!rp[k]) pins[k] = v;
    vscode.postMessage({ type:'save', config:{
      clock: mode === 'custom' ? { mode:'custom', profile:'custom', custom: solved }
                               : { mode:'preset', profile: $('clock').value },
      led: { on: $('led_on').checked, pin: $('led_pin').value, active: $('led_active').value },
      uart: { on: $('uart_on').checked, peripheral: $('uart_periph').value, baud: Number($('uart_baud').value)||115200 },
      i2c: { on: $('i2c_on').checked, peripheral: $('i2c_periph').value },
      pins,
    }});
  });
</script></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
