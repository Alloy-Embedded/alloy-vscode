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
  BoardDetail, BoardJson, ChipPackage, ClockGraph, EditorData, FIELD_WIDGETS,
  PinAssign, ROLE_GROUPS, ROLE_TITLES, RoleCandidate, RoleSpec, ValidationIssue,
  esc,
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
  /** Draw the physical package instead of the per-port list. */
  physical: boolean;
  issues: ValidationIssue[];
  /** What board-info reported this project already overrides. */
  overrides: BoardDetail["project_overrides"];
  readOnly: boolean;
  status: { text: string; kind: "" | "ok" | "err" };
}

export function initialState(data: EditorData): State {
  const overrides = data.detail.project_overrides;
  // Start from the board's own values and mutate in place, so a role this UI
  // cannot describe keeps exactly what board.json had — then lay this
  // project's choices on top.
  //
  // Both halves matter. `data.board` is board.json as STORED, which is what
  // has to round-trip when the board is ours to write. But the firmware is
  // built from the board as OVERRIDDEN, and seeding from the stored one alone
  // put the board's 115200 in a panel whose project runs at 921600 — and then
  // Apply read that stale number back, decided it matched the board, and
  // deleted the override from alloy.toml.
  const roles = JSON.parse(JSON.stringify(data.board.roles ?? {}));
  for (const [role, fields] of Object.entries(overrides?.roles ?? {})) {
    for (const [field, both] of Object.entries(fields)) {
      if (roles[role]) {
        roles[role][field] = both.project;
      }
    }
  }
  // The effective clock, for the same reason. board-info resolves it whether
  // the project named a profile or asked for a frequency.
  const effective = data.detail.clock;
  const inline = effective ? effective.mode === "inline" : !!data.board.clock;
  return {
    roles,
    pins: JSON.parse(JSON.stringify(data.board.pins ?? {})),
    clockMode: inline ? "custom" : "preset",
    clockProfile: effective?.profile ?? data.board.clock_profile ?? "",
    // Only the STORED board carries the PLL program; if this project asked for
    // a frequency the board does not have, there is nothing to seed and Save
    // says "compute a PLL first" rather than writing a wrong one.
    solved: data.board.clock ? (data.board.clock as Record<string, unknown>) : null,
    selectedPin: null,
    search: "",
    peripheralFilter: "",
    // Physical whenever the data can back it up — that is the view people came
    // for; the port list stays one click away and is the only view otherwise.
    physical: !!data.chip.package,
    issues: data.detail.issues ?? [],
    overrides: data.detail.project_overrides,
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

/** Is this field the PROJECT's to choose rather than the board's? Those go to
 *  alloy.toml, which is why they stay editable on a curated board — you do not
 *  have to duplicate someone else's board to change a baud rate. */
function projectField(data: EditorData, role: string, field: string): boolean {
  return (roleSpecs(data)[role]?.project_fields ?? []).includes(field);
}

function fieldHtml(state: State, data: EditorData, role: string, field: string,
                   cfg: Role): string {
  const widget = FIELD_WIDGETS[field];
  if (!widget) {
    return "";
  }
  const id = `f_${role}_${field}`;
  const isProject = projectField(data, role, field);
  const locked = state.readOnly && !isProject;
  const current = cfg[field];
  const problems = issueHtml(issuesFor(state, role, field), role, field);
  let control: string;
  if (widget.kind === "pin") {
    control = pinSelect(id, typeof current === "string" ? current : "",
                        !!widget.optional, data.chip.gpio_pins, locked);
  } else if (widget.kind === "number") {
    const value = current === undefined ? widget.default : current;
    control = `<input type="number" id="${id}" value="${esc(value)}"`
      + `${locked ? " disabled" : ""}>`;
  } else if (widget.kind === "text") {
    control = `<input type="text" id="${id}" value="${esc(current ?? "")}" `
      + `placeholder="${esc(widget.placeholder ?? "")}"${locked ? " disabled" : ""}>`;
  } else {
    const value = current === undefined ? widget.default : current;
    control = `<select id="${id}"${locked ? " disabled" : ""}>`
      + widget.choices.map(([v, t]) => option(v, t, String(value) === v)).join("")
      + "</select>";
  }
  const note = isProject
    ? `<div class="projectfield">yours — saved to alloy.toml${
        overriddenNote(state, role, field)}</div>`
    : "";
  return `<div><label>${esc(widget.label)}</label>${control}${note}${problems}</div>`;
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

/** "board says 115200" beside a value the project changed. */
function overriddenNote(state: State, role: string, field: string): string {
  const was = state.overrides?.roles?.[role]?.[field]?.board;
  return was === undefined ? "" : ` · board says ${esc(String(was))}`;
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

/** Whether a pin is one the user can assign, or a supply pad that is simply
 *  part of the part. */
const ASSIGNABLE = new Set(["gpio", undefined]);

/** The middle of a 144-pin package is a lot of empty space. Spend it on the
 *  count nobody can get from the drawing: how much of the chip is spoken for. */
function dieSummary(pkg: ChipPackage, owned: Record<string, string>,
                    state: State): string {
  const io = pkg.layout.filter((p) => ASSIGNABLE.has(p.kind));
  const taken = io.filter((p) => owned[p.signal] || state.pins[p.signal]).length;
  const rows: [string, string][] = [
    ["assigned", `${taken} of ${io.length} I/O`],
    ["supply", `${pkg.layout.length - io.length} pads`],
  ];
  return `<dl class="pk-sum">${rows.map(([k, v]) =>
    `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
}

/**
 * The chip as it physically is: pins around the four sides of a quad package,
 * or a grid for a BGA. Drawn ONLY from a curated `package` fact — the framework
 * refuses to guess a pinout, so a chip without one keeps the logical map.
 *
 * Split evenly counter-clockwise from pin 1, which is how every quad datasheet
 * numbers them: down the left, along the bottom, up the right, back along the
 * top.
 */
export function renderPackage(state: State, pkg: ChipPackage,
                              owned: Record<string, string>,
                              badPins: Set<string>): string {
  const isGrid = pkg.layout.some((p) => !/^\d+$/.test(p.position));

  /** One pin: a small stub against the die, and its label reading outward.
   *  Two lines of text per pin does not fit 36 to a side — a datasheet does
   *  not do it either, it puts a tick on the body and the name outside. */
  const cell = (entry: ChipPackage["layout"][number], side: string) => {
    const role = owned[entry.signal];
    const assign = state.pins[entry.signal];
    const classes = ["pk-pin", `s-${side}`];
    if (badPins.has(entry.signal)) {
      classes.push("bad");
    } else if (role) {
      classes.push("role");
    } else if (assign) {
      classes.push(assign.function.startsWith("gpio") ? "gpio" : "af");
    } else if (!ASSIGNABLE.has(entry.kind)) {
      classes.push("supply");
    }
    if (entry.signal === state.selectedPin) {
      classes.push("sel");
    }
    const clickable = ASSIGNABLE.has(entry.kind) && !role;
    const title = `pin ${entry.position} · ${entry.signal}`
      + (role ? ` · ${role}` : assign ? ` · ${assign.label || assign.function}` : "");
    return `<button class="${classes.join(" ")}"`
      + `${clickable ? ` data-pin="${esc(entry.signal)}"` : " disabled"}`
      + ` title="${esc(title)}">`
      + `<span class="pk-lab"><b>${esc(entry.position)}</b>${esc(entry.signal)}</span>`
      + `<i class="pk-stub"></i></button>`;
  };

  if (isGrid) {
    // A ball goes at its OWN column, not the next free one. Most grid arrays
    // are depopulated in the middle, and packing each row left-to-right draws
    // those parts as if every ball were crowded to one side — a wrong picture
    // of where the balls physically are.
    const at = new Map<string, ChipPackage["layout"][number]>();
    let maxCol = 0;
    const rowsSeen: string[] = [];
    for (const entry of pkg.layout) {
      const m = /^([A-Za-z]+)(\d+)$/.exec(entry.position);
      if (!m) {
        continue;
      }
      const [, row, col] = m;
      if (!rowsSeen.includes(row)) {
        rowsSeen.push(row);
      }
      maxCol = Math.max(maxCol, Number(col));
      at.set(`${row}:${Number(col)}`, entry);
    }
    const rows = rowsSeen.sort((a, b) => a.localeCompare(b));

    const header = `<div class="pk-row"><span class="pk-rowlabel"></span>${
      Array.from({ length: maxCol }, (_, i) =>
        `<span class="pk-collabel">${i + 1}</span>`).join("")}</div>`;

    const body = rows.map((row) => `<div class="pk-row">`
      + `<span class="pk-rowlabel">${esc(row)}</span>`
      + Array.from({ length: maxCol }, (_, i) => {
        const entry = at.get(`${row}:${i + 1}`);
        if (!entry) {
          return `<span class="pk-ball empty"></span>`;
        }
        const state_ = badPins.has(entry.signal) ? " bad"
          : owned[entry.signal] ? " role"
          : state.pins[entry.signal] ? " gpio"
          : ASSIGNABLE.has(entry.kind) ? "" : " supply";
        const clickable = ASSIGNABLE.has(entry.kind) && !owned[entry.signal];
        return `<button class="pk-ball${state_}"`
          + `${clickable ? ` data-pin="${esc(entry.signal)}"` : " disabled"}`
          + ` title="${esc(`${entry.position} · ${entry.signal}`)}">${
            esc(entry.signal)}</button>`;
      }).join("") + `</div>`).join("");

    return `<div class="pk-scroll"><div class="pk grid">${header}${body}</div></div>
      <div class="pk-caption">${esc(pkg.part ?? pkg.type)} · ${esc(pkg.type)} · ${
        pkg.pins} balls</div>`;
  }

  // Counter-clockwise from pin 1, the way every quad datasheet numbers them:
  // down the left, along the bottom, up the right, back along the top.
  const perSide = Math.floor(pkg.layout.length / 4);
  const ordered = [...pkg.layout].sort((a, b) => Number(a.position) - Number(b.position));
  const left = ordered.slice(0, perSide);
  const bottom = ordered.slice(perSide, perSide * 2);
  const right = ordered.slice(perSide * 2, perSide * 3);
  const top = ordered.slice(perSide * 3);

  return `<div class="pk-scroll"><div class="pk quad">
      <div class="pk-corner"></div>
      <div class="pk-top">${[...top].reverse().map((e) => cell(e, "top")).join("")}</div>
      <div class="pk-corner"></div>
      <div class="pk-left">${left.map((e) => cell(e, "left")).join("")}</div>
      <div class="pk-die">
        <span class="pk-part">${esc(pkg.part ?? pkg.type)}</span>
        <span class="pk-type">${esc(pkg.type)} · ${pkg.pins} pins</span>
        ${dieSummary(pkg, owned, state)}
      </div>
      <div class="pk-right">${[...right].reverse().map((e) => cell(e, "right")).join("")}</div>
      <div class="pk-corner"></div>
      <div class="pk-bottom">${bottom.map((e) => cell(e, "bottom")).join("")}</div>
      <div class="pk-corner"></div>
    </div></div>`;
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

  if (state.physical && data.chip.package) {
    return renderPackage(state, data.chip.package, owned, badPins);
  }

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

/** What the BOARD says for a field, not what this project made of it. */
function boardValue(state: State, data: EditorData, role: string, field: string) {
  const stored = state.overrides?.roles?.[role]?.[field];
  return stored ? stored.board : (data.board.roles?.[role] ?? {})[field];
}

/** What goes to alloy.toml: the project fields, split out of the roles. */
export function buildOverrides(state: State, data: EditorData) {
  const specs = roleSpecs(data);
  const roles: Record<string, Record<string, string | number>> = {};
  for (const [role, cfg] of Object.entries(state.roles)) {
    for (const field of specs[role]?.project_fields ?? []) {
      const value = cfg?.[field];
      if (value === undefined) {
        continue;
      }
      // Only record a real choice — matching the board's own value would just
      // pin a default that is already there.
      //
      // Careful: `data.board` is the board AFTER the current overrides, so
      // comparing against it would find the existing override equal to the
      // "board value" and drop it — a save with no edits would silently undo
      // what alloy.toml already said. The stored value comes from board-info.
      if (value !== boardValue(state, data, role, field)) {
        (roles[role] ??= {})[field] = value as string | number;
      }
    }
  }
  const boardProfile = state.overrides?.clock
    ? state.overrides.clock.board : data.board.clock_profile;
  const clock = state.clockMode === "custom" && state.solved
    ? { mhz: Math.round(Number(state.solved.sysclk_hz) / 1e6) }
    : state.clockProfile && state.clockProfile !== boardProfile
      ? { profile: state.clockProfile } : null;
  return { roles, clock };
}

/** board.json as it should be WRITTEN: the project's own choices stripped back
 *  out, so applying never bakes an alloy.toml value into the board file. */
export function buildBoard(state: State, data: EditorData): BoardJson {
  const board: BoardJson = JSON.parse(JSON.stringify(data.board));
  // Same for the clock: what the PROJECT asked for goes to alloy.toml, so the
  // board keeps whatever it already said.
  const ownClock = state.overrides?.clock;
  if (ownClock) {
    board.clock_profile = ownClock.board ?? undefined;
  } else if (state.clockMode === "custom" && state.solved) {
    board.clock = state.solved;
    board.clock_profile = "custom";
  } else {
    delete board.clock;
    board.clock_profile = state.clockProfile;
  }
  // state.roles carries this project's choices (seeded above); board.json is
  // not where those live. Put the board's own value back for every project
  // field, or applying an editable board would freeze an alloy.toml value
  // into the file and the override would stop being an override.
  board.roles = JSON.parse(JSON.stringify(state.roles));
  const specs = roleSpecs(data);
  for (const [role, cfg] of Object.entries(board.roles ?? {})) {
    for (const field of specs[role]?.project_fields ?? []) {
      const own = boardValue(state, data, role, field);
      if (own === undefined) {
        delete (cfg as Record<string, unknown>)[field];
      } else {
        (cfg as Record<string, unknown>)[field] = own;
      }
    }
  }
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
  const setView = (physical: boolean) => {
    state.physical = physical;
    $("view_physical")?.classList.toggle("on", physical);
    $("view_logical")?.classList.toggle("on", !physical);
    paint();
  };
  $("view_physical")?.addEventListener("click", () => setView(true));
  $("view_logical")?.addEventListener("click", () => setView(false));
  setView(state.physical);

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

  const askForGraph = (request: { mhz?: number; profile?: string }) => {
    const status = $("clock_status");
    if (status && request.mhz) {
      status.textContent = "Solving…";
    }
    vscode.postMessage({ type: "clockGraph", ...request });
  };

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
    profile.onchange = () => {
      state.clockProfile = profile.value;
      persist();
      askForGraph({ profile: profile.value });
    };
  }
  $("compute")?.addEventListener("click", () => askForGraph({
    mhz: Number(($("target_mhz") as HTMLInputElement).value) || 64,
  }));
  $("duplicate")?.addEventListener("click", () => vscode.postMessage({ type: "duplicate" }));
  $("save")?.addEventListener("click", () => {
    if (state.clockMode === "custom" && !state.solved) {
      state.status = { text: "compute a PLL first", kind: "err" };
      paint();
      return;
    }
    state.status = { text: "applying…", kind: "" };
    paint();
    vscode.postMessage({
      type: "save",
      // A curated board is not ours to rewrite; its project fields are.
      board: state.readOnly ? null : buildBoard(state, data),
      overrides: buildOverrides(state, data),
    });
  });

  window.addEventListener("message", (event: MessageEvent) => {
    const msg = event.data as {
      type: string; graph?: ClockGraph; message?: string;
      issues?: ValidationIssue[];
    };
    if (msg.type === "clockGraph") {
      const graph = msg.graph as ClockGraph;
      // A solved graph carries the profile to save; a named one does not, and
      // saving then means "use this profile by name".
      if (graph.solved_profile) {
        state.solved = graph.solved_profile;
      }
      const status = $("clock_status");
      if (status) {
        status.textContent = graph.description;
      }
      const host = $("clock_tree");
      if (host) {
        host.innerHTML = renderClockTree(graph);
      }
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

  askForGraph(state.clockMode === "custom"
    ? { mhz: Math.round(Number(($("target_mhz") as HTMLInputElement | null)?.value) || 64) }
    : { profile: state.clockProfile });
  paint();
}

const MHZ = (hz: number) =>
  hz >= 1_000_000 ? `${+(hz / 1e6).toFixed(hz % 1_000_000 ? 2 : 0)} MHz`
                  : `${+(hz / 1000).toFixed(0)} kHz`;

/**
 * The clock as it really branches: sources into SYSCLK, SYSCLK into the buses,
 * and every peripheral on the bus that feeds it — with what that implies. The
 * old diagram stopped at SYSCLK, which is the half a user does not need next.
 *
 * Every number here comes from `alloy clock --graph`; nothing is computed in
 * TypeScript, so the panel cannot disagree with the firmware about a baud rate.
 */
export function renderClockTree(graph: ClockGraph): string {
  const source = graph.sources.find((s) => s.selected) ?? graph.sources[0];
  const chain: string[] = [];
  if (source) {
    chain.push(cell(source.name.toUpperCase(), MHZ(source.hz), "src"));
  }
  if (graph.pll) {
    chain.push(cell("PLL",
      `÷${graph.pll.m} ×${graph.pll.n} ÷${graph.pll.div}`, "pll",
      `VCO ${MHZ(graph.pll.vco_hz)}`));
  }

  const byNode = new Map<string, ClockGraph["consumers"]>();
  for (const consumer of graph.consumers) {
    byNode.set(consumer.node, [...(byNode.get(consumer.node) ?? []), consumer]);
  }

  const buses = graph.nodes.map((node) => {
    const fed = byNode.get(node.name) ?? [];
    const rows = fed.map((c) => {
      const note = c.notes[0];
      return `<div class="ck-consumer">
          <span class="ck-name">${esc(c.peripheral)}</span>
          ${note ? `<span class="ck-note ${esc(note.level)}">${esc(note.text)}</span>` : ""}
        </div>`;
    }).join("");
    return `<div class="ck-bus">
        <div class="ck-bushead">
          <span class="ck-buslabel">${esc(node.label)}</span>
          ${node.divider && node.divider > 1
            ? `<span class="ck-div">÷${node.divider}</span>` : ""}
          <span class="ck-hz">${MHZ(node.hz)}</span>
        </div>
        ${rows || '<div class="ck-empty">nothing declared on this bus</div>'}
      </div>`;
  }).join("");

  const flags: string[] = [];
  if (graph.wait_states !== null) {
    flags.push(`${graph.wait_states} flash wait state${graph.wait_states === 1 ? "" : "s"}`);
  }
  flags.push(graph.silicon_validated
    ? "silicon-validated ✓" : "computed — not silicon-validated");
  const problems = graph.issues.map((i) =>
    `<div class="ck-note ${esc(i.level)}">${esc(i.peripheral)}: ${esc(i.text)}</div>`
  ).join("");

  return `<div class="ck">
      <div class="ck-chain">${chain.join('<span class="ck-arrow">→</span>')}</div>
      <div class="ck-buses">${buses}</div>
      <div class="ck-flags">${esc(flags.join(" · "))}</div>
      ${problems}
      ${graph.unstated.length
        ? `<div class="ck-unstated">Not on this tree — the chip data does not say
             what feeds them: ${esc(graph.unstated.join(", "))}</div>`
        : ""}
    </div>`;
}

function cell(label: string, value: string, kind: string, sub = ""): string {
  return `<div class="ck-cell ${esc(kind)}">
      <span class="ck-celllabel">${esc(label)}</span>
      <span class="ck-cellvalue">${esc(value)}</span>
      ${sub ? `<span class="ck-cellsub">${esc(sub)}</span>` : ""}
    </div>`;
}
