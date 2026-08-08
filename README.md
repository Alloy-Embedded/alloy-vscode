# Alloy Embedded

Configure, build, flash and debug embedded C++ from the editor — for the
[Alloy framework](https://github.com/Alloy-Embedded/alloy), where one portable `main.cpp`
recompiles for any supported MCU by changing a line.

```cpp
#include <alloy/board.hpp>
using namespace alloy::literals;

int main() {
    board::init();
    while (true) { board::led.toggle(); alloy::sleep_for(500ms); }
}
```

## Start here

**Get started with Alloy** (Help → Get Started, or the Welcome page) walks the
first project end to end — CLI, board, configurator, emulator, and the
nine-board build — without any hardware attached.

## Configure the board

**Alloy: Configure Board** opens the chip, not a form:

- **The package** — pins on the four sides of the die (or a ball grid), drawn from curated pinout
  data. Click a free pin to give it a function and a name; role pins are locked and managed by
  their panel. Chips whose pinout data cannot be trusted keep a per-port map and say why, rather
  than showing a drawing that might be wrong.
- **Every board role** — LED, button, UART, I²C, SPI, PWM, ADC, DAC, CAN, RTC, watchdog, Ethernet,
  EEPROM, key/value store, filesystem, GPIO bus. Each offers only what the silicon actually has;
  one it cannot do is disabled **with the reason**.
- **Problems where they happen** — a pin with no route to its peripheral is a `static_assert` that
  would fire at build time, when the app opens the bus. Here it is a message on the field, with the
  pins that *would* work as one-click fixes.
- **The clock** — a preset profile or any frequency you type, then the whole tree: bus prescalers
  and the clock each peripheral is fed, with what it implies (a UART's baud error computed the way
  the driver computes it, a timer's reachable range).

Curated boards open read-only — editing one would change every project that uses it — with
**Duplicate to edit**. What the *project* chooses stays editable there anyway: a baud rate, a
watchdog timeout, how much flash to reserve, the clock. Those go to `alloy.toml`, shown with what
the board itself says, so you can run a framework board faster without forking it.

## Build, run, look

- **Build All Boards** — the same sources on every board you target, with flash and RAM side by
  side. That is the framework's claim; this is it checked.
- **Memory & Partitions** — what the last build costs against the chip's real memories, and whether
  the packed image fits each A/B update slot.
- **Emulate (Renode)** — run the firmware with no hardware attached.
- **Monitor Panel** — the serial log with timestamps, a filter (text or `/regex/`), a line to send
  back, and a sparkline for every `name=value` the device prints.
- **Debug** — starts a Cortex-Debug session with no file rewritten, and generates a CMSIS-SVD so
  the debugger shows peripheral registers by name.
- **Update Device (UART)** — builds both slot images and streams the right one; the device reports
  which slot it wants, so you cannot ship a wrong-slot binary.
- **Generate CI Workflow** — a GitHub Actions file that validates your boards and builds your
  sources for each of them.
- **Libraries** — browse the driver registry (sensors, displays, RTCs) and add one with a click;
  it is vendored and wired into the build. `#include <sht31.hpp>` and go.

Tasks of type `alloy` carry a GCC problem matcher, so compile errors land in the Problems panel.
IntelliSense needs no setup: the build emits `compile_commands.json`.

## Requirements

The `alloy` CLI, **0.3.0 or newer**:

```
uv tool install alloy-embedded
```

Every fact this extension shows comes from that CLI over versioned JSON — the extension holds no
knowledge of silicon. If yours is older, the Toolchains view says so and offers the upgrade.

For a source checkout, point `alloy.cliPath` at it in settings.

## Known limits

- STM32G0 and G4 boards get the per-port pin map, not the package drawing: their upstream pinout
  data does not survive the plausibility check, and a wrong footprint is worse than none.
- RP2040 and ESP32 have no machine-readable pinout published at all.
- The UI is English throughout, on purpose — see NORTH_STAR.md.

## Development

```
npm install
npm run build      # typecheck + bundle (esbuild -> dist/)
npm test           # unit + render tests, then headless VS Code integration
```

### Releasing

Push a tag `vX.Y.Z` that matches `package.json`. The workflow refuses to publish
if the tag disagrees, or if the CLI version `MIN_CLI_VERSION` demands is not on
PyPI yet — release the CLI first. Needs `VSCE_PAT` in repo secrets; `OVSX_PAT`
is optional and its step is skipped when absent.

Architecture and guardrails: [NORTH_STAR.md](https://github.com/Alloy-Embedded/alloy-vscode/blob/main/NORTH_STAR.md).
The CLI is the brain — every fact comes through `alloy … --json`.

License: MIT
