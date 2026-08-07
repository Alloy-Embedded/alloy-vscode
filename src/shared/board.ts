// Types and tables shared by the extension host and the webview.
//
// The webview is bundled separately and must not pull in `vscode`, so anything
// both sides need lives here: the CLI envelope shapes, plus the small amount of
// presentation knowledge (how a board.json field is edited, how roles are
// grouped) that would otherwise be duplicated on each side.

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

/** One peripheral a role could bind to, with every pin each signal reaches. */
export interface RoleCandidate {
  peripheral: string;
  ip: string | null;
  /** false = admitted by the database but with no register file — the emitter
   *  refuses it, so it must not be pickable. */
  curated: boolean;
  signals: Record<string, string[]>;
  channels?: { channel: number; pins: string[] }[];
  analog_channels?: Record<string, number>;
}

export interface RoleSpec {
  kind: "pin" | "pins" | "peripheral" | "external";
  required: string[];
  optional: string[];
  /** Fields a PROJECT may choose from alloy.toml without owning the board —
   *  editable even when the board itself is read-only. */
  project_fields?: string[];
  candidates: RoleCandidate[];
  supported: boolean;
  reason: string | null;
  requires_role?: string;
}

/** The physical part: one entry per pin of the package, in position order.
 *  Absent when the chip data has no trustworthy pinout — which is a normal
 *  state, not a bug (see the pinout plausibility lint in alloy-devices). */
export interface ChipPackage {
  type: string;
  pins: number;
  part?: string;
  layout: {
    position: string;
    signal: string;
    kind?: "gpio" | "power" | "ground" | "reset" | "analog" | "clock" | "boot" | "other";
  }[];
}

export interface ChipDetail {
  chip: string;
  family: string | null;
  part?: string | null;
  clock_profiles: { name: string; description: string; sysclk_hz: number | null }[];
  boot_profile: string | null;
  gpio_pins: string[];
  /** Per-pin function map. Absent on pre-pins CLIs. */
  pins?: PinInfo[];
  /** The package drawing, when the data supports one. */
  package?: ChipPackage | null;
  /** Every board role and this chip's candidates for it. Absent on pre-roles
   *  CLIs, in which case the editor falls back to the legacy panels. */
  roles?: Record<string, RoleSpec>;
  memories?: { name: string; kind: string; base: string; size: number }[];
  peripherals: {
    debug_uart: { peripheral: string; tx?: string; rx?: string }[];
    i2c: { peripheral: string; scl?: string; sda?: string }[];
    spi: { peripheral: string; sck?: string; mosi?: string; miso?: string }[];
  };
}

/** A located problem: which role, which field, which pin, and what would work. */
export interface ValidationIssue {
  level: "error" | "warning";
  role: string | null;
  field: string | null;
  pin: string | null;
  message: string;
  suggestions: string[];
  stage?: string;
}

/** alloy.board_info.v1 — a board as it actually is, curated or project-local. */
export interface BoardDetail {
  id: string;
  name: string;
  chip: string;
  family: string | null;
  part: string | null;
  source: "framework" | "project";
  /** Only project-local boards may be written in place. */
  editable: boolean;
  path: string;
  clock: {
    mode: "profile" | "inline";
    profile: string;
    sysclk_hz: number | null;
    description: string;
    silicon_validated: boolean;
  };
  roles: Record<string, Record<string, unknown>>;
  caps: Record<string, boolean>;
  pins_used: { pin: string; owner: string; signal: string }[];
  named_pins: { pin: string; function: string; label: string | null }[];
  /** Which values this project overrode, with the board's own beside them. */
  project_overrides?: {
    roles: Record<string, Record<string, { board: unknown; project: unknown }>>;
    clock: { board: string | null; project: Record<string, unknown> } | null;
  };
  issues: ValidationIssue[];
}

export interface PinAssign {
  function: string; // "gpio_out" | "gpio_in" | "<peripheral>:<signal>"
  label?: string;
}

export interface BoardJson {
  schema?: string;
  id: string;
  name?: string;
  chip: string;
  clock_profile?: string;
  clock?: Record<string, unknown>;
  roles?: Record<string, Record<string, unknown>>;
  pins?: Record<string, PinAssign>;
}

/** Everything the webview is handed at startup. */
export interface EditorData {
  detail: BoardDetail;
  chip: ChipDetail;
  board: BoardJson;
}

// How each board.json field is edited. `pin` fields double as the source of
// truth for which pins a role consumes, so the map can lock them live.
export type Widget =
  | { kind: "pin"; label: string; optional?: boolean }
  | { kind: "number"; label: string; default: number }
  | { kind: "text"; label: string; placeholder?: string }
  | { kind: "choice"; label: string; choices: [string, string][]; default: string };

