// The board configurator's client app.
//
// Bundled separately from the extension (it must not touch `vscode`), and split
// into pure render functions plus a thin DOM wiring layer at the bottom. That
// split is what makes the panel testable: `test/render.test.mjs` calls the same
// functions the webview does and inspects the HTML, so "the role panels render"
// is a checked property rather than a hope.
//
// Everything the user can be wrong about is answered in place: a field with a
// problem carries the message AND the pins that would work, as one-click fixes.

import {
  BoardJson, EditorData, FIELD_WIDGETS, PinAssign, ROLE_GROUPS, ROLE_TITLES,
  RoleCandidate, RoleSpec, ValidationIssue, esc,
} from "../shared/board";

type Role = Record<string, unknown>;

export interface State {
  roles: Record<string, Role>;
  pins: Record<string, PinAssign>;
  clockMode: "preset" | "custom";
  clockProfile: string;
  solved: Record<string, unknown> | null;
  selectedPin: string | null;
  search: string;
  peripheralFilter: string;
  issues: ValidationIssue[];
  readOnly: boolean;
  status: { text: string; kind: "" | "ok" | "err" };
}

export function initialState(data: EditorData): State {
  const inline = !!data.board.clock;
  return {
    // Start from the board's own values and mutate in place, so a role this UI
    // cannot describe keeps exactly what board.json had.
    roles: JSON.parse(JSON.stringify(data.board.roles ?? {})),
    pins: JSON.parse(JSON.stringify(data.board.pins ?? {})),
    clockMode: inline ? "custom" : "preset",
    clockProfile: data.board.clock_profile ?? "",
    solved: inline ? (data.board.clock as Record<string, unknown>) : null,
    selectedPin: null,
    search: "",
    peripheralFilter: "",
    issues: data.detail.issues ?? [],
    readOnly: !data.detail.editable,
    status: { text: "", kind: "" },
  };
}

/** The role catalogue, or a shim so an older CLI degrades instead of showing
 *  nothing. */
export function roleSpecs(data: EditorData): Record<string, RoleSpec> {
  if (data.chip.roles) {
    return data.chip.roles;
  }
  const asCandidates = (rows: { peripheral: string }[], signals: string[]): RoleCandidate[] =>
    rows.map((r) => ({
      peripheral: r.peripheral, ip: null, curated: true,
      signals: Object.fromEntries(signals.map((s) => {
        const pin = (r as unknown as Record<string, string>)[s];
        return [s, pin ? [pin] : []];
      })),
    }));
  const spec = (kind: RoleSpec["kind"], required: string[], optional: string[],
                candidates: RoleCandidate[]): RoleSpec => ({
    kind, required, optional, candidates,
    supported: kind !== "peripheral" || candidates.length > 0, reason: null,
  });
  return {
    led: spec("pin", ["pin"], ["active", "kind", "label"], []),
    debug_uart: spec("peripheral", ["peripheral", "tx", "rx"], ["baud", "label"],
                     asCandidates(data.chip.peripherals.debug_uart, ["tx", "rx"])),
    i2c: spec("peripheral", ["peripheral", "scl", "sda"], ["label"],
              asCandidates(data.chip.peripherals.i2c, ["scl", "sda"])),
  };
}

const candidateOf = (specs: Record<string, RoleSpec>, role: string, name: unknown) =>
  (specs[role]?.candidates ?? []).find((c) => c.peripheral === name);
const firstCurated = (specs: Record<string, RoleSpec>, role: string) =>
  (specs[role]?.candidates ?? []).find((c) => c.curated);

/** {pin: "role field"} for every pin a role has claimed — the map's locks. */
export function rolePins(state: State, data: EditorData): Record<string, string> {
  const specs = roleSpecs(data);
  const owned: Record<string, string> = {};
  for (const [role, cfg] of Object.entries(state.roles)) {
    const spec = specs[role];
    if (!spec || !cfg) {
      continue;
    }
    for (const [field, value] of Object.entries(cfg)) {
      const widget = FIELD_WIDGETS[field];
      if (widget?.kind === "pin" && typeof value === "string") {
        owned[value] = `${role} ${field}`;
      } else if (field === "pins" && Array.isArray(value)) {
        for (const pin of value) {
          owned[String(pin)] = `${role} bus`;
        }
      }
    }
    // Signal fields (tx/rx/scl/…) are pins too, but their names vary per
    // peripheral, so they come from the selected candidate.
    const cand = candidateOf(specs, role, cfg.peripheral);
    for (const signal of Object.keys(cand?.signals ?? {})) {
      if (typeof cfg[signal] === "string") {
        owned[cfg[signal] as string] = `${role} ${signal}`;
      }
    }
  }
  return owned;
}

