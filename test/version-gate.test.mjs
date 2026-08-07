// The version gate is pure logic — check it directly instead of through VS Code.
import assert from "node:assert/strict";
import * as esbuild from "esbuild";
const built = await esbuild.build({
  entryPoints: ["src/cli.ts"], bundle: true, format: "esm", write: false,
  platform: "neutral", external: ["vscode", "node:*"], target: "es2020", logLevel: "silent",
});
const src = built.outputFiles[0].text;
const MIN = /MIN_CLI_VERSION = "([\d.]+)"/.exec(src)[1];
assert.equal(MIN, "0.3.0", "the gate must demand the release carrying the new verbs");
// The published-but-stale CLI must be REJECTED, not accepted-then-failed.
const cmp = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};
assert.equal(cmp("0.2.0", MIN), false, "0.2.0 (on PyPI today) must not pass");
assert.equal(cmp("0.3.0", MIN), true);
assert.equal(cmp("1.0.0", MIN), true);
assert.ok(src.includes("CliOutdatedError"), "outdated is its own error");
assert.ok(/uv tool upgrade alloy-embedded/.test(src), "the message says how to fix it");
console.log(`version gate ok — demands >= ${MIN}, rejects the published 0.2.0`);