export const FIELD_WIDGETS: Record<string, Widget> = {
  pin: { kind: "pin", label: "Pin" },
  cs: { kind: "pin", label: "Chip select", optional: true },
  wp: { kind: "pin", label: "Write-protect pin", optional: true },
  reset_pin: { kind: "pin", label: "PHY reset pin" },
  baud: { kind: "number", label: "Baud", default: 115200 },
  bytes: { kind: "number", label: "Reserved bytes", default: 2048 },
  timeout_ms: { kind: "number", label: "Timeout (ms)", default: 4000 },
  page_size: { kind: "number", label: "Page size", default: 16 },
  addr: { kind: "text", label: "I²C address", placeholder: "0x50" },
  id_addr: { kind: "text", label: "Identity address", placeholder: "0x58" },
  label: { kind: "text", label: "Label (documentation)" },
  active: {
    kind: "choice", label: "Active level", default: "high",
    choices: [["high", "Active high"], ["low", "Active low"]],
  },
  pull: {
    kind: "choice", label: "Pull resistor", default: "none",
    choices: [["none", "None"], ["up", "Pull-up"]],
  },
  kind: {
    kind: "choice", label: "LED type", default: "gpio",
    choices: [["gpio", "Plain GPIO"], ["ws2812", "WS2812 addressable"]],
  },
  mode: {
    kind: "choice", label: "Mode", default: "pins",
    choices: [["pins", "Routed pins"], ["rom", "Boot-ROM configured"]],
  },
};

// Display order and grouping — the shape of a board, not alphabetical.
export const ROLE_GROUPS: { title: string; roles: string[] }[] = [
  { title: "System", roles: ["watchdog", "rtc"] },
  { title: "I/O", roles: ["led", "button", "led_pwm", "gpio_bus"] },
  { title: "Buses", roles: ["debug_uart", "i2c", "spi", "can"] },
  { title: "Analog", roles: ["adc", "dac"] },
  { title: "Storage", roles: ["nvm", "fs", "eeprom"] },
  { title: "Connectivity", roles: ["ethernet"] },
];

export const ROLE_TITLES: Record<string, string> = {
  led: "LED", button: "Button", led_pwm: "PWM LED", gpio_bus: "GPIO bus",
  debug_uart: "Debug UART", i2c: "I²C", spi: "SPI", can: "CAN",
  adc: "ADC", dac: "DAC", nvm: "Key/value store", fs: "Filesystem",
  eeprom: "EEPROM", watchdog: "Watchdog", rtc: "Real-time clock",
  ethernet: "Ethernet",
};

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** alloy.size.v1 — what the last build costs, against the chip's memories. */
export interface MemoryUse {
  used: number | null;
  total: number | null;
  base: number | null;
  percent: number | null;
  /** The memory the numbers refer to — "flash" is `irom` on a chip with none. */
  region?: string | null;
}

export interface SizeReport {
  board: string;
  chip: string | null;
  available: boolean;
  reason: string | null;
  flash: MemoryUse;
  ram: MemoryUse;
  slots: {
    image_bytes: number | null;
    regions: { name: string; base: number; size: number; fits: boolean | null }[];
  } | null;
}

/** alloy.matrix.v1 — one source tree, every board. */
export interface MatrixRow {
  board: string;
  chip: string | null;
  ok: boolean;
  seconds: number;
  flash: MemoryUse | null;
  ram: MemoryUse | null;
  error: string | null;
}

export interface MatrixReport {
  boards: MatrixRow[];
  built: number;
  failed: number;
  ok: boolean;
}

/** alloy.clock_graph.v1 — the whole clock, not just the PLL. */
export interface ClockNode {
  name: string;
  label: string;
  hz: number;
  parent: string | null;
  divider: number | null;
}

export interface ClockConsumer {
  peripheral: string;
  class: string | null;
  node: string;
  hz: number;
  notes: { level: "info" | "warning" | "error"; text: string }[];
}

export interface ClockGraph {
  chip: string;
  profile: string;
  description: string;
  silicon_validated: boolean;
  sources: { name: string; hz: number; selected: boolean }[];
  pll: { m: number; n: number; div: number; vco_hz: number } | null;
  wait_states: number | null;
  nodes: ClockNode[];
  consumers: ClockConsumer[];
  /** Peripherals whose feed the chip data does not state. */
  unstated: string[];
  issues: { level: string; peripheral: string; text: string }[];
  /** With --mhz: the profile to write into board.json. Null for a named one. */
  solved_profile: Record<string, unknown> | null;
}
