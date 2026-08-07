// Render tests for the board configurator — no VS Code, no DOM.
//
// The configurator's client app is split into pure render functions plus a thin
// DOM wiring layer, precisely so this file can call the same functions the
// webview calls and inspect what they produce. The E2E suite can only assert
// "the panel opened"; everything a user actually sees is checked here.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const STUB = resolve(HERE, "stub", "alloy");
const FIXTURE = resolve(HERE, "fixture");

const cli = (args) =>
  JSON.parse(execFileSync(STUB, args, { cwd: FIXTURE, encoding: "utf8" }));

/** A module under src/ that imports nothing but src/shared/, so it loads in Node. */
async function loadModule(...segments) {
  const built = await esbuild.build({
    entryPoints: [resolve(ROOT, ...segments)],
    bundle: true, format: "esm", write: false, platform: "neutral",
    target: "es2020", logLevel: "silent",
  });
  return import("data:text/javascript;base64,"
    + Buffer.from(built.outputFiles[0].text).toString("base64"));
}

const loadEditor = () => loadModule("src", "webview", "editor.ts");
const loadReport = () => loadModule("src", "shared", "report.ts");

const ALL_ROLES = [
  "led", "button", "gpio_bus", "debug_uart", "i2c", "spi", "led_pwm", "adc",
  "dac", "can", "rtc", "watchdog", "nvm", "fs", "eeprom", "ethernet",
];
const ALL_TITLES = [
  "LED", "Button", "GPIO bus", "Debug UART", "I²C", "SPI", "PWM LED", "ADC",
  "DAC", "CAN", "Real-time clock", "Watchdog", "Key/value store", "Filesystem",
  "EEPROM", "Ethernet",
];

function payload() {
  const detail = cli(["board-info", "--json"]);
  const chip = cli(["chip-info", "st/stm32g0b1"]);
  const board = JSON.parse(
    readFileSync(resolve(FIXTURE, "boards", "nucleo_g0b1re", "board.json"), "utf8"));
  // Exercise the "already configured" path, not just empty forms.
  board.roles = JSON.parse(JSON.stringify(detail.roles));
  return { detail, chip, board };
}

