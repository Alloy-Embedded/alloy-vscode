const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
  const fixture = path.resolve(__dirname, "fixture");
  const stubDir = path.resolve(__dirname, "stub");
  // Point the extension at the stub via its own setting — the documented
  // channel, immune to env-propagation quirks of the extension host.
  fs.mkdirSync(path.join(fixture, ".vscode"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, ".vscode", "settings.json"),
    JSON.stringify({ "alloy.cliPath": path.join(stubDir, "alloy") }, null, 2),
  );
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        fixture,
        "--disable-extensions",
        // Short tmp path: VS Code opens a unix socket under user-data-dir
        // and macOS caps socket paths at 104 chars (repo path has spaces).
        "--user-data-dir", fs.mkdtempSync(path.join(os.tmpdir(), "avt-")),
      ],
      extensionTestsEnv: { PATH: `${stubDir}:${process.env.PATH}` },
    });
  } catch {
    console.error("tests failed");
    process.exit(1);
  }
}
main();
