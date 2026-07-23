const assert = require("node:assert");
const vscode = require("vscode");

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
      "alloy.setup", "alloy.newProject", "alloy.pickBoard", "alloy.build",
      "alloy.flash", "alloy.run", "alloy.monitor", "alloy.clean",
      "alloy.debug", "alloy.generateLaunchJson",
      "alloy.refreshTools", "alloy.installTools",
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
});