// ---------------------------------------------------------------- rendering

function option(value: unknown, text: string, selected: boolean, disabled = false): string {
  return `<option value="${esc(value)}"${selected ? " selected" : ""}`
    + `${disabled ? " disabled" : ""}>${esc(text)}</option>`;
}

function issuesFor(state: State, role: string, field?: string): ValidationIssue[] {
  return state.issues.filter((i) =>
    i.role === role && (field === undefined ? i.field === null : i.field === field));
}

/** A problem, where it happened, with the values that would fix it. */
function issueHtml(issues: ValidationIssue[], role: string, field: string): string {
  return issues.map((issue) => {
    const chips = issue.suggestions
      .map((s) => `<button class="fix" data-fix-role="${esc(role)}" `
        + `data-fix-field="${esc(field)}" data-fix-value="${esc(s)}">${esc(s)}</button>`)
      .join("");
    const cls = issue.level === "error" ? "fielderr" : "fieldwarn";
    return `<div class="${cls}">${esc(issue.message)}`
      + (chips ? `<div>use: ${chips}</div>` : "") + "</div>";
  }).join("");
}

function pinSelect(id: string, value: string, allowEmpty: boolean,
                   pins: string[], readOnly: boolean): string {
  let html = `<select id="${id}"${readOnly ? " disabled" : ""}>`;
  if (allowEmpty) {
    html += option("", "— none —", !value);
  }
  for (const pin of pins) {
    html += option(pin, pin, pin === value);
  }
  return `${html}</select>`;
}

function fieldHtml(state: State, data: EditorData, role: string, field: string,
                   cfg: Role): string {
  const widget = FIELD_WIDGETS[field];
  if (!widget) {
    return "";
  }
  const id = `f_${role}_${field}`;
  const current = cfg[field];
  const problems = issueHtml(issuesFor(state, role, field), role, field);
  let control: string;
  if (widget.kind === "pin") {
    control = pinSelect(id, typeof current === "string" ? current : "",
                        !!widget.optional, data.chip.gpio_pins, state.readOnly);
  } else if (widget.kind === "number") {
    const value = current === undefined ? widget.default : current;
    control = `<input type="number" id="${id}" value="${esc(value)}"`
      + `${state.readOnly ? " disabled" : ""}>`;
  } else if (widget.kind === "text") {
    control = `<input type="text" id="${id}" value="${esc(current ?? "")}" `
      + `placeholder="${esc(widget.placeholder ?? "")}"${state.readOnly ? " disabled" : ""}>`;
  } else {
    const value = current === undefined ? widget.default : current;
    control = `<select id="${id}"${state.readOnly ? " disabled" : ""}>`
      + widget.choices.map(([v, t]) => option(v, t, String(value) === v)).join("")
      + "</select>";
  }
  return `<div><label>${esc(widget.label)}</label>${control}${problems}</div>`;
}

function signalsHtml(state: State, role: string, cfg: Role, cand: RoleCandidate): string {
  let html = "";
  for (const [signal, pins] of Object.entries(cand.signals ?? {})) {
    if (!pins.length) {
      continue;  // no route data — not pickable here
    }
    const id = `f_${role}_${signal}`;
    html += `<div><label>${esc(signal.toUpperCase())}</label>`
      + `<select id="${id}"${state.readOnly ? " disabled" : ""}>`
      + pins.map((p) => option(p, p, cfg[signal] === p)).join("")
      + "</select>"
      + issueHtml(issuesFor(state, role, signal), role, signal)
      + "</div>";
  }
  return html;
}

