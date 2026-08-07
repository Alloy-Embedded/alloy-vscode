import assert from "node:assert/strict";
import * as esbuild from "esbuild";
const built = await esbuild.build({
  entryPoints: ["src/shared/projectToml.ts"], bundle: true, format: "esm",
  write: false, platform: "neutral", target: "es2020", logLevel: "silent" });
const m = await import("data:text/javascript;base64,"
  + Buffer.from(built.outputFiles[0].text).toString("base64"));

const base = `[project]
name = "demo"   # my project

[board]
id = "nucleo_g071rb"

[alloy]
root = "/somewhere"
`;

// Adding overrides must not disturb a single existing line, comment included.
const withBaud = m.applyOverrides(base, { roles: { debug_uart: { baud: 921600 } } });
for (const line of ['name = "demo"   # my project', 'id = "nucleo_g071rb"', 'root = "/somewhere"']) {
  assert.ok(withBaud.includes(line), `lost: ${line}`);
}
assert.ok(withBaud.includes("[roles.debug_uart]\nbaud = 921600"));

// Re-applying replaces, never duplicates.
const twice = m.applyOverrides(withBaud, { roles: { debug_uart: { baud: 115200 } } });
assert.equal((twice.match(/\[roles\.debug_uart\]/g) || []).length, 1);
assert.ok(twice.includes("baud = 115200") && !twice.includes("921600"));

// Clearing them leaves the file as it started.
const cleared = m.applyOverrides(twice, { roles: {} });
assert.ok(!cleared.includes("[roles."), "an empty section must not be written");
assert.equal(cleared.trim(), base.trim(), "clearing must restore the original");

// Sections it does not manage are never touched.
const withOta = base + '\n[ota]\npublic_key = "keys/update.pub"\n';
const kept = m.applyOverrides(withOta, { roles: { watchdog: { timeout_ms: 1500 } } });
assert.ok(kept.includes('public_key = "keys/update.pub"'), "[ota] must survive");

// Clock: profile and mhz are exclusive.
assert.ok(m.applyOverrides(base, { roles: {}, clock: { profile: "hsi_16mhz" } })
  .includes('[clock]\nprofile = "hsi_16mhz"'));
const mhz = m.applyOverrides(base, { roles: {}, clock: { mhz: 48 } });
assert.ok(mhz.includes("[clock]\nmhz = 48") && !mhz.includes("profile"));

// Reading back what was written is the round trip the editor relies on.
const back = m.readOverrides(twice);
assert.equal(back.roles.debug_uart.baud, 115200);
assert.equal(m.readOverrides(mhz).clock.mhz, 48);
assert.deepEqual(m.readOverrides(base), { roles: {}, clock: null });


// ---- a section the editor cannot see ----
{
  const toml = [
    '[project]', 'name = "p"', '',
    '# I want this back when the board grows a watchdog',
    '[roles.watchdog]', 'timeout_ms = 2000', '',
    '[roles.debug_uart]', 'baud = 921600',
  ].join("\n") + "\n";

  // The editor only renders the roles the board defines. Rebuilding the block
  // from what it knows would silently drop the watchdog line.
  const rendered = ["led", "debug_uart"];
  const naive = m.applyOverrides(toml, { roles: { debug_uart: { baud: 921600 } } });
  assert.ok(!naive.includes("timeout_ms"),
    "control: rebuilding from the editor alone does lose the line");

  const kept2 = m.applyOverrides(toml,
    m.keepUnrendered(toml, { roles: { debug_uart: { baud: 921600 } } }, rendered));
  assert.match(kept2, /\[roles\.watchdog\]\ntimeout_ms = 2000/,
    "a role the editor never showed must survive a save");
  assert.match(kept2, /baud = 921600/, "and the edited one is still written");
  assert.equal((kept2.match(/\[roles\.watchdog\]/g) || []).length, 1,
    "kept once, not duplicated");

  // A rendered role that the editor turned off must still go.
  const cleared2 = m.applyOverrides(toml, m.keepUnrendered(toml, { roles: {} }, rendered));
  assert.ok(!cleared2.includes("baud"),
    "clearing a field the editor DOES show must remove it");
  assert.match(cleared2, /timeout_ms = 2000/, "without taking the other with it");
}

console.log("project-toml tests passed");
