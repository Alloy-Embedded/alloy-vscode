# Changelog

## Unreleased

- **The monitor panel understands `libs/bus` datagrams.** A project with a
  `bus.toml` sees its messages in the log — `[bus] reading seq=12
  centi_c=2543 ok=true` — on the same timeline as the printf output that
  surrounds them, marked apart from it, with an id the manifest could not
  name dimmed further (that is the state you opened the panel to notice).
  Because fields render as `name=value`, numeric telemetry flows into the
  existing sparklines and the filter box works on messages like any other
  line — no new UI, no new plumbing.

  No frame parsing landed in TypeScript: `alloy monitor --json` decodes
  against the project's own registry and streams decoded messages, so the
  panel renders what the CLI already understood (guardrail #1). That also
  means no manifest fetch — the extension needs no new CLI call at all.
  Requires an alloy CLI new enough to decode; older ones simply stream the
  frames as the raw text they always did.

## 0.3.0 — 2026-08-08

### A way in

- **Get started with Alloy** — a five-step walkthrough, featured the moment a
  workspace has an `alloy.toml`. It goes from nothing installed to the same
  firmware built for nine boards, and none of it needs hardware: install the
  CLI, start from a curated board, open the chip, run it under Renode, then
  check the portability claim with Build All Boards.
- The extension contributes 23 commands and had no guided path to the first
  one. This is that path.

## 0.2.0 — 2026-08-07

Published as **`alloy-embedded.alloy-embedded`**, matching the CLI's PyPI name.
The marketplace requires globally unique extension names and `alloy-vscode` is
taken by an unrelated publisher; the id also disambiguates this from the several
extensions for the Alloy formal specification language, which it has nothing to
do with.

First release published to the marketplace. Everything below already worked
against a source checkout; this is the version a stranger can install.

**Requires the `alloy` CLI 0.3.0 or newer.** The extension now says so at
startup instead of accepting an older one and failing later on a verb it does
not have.

### The configurator became one

- **Any board opens.** A curated board is read-only, with a one-click
  duplicate — editing it in place would change every project that uses it.
- **What the project chooses stays editable on a curated board**, and is
  written to `alloy.toml`: baud, watchdog timeout, reserved flash, the clock.
  Raising the debug baud of a framework board no longer means forking it, and
  the field says what the board itself specifies beside your value.
- **All sixteen board roles**, driven by the chip's own role catalogue: a role
  the silicon cannot fill is disabled *with the reason*, an uncurated
  peripheral is listed but unpickable, and a role this panel cannot describe
  shows its `board.json` verbatim rather than dropping fields on save.
- **The physical package** — pins on the four sides of the die, or a ball grid
  with its depopulated centre where the part has one. Only ever drawn from
  curated data; a chip without trustworthy pinout data keeps the per-port map.
- **Problems land on the field that caused them**, with the values that would
  work as one-click fixes, and applying no longer closes the panel: it writes,
  revalidates, and repaints.
- **The whole clock tree** — sources, bus prescalers, and the clock each
  peripheral is fed, with the baud error and timer range that follow from it.

### New panels and commands

- **Build All Boards** — the same sources on every target, with sizes.
- **Memory & Partitions** — flash and RAM against the chip's real memories,
  plus the A/B slot layout and whether the image fits.
- **Monitor Panel** — timestamps, a text-or-regex filter, a line to send, and a
  sparkline per `name=value` the device logs.
- **Emulate (Renode)** — run the firmware with no hardware attached.
- **Generate CI Workflow** — `alloy ci-init` from the sidebar.
- **Debug** now passes a generated CMSIS-SVD, so peripheral registers show by
  name.

### Under it

- The webview has its own bundle; rendering is pure functions tested in Node,
  which is how the panels are checked rather than hoped about.
- The command test reads `package.json`, so a command contributed but never
  registered fails the suite instead of the user.
- The `.vsix` no longer ships `src/` and `test/`: 162 KB → 40 KB.

## 0.1.0 — unreleased

Project wizard, board picker, status bar, tasks with a GCC problem matcher,
toolchain view, library manager, ARM debug via Cortex-Debug, Update Device.
