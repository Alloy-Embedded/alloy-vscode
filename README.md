# Alloy Embedded — VS Code Extension

Zero-to-blink on any supported board — and any MCU — for the
[Alloy framework](https://github.com/Alloy-Embedded/alloy). One portable C++23 app, any silicon.

## What it does

- **Alloy: New Project** — a wizard with two paths:
  - **From a supported board** — pick vendor → board, name it, scaffold.
  - **Custom board — choose an MCU** — pick any chip from the database; you get a clean, editable
    board (`boards/<name>/board.json`) with the MCU and a safe clock set, and you fill in the pins.
    Free to build for whatever silicon you want.
- **Libraries (drivers)** — browse the driver registry (sensors, displays, RTCs…) grouped by
  category in the side bar, and **add** one with a click (`alloy lib add`) — it's vendored into the
  project and wired into the build automatically. `#include <sht31.hpp>` and go.
- **Alloy: Setup Environment** — verify/install toolchains via `alloy setup` (all visible in the
  terminal; the extension never downloads a toolchain on its own).
- **Status bar + panel** — current board plus build / flash / run / monitor / debug, one click each.
- **Tasks** of type `alloy` (build/flash/run/monitor/clean/gen) with a GCC problem matcher —
  compile errors land in the Problems panel.
- **Alloy: Pick Board** — switch the project's board (`alloy set-board`).

IntelliSense works out of the box: `alloy build` emits `compile_commands.json`, so clangd picks up
every include and define with no extra setup.

## Requirements

The `alloy` CLI (>= 0.1.0):

```
uv tool install alloy-embedded      # or: pipx install alloy-embedded
```

For a source checkout, point `alloy.cliPath` at it in settings (e.g. a wrapper that runs
`uv --project <checkout>/tools/alloy run alloy`). The Libraries view and custom-board wizard need a
recent CLI (`lib list --json`, `chips --json`).

## Development

```
npm install
npm run build      # typecheck + bundle (esbuild -> dist/)
npm test           # headless VS Code integration tests
# F5 in VS Code opens the Extension Development Host
npx vsce package --no-dependencies
```

Architecture and guardrails: [NORTH_STAR.md](NORTH_STAR.md). The CLI is the brain — the extension
holds no domain logic; every fact comes through `alloy … --json`.