function channelHtml(state: State, role: string, cfg: Role, cand: RoleCandidate): string {
  if (!cand.channels?.length) {
    return "";
  }
  return `<div><label>Channel</label><select id="f_${role}_channel"`
    + `${state.readOnly ? " disabled" : ""}>`
    + cand.channels.map((c) => option(
        c.channel, `CH${c.channel} (${c.pins.join(", ")})`, Number(cfg.channel) === c.channel))
      .join("")
    + "</select>"
    + issueHtml(issuesFor(state, role, "channel"), role, "channel")
    + "</div>";
}

/** Fields this panel cannot build a control for — an Ethernet PHY block, a
 *  ROM-configured UART's pins. Their board.json value is kept verbatim. */
function undescribable(spec: RoleSpec, cand: RoleCandidate | undefined): string[] {
  return spec.required.filter((f) => {
    if (f === "peripheral" || FIELD_WIDGETS[f]) {
      return false;
    }
    if (cand?.signals?.[f]?.length) {
      return false;
    }
    return !(f === "channel" && cand?.channels?.length);
  });
}

export function renderRoles(state: State, data: EditorData): string {
  const specs = roleSpecs(data);
  const groups = ROLE_GROUPS
    .map((g) => ({ ...g, roles: g.roles.filter((r) => r in specs) }))
    .filter((g) => g.roles.length > 0);

  let html = "";
  for (const group of groups) {
    html += `<div class="grouptitle">${esc(group.title)}</div>`;
    for (const role of group.roles) {
      const spec = specs[role];
      const on = !!state.roles[role];
      const cfg = state.roles[role] ?? {};
      const cand = cfg.peripheral ? candidateOf(specs, role, cfg.peripheral)
                                  : firstCurated(specs, role);
      const roleIssues = state.issues.filter((i) => i.role === role);
      const broken = roleIssues.some((i) => i.level === "error");
      const usable = spec.supported && !state.readOnly;

      const classes = [spec.supported ? "" : "unsupported", broken ? "has-error" : ""]
        .filter(Boolean).join(" ");
      html += `<fieldset${classes ? ` class="${classes}"` : ""}>`
        + `<legend>${esc(ROLE_TITLES[role] ?? role)}</legend>`
        + `<label class="toggle"><input type="checkbox" data-role="${esc(role)}"`
        + `${on ? " checked" : ""}${usable ? "" : " disabled"}> Enable</label>`;

      if (!spec.supported) {
        html += `<div class="reason">${esc(spec.reason ?? "not available on this chip")}</div>`;
      } else if (spec.requires_role && !state.roles[spec.requires_role]) {
        html += `<div class="reason">needs the ${esc(spec.requires_role)} role on `
          + "the same board</div>";
      }
      // Role-level problems (missing peripheral, unmet dependency).
      html += issueHtml(issuesFor(state, role), role, "");

      if (on || spec.supported) {
        const missing = cand ? undescribable(spec, cand) : [];
        if (on && missing.length) {
          html += `<div class="reason">Edited in board.json — this panel cannot `
            + `describe: ${esc(missing.join(", "))}</div>`
            + `<div class="verbatim">${esc(JSON.stringify(cfg, null, 1))}</div>`;
        } else {
          html += `<div class="body${on ? "" : " off"}" data-body="${esc(role)}">`;
          if (spec.kind === "peripheral") {
            html += `<div class="row"><div><label>Peripheral</label>`
              + `<select id="f_${role}_peripheral"${state.readOnly ? " disabled" : ""}>`
              + spec.candidates.map((c) => option(
                  c.peripheral, c.peripheral + (c.curated ? "" : "  (not curated)"),
                  cfg.peripheral === c.peripheral, !c.curated)).join("")
              + "</select>"
              + issueHtml(issuesFor(state, role, "peripheral"), role, "peripheral")
              + "</div>";
            if (cand) {
              html += signalsHtml(state, role, cfg, cand)
                + channelHtml(state, role, cfg, cand);
            }
            html += "</div>";
          } else if (spec.kind === "pins") {
            html += `<label>Pins (in bit order, comma separated)</label>`
              + `<input type="text" id="f_${role}_pins" `
              + `value="${esc(((cfg.pins as string[]) ?? []).join(", "))}" `
              + `placeholder="pa0, pa1, pa2"${state.readOnly ? " disabled" : ""}>`
              + issueHtml(issuesFor(state, role, "pins"), role, "pins");
          }
          const extra = [...spec.required, ...spec.optional]
            .filter((f) => f !== "peripheral" && FIELD_WIDGETS[f])
            .map((f) => fieldHtml(state, data, role, f, cfg))
            .join("");
          if (extra) {
            html += `<div class="row">${extra}</div>`;
          }
          html += "</div>";
        }
      }
      html += "</fieldset>";
    }
  }
  return html;
}

