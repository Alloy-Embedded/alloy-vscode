const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

async function waitFor(cond, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("alloy-vscode smoke", () => {
  it("activates on the alloy.toml workspace", async () => {
    const ext = vscode.extensions.getExtension("alloy-embedded.alloy-vscode");
    assert.ok(ext, "extension not found");
    await ext.activate();
    assert.ok(ext.isActive, "extension did not activate");
  });

  it("registers every alloy command", async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of [
      "alloy.setup", "alloy.newProject", "alloy.pickBoard", "alloy.configureBoard", "alloy.build",
      "alloy.flash", "alloy.run", "alloy.monitor", "alloy.clean",
      "alloy.debug", "alloy.generateLaunchJson",
      "alloy.refreshTools", "alloy.installTools",
      "alloy.addLibrary", "alloy.refreshLibraries", "alloy.updateDevice",
    ]) {
      assert.ok(all.includes(cmd), `missing command ${cmd}`);
    }
  });

  it("runs the build command end-to-end against the stubbed CLI", async () => {
    const done = new Promise((resolve, reject) => {
      const sub = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution.task.source === "alloy") {
          sub.dispose();
          e.exitCode === 0
            ? resolve()
            : reject(new Error(`task exited ${e.exitCode}`));
        }
      });
      setTimeout(() => reject(new Error("task never finished")), 20000);
    });
    await vscode.commands.executeCommand("alloy.build");
    await done;
  });

  it("opens the chip configurator (pin map + clock) on the custom board", async () => {
    // The fixture has boards/nucleo_g0b1re/board.json (a custom board), so the
    // configurator must open: this exercises chipInfo (including the per-pin
    // "pins" payload from the stub) and renderHtml end-to-end. A parse/render
    // regression rejects this promise.
    await vscode.commands.executeCommand("alloy.configureBoard");
  });

  it("updates a device end-to-end (ports -> build both slots -> alloy update)", async () => {
    const markers = process.env.ALLOY_STUB_DIR;
    const marker = path.join(markers, "update");
    fs.rmSync(marker, { force: true });
    const orig = { showQuickPick: vscode.window.showQuickPick, showInputBox: vscode.window.showInputBox };
    const done = new Promise((resolve, reject) => {
      const sub = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution.task.definition.action === "update") {
          sub.dispose();
          e.exitCode === 0 ? resolve() : reject(new Error(`update task exited ${e.exitCode}`));
        }
      });
      setTimeout(() => reject(new Error("update task never finished")), 20000);
    });
    try {
      vscode.window.showQuickPick = async (items) => (Array.isArray(items) ? items : await items)[0];
      vscode.window.showInputBox = async () => "123";
      await vscode.commands.executeCommand("alloy.updateDevice");
      await done;
    } finally {
      vscode.window.showQuickPick = orig.showQuickPick;
      vscode.window.showInputBox = orig.showInputBox;
    }
    await waitFor(() => fs.existsSync(marker), 5000);
    const args = fs.readFileSync(marker, "utf8");
    assert.match(args, /--port \/dev\/fake0/);
    assert.match(args, /--image-a/);
    assert.match(args, /--image-b/);
  });

  it("adds a driver library end-to-end (alloy lib add)", async () => {
    const markers = process.env.ALLOY_STUB_DIR;
    assert.ok(markers, "ALLOY_STUB_DIR not set by runTest.js");
    const marker = path.join(markers, "lib-add-sht31");
    fs.rmSync(marker, { force: true });
    // The command passes the name straight through, so no quick-pick is needed.
    await vscode.commands.executeCommand("alloy.addLibrary", "sht31");
    await waitFor(() => fs.existsSync(marker), 10000);
    assert.ok(fs.existsSync(marker), "extension never invoked `alloy lib add sht31`");
  });

  it("creates a project from a board end-to-end (alloy new --board)", async () => {
    const markers = process.env.ALLOY_STUB_DIR;
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "avt-new-"));
    const projName = "e2e_board_proj";
    const marker = path.join(markers, `new-${projName}`);
    fs.rmSync(marker, { force: true });

    const orig = {
      showQuickPick: vscode.window.showQuickPick,
      showInputBox: vscode.window.showInputBox,
      showOpenDialog: vscode.window.showOpenDialog,
      executeCommand: vscode.commands.executeCommand,
    };
    try {
      // The wizard asks: mode (board/chip), vendor, board — always take the first
      // (board mode; vendor "st"; board "nucleo_g0b1re", the only stubbed board).
      vscode.window.showQuickPick = async (items) => {
        const arr = Array.isArray(items) ? items : await items;
        return arr[0];
      };
      vscode.window.showInputBox = async () => projName;
      vscode.window.showOpenDialog = async () => [vscode.Uri.file(parent)];
      // openProject would reload the test window; swallow only that one command.
      vscode.commands.executeCommand = async (cmd, ...args) =>
        cmd === "vscode.openFolder"
          ? undefined
          : orig.executeCommand.call(vscode.commands, cmd, ...args);

      await orig.executeCommand.call(vscode.commands, "alloy.newProject");
      await waitFor(() => fs.existsSync(marker), 10000);
    } finally {
      vscode.window.showQuickPick = orig.showQuickPick;
      vscode.window.showInputBox = orig.showInputBox;
      vscode.window.showOpenDialog = orig.showOpenDialog;
      vscode.commands.executeCommand = orig.executeCommand;
    }

    assert.ok(fs.existsSync(marker), "extension never invoked `alloy new … --board`");
    assert.ok(
      fs.existsSync(path.join(parent, projName, "alloy.toml")),
      "the new project was not scaffolded in the chosen parent",
    );
  });
});
