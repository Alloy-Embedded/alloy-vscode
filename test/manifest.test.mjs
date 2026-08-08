// The manifest's own promises — the ones nothing else checks.
//
// A walkthrough is data, not code: a `command:` link that names a command the
// extension does not register renders as a dead button, and a media path that
// does not survive packaging renders as a broken image. Neither fails a build,
// neither throws at runtime, and neither is visible until someone installs the
// published .vsix and clicks. So they are asserted here.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

const declared = new Set(pkg.contributes.commands.map((c) => c.command));
const walkthroughs = pkg.contributes.walkthroughs ?? [];
assert.ok(walkthroughs.length, "the manifest must contribute a walkthrough");

for (const wt of walkthroughs) {
  assert.ok(wt.steps?.length, `${wt.id} has no steps`);

  for (const step of wt.steps) {
    // ---- every command the step offers must exist ----
    const links = [...String(step.description).matchAll(/command:([\w.]+)/g)]
      .map((m) => m[1]);
    assert.ok(links.length, `${wt.id}/${step.id} offers no command to run`);
    for (const command of links) {
      assert.ok(declared.has(command),
        `${wt.id}/${step.id} links command:${command}, which the manifest does `
        + "not declare — it would render as a button that does nothing");
    }

    // ---- and so must every command that would tick it off ----
    for (const event of step.completionEvents ?? []) {
      if (!event.startsWith("onCommand:")) {
        continue;
      }
      const command = event.slice("onCommand:".length);
      assert.ok(declared.has(command),
        `${wt.id}/${step.id} completes on ${event}, which is never fired — the `
        + "step would stay unchecked forever");
    }

    // ---- the media has to be there, and has to be readable ----
    const media = step.media?.svg ?? step.media?.markdown ?? step.media?.image;
    assert.ok(media, `${wt.id}/${step.id} has no media`);
    const path = resolve(ROOT, media);
    assert.ok(existsSync(path), `${wt.id}/${step.id}: missing ${media}`);
    assert.ok(step.media.altText, `${wt.id}/${step.id}: media needs altText`);

    if (media.endsWith(".svg")) {
      const svg = readFileSync(path, "utf8");
      assert.match(svg, /viewBox=/, `${media} needs a viewBox to scale`);
      // Walkthroughs render on the editor's own background, in whatever theme
      // the user picked. A baked-in colour is invisible in half of them.
      const literal = svg.match(/(?:fill|stroke)="(#[0-9a-f]{3,8}|black|white)"/i);
      assert.equal(literal, null,
        `${media} hardcodes ${literal?.[1]} — use currentColor, or it `
        + "disappears in the themes that do not match");
    }
  }
}

// ---- and it must all survive packaging ----
//
// .vscodeignore excludes whole directories; a new media/ subfolder is one
// careless pattern away from being dropped, and the failure only shows up in
// the published extension.
const listed = execFileSync("npx", ["vsce", "ls", "--no-dependencies"],
  { cwd: ROOT, encoding: "utf8" })
  .split("\n").map((l) => l.trim()).filter(Boolean);

for (const wt of walkthroughs) {
  for (const step of wt.steps) {
    const media = step.media?.svg ?? step.media?.markdown ?? step.media?.image;
    assert.ok(listed.includes(media),
      `${media} is not in the .vsix — the walkthrough would show a broken image`);
  }
}

console.log(`manifest tests passed (${walkthroughs[0].steps.length} walkthrough steps)`);