const shortFn = (f: string) =>
  f === "gpio_out" ? "out" : f === "gpio_in" ? "in" : f.replace(":", " ");

/** Peripherals the pin map can filter by, from the chip's own route table. */
export function peripheralsInMap(data: EditorData): string[] {
  const names = new Set<string>();
  for (const pin of data.chip.pins ?? []) {
    for (const fn of pin.functions) {
      names.add(fn.peripheral);
    }
  }
  return [...names].sort();
}

export function renderPinMap(state: State, data: EditorData): string {
  const pins = data.chip.pins ?? [];
  if (!pins.length) {
    return "";
  }
  const owned = rolePins(state, data);
  const badPins = new Set(state.issues
    .filter((i) => i.level === "error" && i.pin)
    .map((i) => i.pin as string));
  const search = state.search.trim().toLowerCase();

  const matches = (pin: typeof pins[number]) => {
    if (state.peripheralFilter
        && !pin.functions.some((f) => f.peripheral === state.peripheralFilter)) {
      return false;
    }
    if (!search) {
      return true;
    }
    return pin.name.toLowerCase().includes(search)
      || pin.functions.some((f) =>
        `${f.peripheral} ${f.signal}`.toLowerCase().includes(search))
      || (state.pins[pin.name]?.label ?? "").toLowerCase().includes(search);
  };

  const ports = new Map<string, typeof pins>();
  for (const pin of pins) {
    const key = pin.port ?? "?";
    ports.set(key, [...(ports.get(key) ?? []), pin]);
  }

  let html = "";
  for (const port of [...ports.keys()].sort()) {
    const row = [...(ports.get(port) ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    html += `<div class="port"><div class="portname">Port ${esc(port)}</div><div class="pins">`;
    for (const pin of row) {
      const assign = state.pins[pin.name];
      const role = owned[pin.name];
      const classes = ["pin"];
      let sub = "";
      if (badPins.has(pin.name)) {
        classes.push("bad");
        sub = role ?? "problem";
      } else if (role) {
        classes.push("role");
        sub = role;
      } else if (assign) {
        classes.push(assign.function.startsWith("gpio") ? "gpio" : "af");
        sub = assign.label || shortFn(assign.function);
      }
      if (pin.name === state.selectedPin) {
        classes.push("sel");
      }
      if (!matches(pin)) {
        classes.push("dim");
      }
      html += `<button class="${classes.join(" ")}" data-pin="${esc(pin.name)}">`
        + `${esc(pin.name)}${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
    }
    html += "</div></div>";
  }
  return html;
}

/** The board-level summary: what is wrong, or that nothing is. */
export function renderIssueBanner(state: State): string {
  const errors = state.issues.filter((i) => i.level === "error");
  const warnings = state.issues.filter((i) => i.level === "warning");
  if (!errors.length && !warnings.length) {
    return "";
  }
  const list = (rows: ValidationIssue[]) =>
    `<ul>${rows.map((i) => `<li>${esc(i.message)}</li>`).join("")}</ul>`;
  if (errors.length) {
    return `<div class="banner err"><div><b>This board does not build.</b>`
      + `${list(errors)}</div></div>`;
  }
  return `<div class="banner warn"><div><b>Worth checking.</b>${list(warnings)}</div></div>`;
}

// ------------------------------------------------------------- state edits

export function defaultsFor(role: string, data: EditorData): Role {
  const specs = roleSpecs(data);
  const spec = specs[role];
  const cand = firstCurated(specs, role);
  const cfg: Role = {};
  if (spec.kind === "peripheral" && cand) {
    cfg.peripheral = cand.peripheral;
    for (const [signal, pins] of Object.entries(cand.signals ?? {})) {
      if (pins.length) {
        cfg[signal] = pins[0];
      }
    }
    if (cand.channels?.length) {
      cfg.channel = cand.channels[0].channel;
      if (cand.channels[0].pins.length) {
        cfg.pin = cand.channels[0].pins[0];
      }
    }
  } else if (spec.kind === "pin") {
    cfg.pin = data.chip.gpio_pins[0] ?? "";
  } else if (spec.kind === "pins") {
    cfg.pins = data.chip.gpio_pins.slice(0, 1);
  }
  for (const field of spec.required) {
    const widget = FIELD_WIDGETS[field];
    if (widget && cfg[field] === undefined && widget.kind !== "pin") {
      cfg[field] = (widget as { default?: unknown }).default ?? "";
    }
  }
  return cfg;
}

/** Apply one field edit. Kept separate from the DOM so it can be tested. */
export function applyField(state: State, role: string, field: string,
                           value: string): void {
  const cfg = state.roles[role];
  if (!cfg) {
    return;
  }
  if (field === "pins") {
    cfg.pins = value.split(",").map((s) => s.trim()).filter(Boolean);
    return;
  }
  const widget = FIELD_WIDGETS[field];
  if (field === "channel" || widget?.kind === "number") {
    cfg[field] = Number(value);
  } else if (value === "") {
    delete cfg[field];
  } else {
    cfg[field] = value;
  }
}

export function buildBoard(state: State, data: EditorData): BoardJson {
  const board: BoardJson = JSON.parse(JSON.stringify(data.board));
  if (state.clockMode === "custom" && state.solved) {
    board.clock = state.solved;
    board.clock_profile = "custom";
  } else {
    delete board.clock;
    board.clock_profile = state.clockProfile;
  }
  board.roles = state.roles;
  const owned = rolePins(state, data);
  const named: Record<string, PinAssign> = {};
  for (const [pin, assign] of Object.entries(state.pins)) {
    if (!owned[pin]) {
      named[pin] = assign;
    }
  }
  if (Object.keys(named).length) {
    board.pins = named;
  } else {
    delete board.pins;
  }
  return board;
}

// ----------------------------------------------------------- DOM wiring

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
};

export function main(): void {
  const vscode = acquireVsCodeApi();
  const data = (window as unknown as { __ALLOY__: EditorData }).__ALLOY__;
  const saved = vscode.getState() as { roles?: Record<string, Role> } | undefined;
  const state = initialState(data);
  // Survive the panel being hidden and restored: VS Code keeps the state blob,
  // so unsaved edits are not silently thrown away.
  if (saved?.roles) {
    Object.assign(state, saved);
  }
  const $ = (id: string) => document.getElementById(id);
  const specs = roleSpecs(data);

  const persist = () => vscode.setState({
    roles: state.roles, pins: state.pins, clockMode: state.clockMode,
    clockProfile: state.clockProfile, solved: state.solved,
  });

  function paint(): void {
    const roles = $("roles");
    if (roles) {
      roles.innerHTML = renderRoles(state, data);
    }
    const map = $("pin_map");
    if (map) {
      map.innerHTML = renderPinMap(state, data);
    }
    const banner = $("issues");
    if (banner) {
      banner.innerHTML = renderIssueBanner(state);
    }
    const status = $("status");
    if (status) {
      status.textContent = state.status.text;
      status.className = `status ${state.status.kind}`;
    }
    wire();
    persist();
  }

  function wire(): void {
    for (const box of document.querySelectorAll<HTMLInputElement>("input[data-role]")) {
      box.onchange = () => {
        const role = box.dataset.role as string;
        if (box.checked) {
          state.roles[role] = state.roles[role] ?? defaultsFor(role, data);
        } else {
          delete state.roles[role];
        }
        paint();
      };
    }
    for (const el of document.querySelectorAll<HTMLElement>("#roles select, #roles input")) {
      const id = el.id;
      if (!id.startsWith("f_")) {
        continue;
      }
      el.onchange = () => {
        const [, ...rest] = id.split("_");
        // Role names contain underscores (led_pwm, debug_uart), so match the
        // longest known role that prefixes the id.
        const role = Object.keys(specs)
          .filter((r) => id.startsWith(`f_${r}_`))
          .sort((a, b) => b.length - a.length)[0];
        if (!role) {
          return;
        }
        const field = id.slice(`f_${role}_`.length);
        applyField(state, role, field, (el as HTMLInputElement).value);
        void rest;
        paint();
      };
    }
    for (const chip of document.querySelectorAll<HTMLElement>(".fix")) {
      chip.onclick = () => {
        const { fixRole, fixField, fixValue } = chip.dataset;
        if (fixRole && fixField) {
          applyField(state, fixRole, fixField, fixValue ?? "");
          state.status = { text: "changed — apply to check it", kind: "" };
          paint();
        }
      };
    }
    for (const pin of document.querySelectorAll<HTMLElement>(".pin")) {
      pin.onclick = () => selectPin(pin.dataset.pin as string);
    }
  }

  function selectPin(name: string): void {
    if (rolePins(state, data)[name]) {
      return;  // locked: managed by the role panels
    }
    state.selectedPin = name;
    const info = (data.chip.pins ?? []).find((p) => p.name === name);
    const body = $("pd_body");
    const empty = $("pd_empty");
    if (!info || !body || !empty) {
      return;
    }
    empty.style.display = "none";
    body.style.display = "";
    ($("pd_name") as HTMLElement).textContent = name;
    const assign = state.pins[name];
    const select = $("pd_fn") as HTMLSelectElement;
    select.innerHTML = '<option value="">— free —</option>'
      + '<option value="gpio_out">GPIO output</option>'
      + '<option value="gpio_in">GPIO input</option>'
      + info.functions.map((f) => option(
          `${f.peripheral}:${f.signal}`,
          `${f.peripheral} ${f.signal.toUpperCase()}`
            + (f.af !== undefined ? ` (AF${f.af})` : ""), false)).join("");
    select.value = assign?.function ?? "";
    ($("pd_label") as HTMLInputElement).value = assign?.label ?? "";
    paint();
  }

  // ---- static controls ----
  const search = $("search") as HTMLInputElement | null;
  if (search) {
    search.oninput = () => { state.search = search.value; paint(); };
  }
  const filter = $("periph_filter") as HTMLSelectElement | null;
  if (filter) {
    filter.innerHTML = option("", "all peripherals", true)
      + peripheralsInMap(data).map((p) => option(p, p, false)).join("");
    filter.onchange = () => { state.peripheralFilter = filter.value; paint(); };
  }
  const apply = $("pd_apply");
  if (apply) {
    apply.onclick = () => {
      if (!state.selectedPin || state.readOnly) {
        return;
      }
      const fn = ($("pd_fn") as HTMLSelectElement).value;
      const labelInput = $("pd_label") as HTMLInputElement;
      const label = labelInput.value.trim();
      if (label && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(label)) {
        labelInput.style.borderColor = "var(--vscode-editorWarning-foreground,#cca700)";
        return;
      }
      labelInput.style.borderColor = "";
      if (!fn) {
        delete state.pins[state.selectedPin];
      } else {
        state.pins[state.selectedPin] = { function: fn, ...(label ? { label } : {}) };
      }
      paint();
    };
  }
  const clear = $("pd_clear");
  if (clear) {
    clear.onclick = () => {
      if (!state.selectedPin || state.readOnly) {
        return;
      }
      delete state.pins[state.selectedPin];
      ($("pd_fn") as HTMLSelectElement).value = "";
      ($("pd_label") as HTMLInputElement).value = "";
      paint();
    };
  }

  const clockMode = $("clock_mode") as HTMLSelectElement | null;
  const syncClock = () => {
    const custom = clockMode?.value === "custom";
    state.clockMode = custom ? "custom" : "preset";
    $("custom_body")?.classList.toggle("off", !custom);
    $("preset_body")?.classList.toggle("off", custom);
  };
  if (clockMode) {
    clockMode.onchange = syncClock;
    syncClock();
  }
  const profile = $("clock") as HTMLSelectElement | null;
  if (profile) {
    profile.onchange = () => { state.clockProfile = profile.value; persist(); };
  }
  $("compute")?.addEventListener("click", () => {
    const status = $("clock_status");
    if (status) {
      status.textContent = "Solving…";
    }
    vscode.postMessage({
      type: "solveClock",
      mhz: Number(($("target_mhz") as HTMLInputElement).value) || 64,
    });
  });
  $("duplicate")?.addEventListener("click", () => vscode.postMessage({ type: "duplicate" }));
  $("save")?.addEventListener("click", () => {
    if (state.clockMode === "custom" && !state.solved) {
      state.status = { text: "compute a PLL first", kind: "err" };
      paint();
      return;
    }
    state.status = { text: "applying…", kind: "" };
    paint();
    vscode.postMessage({ type: "save", board: buildBoard(state, data) });
  });

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as {
      type: string; result?: Record<string, never>; message?: string;
      issues?: ValidationIssue[];
    };
    if (msg.type === "clockResult") {
      const result = msg.result as unknown as {
        profile: Record<string, unknown>; silicon_validated: boolean;
      };
      state.solved = result.profile;
      const status = $("clock_status");
      if (status) {
        status.innerHTML = esc(result.profile.description)
          + (result.silicon_validated ? ""
             : ' <span class="warn">— computed, not silicon-validated</span>');
      }
      renderTree($("clock_tree"), msg.result as unknown as Record<string, never>);
      persist();
    } else if (msg.type === "clockError") {
      state.solved = null;
      const status = $("clock_status");
      if (status) {
        status.textContent = `Error: ${msg.message}`;
      }
    } else if (msg.type === "validated") {
      // Saved WITHOUT closing: the panel stays put and shows what the emitter
      // now thinks, so fixing a problem is a loop rather than a reopen.
      state.issues = msg.issues ?? [];
      const errors = state.issues.filter((i) => i.level === "error").length;
      state.status = errors
        ? { text: `saved — ${errors} problem${errors > 1 ? "s" : ""} left`, kind: "err" }
        : { text: "saved — board is clean", kind: "ok" };
      paint();
    }
  });

  paint();
}

function renderTree(host: HTMLElement | null, result: Record<string, never>): void {
  if (!host) {
    return;
  }
  const r = result as unknown as {
    pll?: Record<string, number>; profile?: { source?: string };
    sysclk_hz?: number; wait_states?: number; silicon_validated?: boolean;
  };
  const pll = r.pll ?? {};
  const segments: [string, string][] = [
    ["Source", r.profile?.source ?? "HSI"],
    ["÷M", `M = ${pll.m ?? "?"}`],
    ["×N", `N = ${pll.n ?? "?"}`],
    ["VCO", `${Math.round((pll.vco_hz ?? 0) / 1e6)} MHz`],
    [`÷${pll.div ?? "?"}`, "post-divide"],
    ["SYSCLK", `${Math.round((r.sysclk_hz ?? 0) / 1e6)} MHz`],
  ];
  let x = 4;
  let svg = "";
  segments.forEach(([label, value], i) => {
    const hot = i === segments.length - 1;
    svg += `<rect class="ct-box${hot ? " hot" : ""}" x="${x}" y="18" width="86" `
      + `height="40" rx="5"/>`
      + `<text class="ct-t" x="${x + 43}" y="34" text-anchor="middle">${esc(label)}</text>`
      + `<text class="ct-s" x="${x + 43}" y="48" text-anchor="middle">${esc(value)}</text>`;
    x += 86;
    if (i < segments.length - 1) {
      svg += `<line class="ct-w" x1="${x}" y1="38" x2="${x + 14}" y2="38"/>`;
      x += 14;
    }
  });
  svg += `<text class="ct-s" x="4" y="74">flash wait states: ${esc(r.wait_states ?? "?")}`
    + `${r.silicon_validated ? "  ·  silicon-validated ✓" : ""}</text>`;
  host.innerHTML = `<svg viewBox="0 0 ${x + 4} 80" width="100%" `
    + `xmlns="http://www.w3.org/2000/svg"><defs>`
    + `<marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">`
    + `<path d="M0,0 L6,3 L0,6 z" fill="var(--vscode-descriptionForeground)"/></marker>`
    + `</defs>${svg}</svg>`;
}
