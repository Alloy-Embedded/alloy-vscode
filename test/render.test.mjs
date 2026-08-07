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

/** The webview app. It imports nothing but src/shared/, so it loads in Node. */
async function loadEditor() {
  const built = await esbuild.build({
    entryPoints: [resolve(ROOT, "src", "webview", "editor.ts")],
    bundle: true, format: "esm", write: false, platform: "neutral",
    target: "es2020", logLevel: "silent",
  });
  return import("data:text/javascript;base64,"
    + Buffer.from(built.outputFiles[0].text).toString("base64"));
}

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

  console.log("render tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
