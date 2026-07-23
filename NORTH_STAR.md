# alloy-vscode — NORTH STAR

Extensão VS Code do alloy: do zero ao blink com UM clique, em Windows,
Linux e macOS — **sem virar um segundo cérebro**.

## Doutrina

**A extensão é uma casca fina sobre o CLI.** Todo fato (boards, toolchains,
portas, configs de debug) e todo comportamento (gerar, buildar, gravar,
monitorar, instalar) vivem no `alloy` (Python). A extensão apenas:
localiza o CLI → invoca verbos → parseia envelopes JSON versionados →
apresenta (statusbar, QuickPick, Tasks, Terminal, launch.json).

É o mesmo contrato do framework ("facts are generated, behavior is
hand-written"): quem usa terminal puro tem EXATAMENTE as mesmas
capacidades; o plugin só remove atrito.

## Guardrails (anti-deriva)

1. **Nenhuma lógica de domínio em TypeScript.** Se a extensão precisa de
   um fato ou ação, cria-se verbo/flag no CLI. A revisão rejeita PRs que
   dupliquem conhecimento (mapas openocd, globs de porta, URLs de
   toolchain) no lado TS.
2. **A extensão só baixa UMA coisa: o binário `uv`** (pinado, sha256
   verificado, para `~/.alloy/tools/uv`) para então rodar
   `uv tool install alloy-embedded`. Toolchains são SEMPRE do `alloy setup`
   (PATH-first: usa o que o sistema já tem; baixa só o que falta, de um
   manifest `toolchains.json` com sha256 DENTRO do pacote do CLI).
3. **Envelopes JSON versionados** com handshake `alloy --version` contra
   um mínimo suportado; saída humana e saída máquina nunca se misturam.
4. **Não reescrever arquivos do usuário.** Tasks contribuídas via
   TaskProvider (tipo `alloy`) em vez de gravar tasks.json; launch.json e
   settings.json gerados UMA vez no scaffold, com comando explícito de
   "Regenerate". Linhas de comando cmake/ninja sempre visíveis no
   terminal (nada de orquestração opaca à la SCons).
5. **Zero telemetria. Zero webview no v1.** QuickPick + notificações +
   statusbar bastam.
6. **Honestidade por família**: nada de fingir debug onde não há.

## Decisões (pesquisa 22/jul/2026: auditoria CLI + survey PIO/ESP-IDF/Cortex-Debug/probe-rs)

- **Instalação do CLI**: `uv tool install alloy-embedded`. (pipx = 2 pré-requisitos;
  penv próprio = o maior fardo do PlatformIO; PyInstaller = matriz de
  assinatura/notarização em 5 alvos. uv é 1 binário estático.)
- **Empacotamento (P0)**: o wheel `alloy` EMBUTE o payload do framework
  (src/ C++, boards/) — o wheel É a versão do framework — e depende de
  `alloy-devices==X.Y.Z` (chips/registers/schema como package data via
  importlib.resources; hoje `SCHEMA_DIR = parents[2]` quebra em wheel).
- **IntelliSense**: clangd consumindo o compile_commands.json por board
  que o build já emite. NÃO gerar c_cpp_properties.json (segunda fonte
  de verdade que deriva).
- **Debug v1 = ARM via Cortex-Debug** (extensionDependency), launch
  gerado de um novo `alloy debug-info --json` (os mapas openocd saem do
  flash.py para um módulo compartilhado). RP2040: openocd ≥0.12 ou
  probe-rs-debug opt-in. **ESP32 v1 = build+flash+monitor com pânicos
  falantes decodificados (addr2line)** — Cortex-Debug não dirige Xtensa;
  debug interativo ESP32 é fase própria (openocd-esp32).
- **UX**: statusbar estilo PlatformIO (board + build/flash/monitor, um
  clique) — a parte mais amada do PIO; sem o peso do bootstrap opaco.
- **Board escolhido** fica no alloy.toml (o CLI é dono; verbo
  `alloy set-board`), espelhado na statusbar.

## Roadmap

- **P0 — lacunas do CLI** (bloqueia tudo):
  wheels (alloy embutindo framework + alloy-devices via
  importlib.resources; project.py resolve raízes dos pacotes instalados);
  `alloy boards --json`; `alloy setup [--family ...] [--check]
  [--json-progress]` + toolchains.json (sha256, por os-arch);
  `alloy clean`; `alloy set-board`; `alloy debug-info --json`;
  passe cross-platform (monitor→pyserial, portas via
  serial.tools.list_ports, sumir com globs /dev/cu.* e /Volumes/RPI-RP2
  hardcoded → board data + detecção por OS); erros sem traceback
  (envelope JSON de erro + exit codes estáveis); runner respeitar
  probe.runner do board.json.
- **P1 — esqueleto da extensão**: TypeScript strict + esbuild;
  src/{extension,cli,bootstrap,wizard,tasks,monitor}.ts; comandos Setup /
  New Project / Pick Board / Build / Flash / Run / Monitor / Clean;
  testes @vscode/test-electron com `alloy` stub.
- **P2 — debug ARM** (Cortex-Debug + debug-info; validar em silício nas
  placas que temos).
- **P3 — polish + marketplace** (vsce + ovsx, walkthrough de onboarding,
  problem matcher refinado, Windows GA após o passe P0 provar no CI).
- **P4 — ESP32 debug interativo** (openocd-esp32 + gdb xtensa) e extras
  (SVD/peripheral viewer, RTT, plotter) — só com demanda real.

## Fora do v1 (corte explícito)

DAP próprio; webviews; telemetria; gerenciamento de Python/venv na
extensão; c_cpp_properties.json; debug ESP32; SVD viewer; multi-root;
gerenciador de bibliotecas; edição GUI do alloy.toml; localização.
