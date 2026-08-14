// Monitor rendering, including decoded bus datagrams — no VS Code, no DOM.
//
// The panel's job with a bus message is presentation only: the CLI already
// decoded the frame against the project's bus.toml (guardrail #1 — no domain
// logic in TypeScript), so what is checked here is that a decoded message
// reaches the log readably, is marked apart from log text, and flows into the
// same filter and sparkline machinery as everything else.

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

async function loadModule(...segments) {
  const built = await esbuild.build({
    entryPoints: [resolve(ROOT, ...segments)],
    bundle: true, format: "esm", write: false, platform: "neutral",
    target: "es2020", logLevel: "silent",
  });
  return import("data:text/javascript;base64,"
    + Buffer.from(built.outputFiles[0].text).toString("base64"));
}

const shared = await loadModule("src", "shared", "monitor.ts");
const view = await loadModule("src", "webview", "monitor.ts");

const PING = { id: 0x0301, ver: 1, seq: 3, name: "ping",
               fields: { token: 3405705217 } };
const READING = { id: 0x0101, ver: 2, seq: 4, name: "reading",
                  fields: { centi_c: 2543, ok: true } };
const UNKNOWN = { id: 0x0999, ver: 1, seq: 9, raw: "aabb" };
const STALE = { id: 0x0301, ver: 7, seq: 1, name: "ping", raw: "01020304",
                note: "manifest declares v1" };

// --- the log text -----------------------------------------------------------
{
  assert.equal(shared.busLine(PING), "[bus] ping  seq=3  token=3405705217");
  assert.equal(shared.busLine(READING),
    "[bus] reading  seq=4  centi_c=2543  ok=true");
  // An id the manifest cannot name still says everything known about it.
  assert.equal(shared.busLine(UNKNOWN), "[bus] 0x0999  seq=9  raw=aabb");
  // A stale peer: the id is named, the body is not trusted, and the line
  // says what the manifest expected instead.
  assert.equal(shared.busLine(STALE),
    "[bus] ping  seq=1  raw=01020304  (manifest declares v1)");
}

// --- rendering --------------------------------------------------------------
{
  const lines = [
    { t: 10, line: "alloy bus_bridge ready" },
    { t: 20, line: shared.busLine(PING), bus: PING },
    { t: 30, line: shared.busLine(UNKNOWN), bus: UNKNOWN },
  ];
  const html = view.renderLines(lines, "");

  // Log text is not marked; a decoded datagram is; an unnamed id is marked
  // again so it stands out from the messages that decoded cleanly.
  assert.ok(html.includes('class="mline"'), "log text must stay plain");
  assert.ok(html.includes('class="mline bus"'), "a decoded message is marked");
  assert.ok(html.includes('class="mline bus unnamed"'),
    "an id the manifest could not name is marked apart");
  assert.ok(html.includes("token=3405705217"));

  // Device data is not markup, here either.
  const nasty = [{ t: 1, line: shared.busLine({ ...UNKNOWN, raw: "<script>" }),
                   bus: UNKNOWN }];
  assert.ok(view.renderLines(nasty, "").includes("&lt;script&gt;"));
}

// --- bus messages are ordinary log citizens ---------------------------------
{
  const lines = [
    { t: 10, line: "boot" },
    { t: 20, line: shared.busLine(READING), bus: READING },
  ];
  // The filter box works on them...
  assert.ok(view.renderLines(lines, "reading").includes("centi_c=2543"));
  assert.ok(!view.renderLines(lines, "reading").includes(">boot<"));

  // ...and so does the sparkline collector, which is why fields are rendered
  // as name=value in decimal: a telemetry message charts itself.
  const series = shared.collectSeries(lines);
  const names = series.map((s) => s.name);
  assert.ok(names.includes("centi_c"),
    `a numeric bus field must become a series, got ${names.join(", ")}`);
  const centi = series.find((s) => s.name === "centi_c");
  assert.deepEqual(centi.points, [{ t: 20, value: 2543 }]);
}

console.log("monitor render tests: ok");