async function main() {
  const ed = await loadEditor();
  const data = payload();
  const state = ed.initialState(data);

  // ---- role panels ----
  const roles = ed.renderRoles(state, data);
  assert.equal((roles.match(/<fieldset/g) || []).length, ALL_ROLES.length,
    "every board role must get a panel — the 3-of-16 gap must not come back");
  for (const title of ALL_TITLES) {
    assert.ok(roles.includes(`<legend>${title}</legend>`), `missing panel: ${title}`);
  }
  assert.match(roles, /data-role="led" checked/,
    "a role the board declares must come up enabled");
  for (const field of ["peripheral", "tx", "rx"]) {
    assert.ok(roles.includes(`id="f_debug_uart_${field}"`), `UART missing ${field}`);
  }
  assert.match(roles, /id="f_debug_uart_tx"[\s\S]*?value="pa2" selected/,
    "the board's saved pin must come back selected");
  assert.match(roles, /id="f_debug_uart_baud" value="115200"/);
  for (const signal of ["sck", "miso", "mosi", "cs"]) {
    assert.ok(roles.includes(`id="f_spi_${signal}"`), `SPI missing ${signal}`);
  }
  assert.ok(roles.includes('id="f_led_pwm_channel"'),
    "PWM must offer the timer's channels, not a raw number");
  assert.ok(roles.includes("no curated can peripheral in this chip's data"),
    "an unavailable role must say WHY, not just vanish");
  assert.match(roles, /data-role="can"[^>]*disabled/);
  assert.ok(roles.includes("needs the i2c role"), "EEPROM must explain its dependency");

  // ---- a problem is shown where it happened, with a way out ----
  const broken = ed.initialState(data);
  broken.issues = [{
    level: "error", role: "i2c", field: "scl", pin: "pb3",
    message: "i2c.scl: pb3 has no route to i2c1 scl",
    suggestions: ["pb8"],
  }];
  broken.roles.i2c = { peripheral: "i2c1", scl: "pb3", sda: "pb9" };
  const brokenHtml = ed.renderRoles(broken, data);
  assert.ok(brokenHtml.includes("has no route to i2c1 scl"),
    "the message belongs on the field, not only in a banner");
  assert.match(brokenHtml, /class="fix" data-fix-role="i2c" data-fix-field="scl" data-fix-value="pb8"/,
    "the suggestion must be a one-click fix");
  assert.match(brokenHtml, /<fieldset class="[^"]*has-error"[^>]*><legend>I²C/,
    "the panel with the problem must be marked");
  const banner = ed.renderIssueBanner(broken);
  assert.ok(banner.includes("does not build") && banner.includes("no route"));

  // applying the suggestion must actually change the board.
  ed.applyField(broken, "i2c", "scl", "pb8");
  assert.equal(broken.roles.i2c.scl, "pb8");
  assert.equal(ed.buildBoard(broken, data).roles.i2c.scl, "pb8");

  // ---- pin map ----
  const map = ed.renderPinMap(state, data);
  assert.ok(map.includes("pin role") && map.includes("debug_uart tx"),
    "pins a role owns must be locked in the map");
  assert.match(map, /class="pin" data-pin="pb8"/, "free pins stay clickable");

  const flagged = ed.initialState(data);
  flagged.issues = [{ level: "error", role: "i2c", field: "scl", pin: "pb8",
                      message: "x", suggestions: [] }];
  assert.match(ed.renderPinMap(flagged, data), /class="pin bad[^"]*" data-pin="pb8"/,
    "a pin with a problem must be visible as one in the map");

  // ---- search and filter ----
  const searched = ed.initialState(data);
  searched.search = "pa5";
  const searchedMap = ed.renderPinMap(searched, data);
  const dimmed = (html, pin) =>
    new RegExp(`class="[^"]*\\bdim\\b[^"]*" data-pin="${pin}"`).test(html);
  assert.ok(!dimmed(searchedMap, "pa5"), "the searched pin must stay lit");
  assert.ok(dimmed(searchedMap, "pa2"),
    "pins that do not match the search must be dimmed, not removed");

  const bySignal = ed.initialState(data);
  bySignal.search = "usart2";
  const signalMap = ed.renderPinMap(bySignal, data);
  assert.ok(!/dim" data-pin="pa2"/.test(signalMap),
    "searching a peripheral name must match the pins that route to it");

  const filtered = ed.initialState(data);
  filtered.peripheralFilter = "i2c1";
  const filteredMap = ed.renderPinMap(filtered, data);
  assert.match(filteredMap, /dim" data-pin="pa2"/, "filter must dim other peripherals");
  assert.ok(!/dim" data-pin="pb8"/.test(filteredMap), "i2c1's own pins stay lit");
  assert.deepEqual(ed.peripheralsInMap(data), ["i2c1", "tim2", "usart2"]);

  // ---- read-only ----
  const ro = ed.initialState({ ...data, detail: { ...data.detail, editable: false } });
  const roRoles = ed.renderRoles(ro, data);
  assert.equal((roRoles.match(/<fieldset/g) || []).length, ALL_ROLES.length,
    "a curated board must still SHOW everything");
  assert.equal((roRoles.match(/<select/g) || []).length,
               (roRoles.match(/<select[^>]* disabled/g) || []).length,
    "every control on a read-only board must be disabled");
  assert.ok(!/data-role="[a-z_]+"(?![^>]*disabled)/.test(roRoles),
    "no role toggle may be operable on a read-only board");

  // ---- an older CLI with no role catalogue ----
  const { roles: _dropped, ...legacyChip } = data.chip;
  const legacy = ed.renderRoles(ed.initialState(data), { ...data, chip: legacyChip });
  assert.ok(legacy.includes("<legend>Debug UART</legend>"),
    "a pre-roles CLI must degrade to the legacy panels, not render nothing");

  // ---- what gets written back ----
  const edited = ed.initialState(data);
  delete edited.roles.led;                       // turn a role off
  edited.pins = { pb3: { function: "gpio_out", label: "RELAY" } };
  const out = ed.buildBoard(edited, data);
  assert.ok(!("led" in out.roles), "a disabled role must leave board.json");
  assert.deepEqual(out.pins, { pb3: { function: "gpio_out", label: "RELAY" } });
  assert.equal(out.chip, data.board.chip, "the chip must survive a round trip");

  const owned = ed.rolePins(edited, data);
  assert.equal(owned.pa2, "debug_uart tx");
  assert.ok(!("pa5" in owned), "the LED's pin is free once the role is off");

  await packageTests(ed, data);
  await clockTests(ed);
  await monitorTests();
  await reportTests();
  console.log("render tests passed");
}

async function reportTests() {
  const rp = await loadReport();

  // ---- memory map ----
  const size = cli(["size", "--json"]);
  const memory = rp.renderMemory(size);
  assert.ok(memory.includes("Code") && memory.includes("Data"));
  assert.ok(memory.includes("slot_a") && memory.includes("slot_b"),
    "the A/B partitions must be drawn, not just the totals");
  assert.ok(memory.includes("fits every slot"),
    "the question before a field update is whether the image fits");

  const tooBig = JSON.parse(JSON.stringify(size));
  tooBig.slots.regions[1].fits = false;
  const warned = rp.renderMemory(tooBig);
  assert.ok(warned.includes("does not fit") && warned.includes("slot_a"),
    "an image that does not fit must say which slot");
  assert.ok(warned.includes("seg slot nofit"), "and show it");

  const nothing = rp.renderMemory({
    ...size, available: false, reason: "no build yet for board 'x'" });
  assert.ok(nothing.includes("no build yet"),
    "a project that has not been built explains itself");

  // ---- board matrix ----
  const matrix = {
    boards: [
      { board: "nucleo_g071rb", chip: "st/stm32g071rb", ok: true, seconds: 2.1,
        flash: { used: 2355, total: 131072, base: 0, percent: 1.8, region: "flash" },
        ram: { used: 2150, total: 36864, base: 0, percent: 5.8, region: "sram" },
        error: null },
      { board: "esp32_devkit", chip: "espressif/esp32", ok: false, seconds: 0.3,
        flash: null, ram: null, error: "xtensa toolchain not installed" },
    ],
    built: 1, failed: 1, ok: false,
  };
  const table = rp.renderMatrix(matrix);
  assert.ok(table.includes("1 built, 1 failed"));
  assert.ok(table.includes("2.3 KB") && table.includes("128.0 KB"));
  assert.ok(table.includes("xtensa toolchain not installed"),
    "a failed board keeps its row and its reason");
  assert.ok(table.includes('class="failed"'));
  assert.ok(table.includes("No\n    preprocessor conditionals")
    || table.includes("preprocessor conditionals"),
    "say what the table is checking");

  const allGreen = { ...matrix, boards: [matrix.boards[0]], built: 1, failed: 0, ok: true };
  assert.ok(rp.renderMatrix(allGreen).includes("1 of 1 boards"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function clockTests(ed) {
  // A real graph shape: two buses at different frequencies, with the
  // consequences attached to the peripherals that have them.
  const graph = {
    chip: "st/stm32f767", profile: "pll_180mhz",
    description: "PLL 180 MHz", silicon_validated: true,
    sources: [{ name: "hsi16", hz: 16000000, selected: true },
              { name: "lse", hz: 32768, selected: false }],
    pll: { m: 8, n: 180, div: 2, vco_hz: 360000000 },
    wait_states: 5,
    nodes: [
      { name: "sysclk", label: "SYSCLK", hz: 180000000, parent: null, divider: null },
      { name: "ahb", label: "AHB · HCLK", hz: 180000000, parent: "sysclk", divider: 1 },
      { name: "apb", label: "APB · PCLK", hz: 45000000, parent: "ahb", divider: 4 },
    ],
    consumers: [
      { peripheral: "eth", class: "eth", node: "ahb", hz: 180000000, notes: [] },
      { peripheral: "usart3", class: "uart", node: "apb", hz: 45000000,
        notes: [{ level: "info", text: "115200 baud → 115089 (0.10% error)" }] },
      { peripheral: "tim1", class: "pwm", node: "apb", hz: 45000000,
        notes: [{ level: "warning", text: "16-bit counter: 687 Hz – 22500000 Hz" }] },
    ],
    unstated: ["gpioa", "iwdg"],
    issues: [{ level: "warning", peripheral: "tim1", text: "16-bit counter: 687 Hz – 22500000 Hz" }],
    solved_profile: null,
  };

  const html = ed.renderClockTree(graph);

  // The chain: the selected source, then the PLL with its real dividers.
  assert.ok(html.includes("HSI16") && html.includes("16 MHz"));
  assert.ok(!html.includes("LSE"), "only the SELECTED source belongs in the chain");
  assert.ok(html.includes("÷8 ×180 ÷2") && html.includes("VCO 360 MHz"));

  // The buses, with the divider that makes APB slower than the core — the part
  // the old linear diagram could not show at all.
  assert.ok(html.includes("AHB · HCLK") && html.includes("180 MHz"));
  assert.ok(html.includes("APB · PCLK") && html.includes("45 MHz"));
  assert.ok(html.includes("÷4"), "a divided bus must show its divider");
  assert.ok(!/ck-div">÷1</.test(html), "÷1 is noise, not information");

  // Peripherals sit under the bus that feeds them, with their consequence.
  const apbBlock = html.slice(html.indexOf("APB · PCLK"));
  assert.ok(apbBlock.includes("usart3") && apbBlock.includes("tim1"));
  assert.ok(apbBlock.includes("0.10% error"));
  const ahbBlock = html.slice(html.indexOf("AHB · HCLK"), html.indexOf("APB · PCLK"));
  assert.ok(ahbBlock.includes("eth"), "eth is on AHB, not APB");
  assert.ok(!ahbBlock.includes("usart3"));

  // Severity survives into the markup, so a bad baud rate is visible as bad.
  // Scoped to the CONSUMER row: the issues list at the bottom also emits a
  // severity class, and asserting on the whole document passed even when the
  // consumer note lost its level.
  const tim1Row = apbBlock.slice(apbBlock.indexOf("tim1"));
  assert.ok(/ck-note warning/.test(tim1Row.slice(0, 220)),
    "a warning next to the peripheral must look like a warning");

  assert.ok(html.includes("5 flash wait states") && html.includes("silicon-validated"));
  assert.ok(html.includes("gpioa") && html.includes("does not say"),
    "peripherals the data cannot place must be named, not dropped");

  // An unvalidated custom clock must say so.
  const computed = ed.renderClockTree(
    { ...graph, silicon_validated: false, wait_states: 1 });
  assert.ok(computed.includes("not silicon-validated"));
  assert.ok(computed.includes("1 flash wait state") &&
            !computed.includes("1 flash wait states"), "singular");

  // A chip with no PLL data (a named profile) still renders its buses.
  const named = ed.renderClockTree({ ...graph, pll: null, wait_states: null });
  assert.ok(!named.includes("VCO") && named.includes("APB · PCLK"));
}

async function monitorTests() {
  const m = await loadModule("src", "shared", "monitor.ts");
  const w = await loadModule("src", "webview", "monitor.ts");

  // ---- what counts as a number worth plotting ----
  assert.deepEqual(m.extractPoints({ t: 0, line: "temp=21.5 rh=48" }),
    [{ name: "temp", value: 21.5 }, { name: "rh", value: 48 }]);
  assert.deepEqual(m.extractPoints({ t: 0, line: "adc: 1003" }),
    [{ name: "adc", value: 1003 }]);
  assert.deepEqual(m.extractPoints({ t: 0, line: "count=-12" }),
    [{ name: "count", value: -12 }]);
  // Narrow on purpose: charting every bare number would chart timestamps and
  // addresses too, and a chart of nothing in particular is worse than none.
  assert.deepEqual(m.extractPoints({ t: 0, line: "booted in 42 ms" }), []);
  assert.deepEqual(m.extractPoints({ t: 0, line: "alloy uart_echo ready" }), []);

  const lines = [
    { t: 100, line: "temp=20" }, { t: 200, line: "temp=21" },
    { t: 300, line: "temp=22 rh=50" }, { t: 400, line: "hello" },
  ];
  const series = m.collectSeries(lines);
  assert.deepEqual(series.map((s) => s.name), ["rh", "temp"], "sorted by name");
  assert.equal(series[1].points.length, 3);
  assert.deepEqual(series[1].points[0], { t: 100, value: 20 });

  // A device left running overnight must not grow the panel without bound.
  const many = Array.from({ length: 500 }, (_, i) => ({ t: i, line: `x=${i}` }));
  assert.equal(m.collectSeries(many, 240)[0].points.length, 240);
  assert.equal(m.collectSeries(many, 240)[0].points.at(-1).value, 499,
    "the cap must drop the OLDEST points, not the newest");

  // ---- filtering ----
  assert.ok(m.matches("temp=21", ""));
  assert.ok(m.matches("TEMP=21", "temp"), "plain text is case-insensitive");
  assert.ok(!m.matches("hello", "temp"));
  assert.ok(m.matches("temp=21", "/^temp/"), "a /…/ filter is a regex");
  assert.ok(!m.matches("x temp=21", "/^temp/"));
  assert.ok(m.matches("anything", "/[/"), "an unfinished regex must not throw");

  // ---- timestamps ----
  assert.equal(m.stamp(0), "00:00.000");
  assert.equal(m.stamp(1234), "00:01.234");
  assert.equal(m.stamp(605000), "10:05.000");

  // ---- rendering ----
  const html = w.renderLines(lines, "");
  assert.equal((html.match(/class="mline/g) || []).length, 4);
  assert.ok(html.includes("00:00.100") && html.includes("temp=20"));
  assert.ok(w.renderLines(lines, "temp").match(/class="mline/g).length === 3,
    "the filter hides lines, and the ones left keep their stamps");
  assert.ok(w.renderLines([], "").includes("waiting for the device"));
  assert.ok(w.renderLines(lines, "zzz").includes("nothing matches"));
  assert.ok(w.renderLines([{ t: 5, line: "> ", partial: true }], "")
    .includes("mline partial"), "a prompt with no newline is marked, not hidden");

  // Device output is not markup.
  assert.ok(w.renderLines([{ t: 0, line: "<script>x</script>" }], "")
    .includes("&lt;script&gt;"), "a device must not be able to inject HTML");

  const charts = w.renderSeries(lines);
  assert.ok(charts.includes("temp") && charts.includes("<path"));
  assert.ok(charts.includes("20 … 22"), "the range tells you the scale");
  assert.equal(w.renderSeries([{ t: 0, line: "no numbers here" }]), "",
    "no numbers means no chart, not an empty one");

  // A single point has no line to draw, and must not produce a broken path.
  assert.equal(m.sparkPath([{ value: 1 }], 100, 10), "");
  assert.ok(m.sparkPath([{ value: 1 }, { value: 2 }], 100, 10).startsWith("M0.0,"));
  // A flat series must not divide by zero. Asserting on the shape alone was not
  // enough: without the guard the path is "M0.0,NaN L100.0,NaN", which still
  // contains the coordinates and renders nothing.
  const flat = m.sparkPath([{ value: 5 }, { value: 5 }], 100, 10);
  assert.ok(!flat.includes("NaN"), `flat series produced ${flat}`);
  assert.ok(/M0\.0,\d/.test(flat) && /L100\.0,\d/.test(flat));
}

async function packageTests(ed, data) {
  // A small quad package with a supply pad and a reset, so the four sides and
  // the non-assignable pins are both exercised.
  const pkg = {
    type: "LQFP16", pins: 16, part: "FAKE16Tx",
    layout: Array.from({ length: 16 }, (_, i) => {
      const n = String(i + 1);
      if (i === 3) return { position: n, signal: "vdd", kind: "power" };
      if (i === 7) return { position: n, signal: "nrst", kind: "reset" };
      if (i === 11) return { position: n, signal: "vss", kind: "ground" };
      return { position: n, signal: `pa${i}`, kind: "gpio" };
    }),
  };
  const withPkg = { ...data, chip: { ...data.chip, package: pkg } };
  const state = ed.initialState(withPkg);

  // The view defaults to physical exactly when the data can back one up.
  assert.equal(state.physical, true, "a chip WITH a pinout opens on the package");
  assert.equal(ed.initialState(data).physical, false,
    "a chip without one must not default to a view it cannot draw");

  const html = ed.renderPinMap(state, withPkg);
  assert.ok(html.includes("pk quad"), "a numeric pinout draws as a quad package");
  assert.ok(html.includes("FAKE16Tx") && html.includes("LQFP16 · 16 pins"));
  assert.equal((html.match(/class="pk-pin/g) || []).length, 16,
    "every pin of the package must be drawn, supply pads included");
  // Count per side, not just the presence of the containers: with a broken
  // split the four divs still exist and every pin lands in one of them.
  const side = (name) => {
    const open = html.indexOf(`class="pk-${name}"`);
    const chunk = html.slice(open, html.indexOf("</div>", open));
    return (chunk.match(/class="pk-pin/g) || []).length;
  };
  for (const name of ["top", "bottom", "left", "right"]) {
    assert.equal(side(name), 4, `${name} side should hold 4 of the 16 pins`);
  }

  // Supply pads are shown but are not a choice.
  assert.match(html, /class="pk-pin supply[^"]*" disabled[^>]*>[\s\S]{0,90}vdd/,
    "a power pad is drawn, and not clickable");
  assert.ok(!/data-pin="vdd"/.test(html), "a supply pad is not assignable");
  assert.ok(/data-pin="pa0"/.test(html), "a GPIO is");

  // Role locks and validation errors carry over from the logical map.
  const busy = ed.initialState(withPkg);
  busy.roles = { led: { pin: "pa1" } };
  assert.match(ed.renderPinMap(busy, withPkg), /class="pk-pin role[^"]*"[^>]*disabled/,
    "a pin a role owns is locked in the package view too");
  const broken = ed.initialState(withPkg);
  broken.issues = [{ level: "error", role: "i2c", field: "scl", pin: "pa2",
                     message: "x", suggestions: [] }];
  assert.ok(ed.renderPackage(broken, pkg, {}, new Set(["pa2"])).includes("pk-pin bad"));

  // Switching back gives the port list, unchanged.
  const logical = { ...state, physical: false };
  assert.ok(ed.renderPinMap(logical, withPkg).includes("portname"),
    "the per-port view must still work when the package is available");

  // A BGA is a grid, not four sides.
  const bga = {
    type: "UFBGA4", pins: 4, layout: [
      { position: "A1", signal: "pa0", kind: "gpio" },
      { position: "A2", signal: "pa1", kind: "gpio" },
      { position: "B1", signal: "vdd", kind: "power" },
      { position: "B2", signal: "vss", kind: "ground" },
    ],
  };
  const grid = ed.renderPackage(ed.initialState(withPkg), bga, {}, new Set());
  assert.ok(grid.includes("pk grid") && grid.includes("pk-rowlabel"));
  assert.ok(grid.includes("4 balls"), "a BGA has balls, not pins");
  assert.ok(!grid.includes("pk-top"), "a grid has no sides to lay pins along");

  // Device data is not markup, here either.
  const nasty = { ...pkg, part: "<script>x</script>" };
  assert.ok(ed.renderPackage(state, nasty, {}, new Set()).includes("&lt;script&gt;"));
}
