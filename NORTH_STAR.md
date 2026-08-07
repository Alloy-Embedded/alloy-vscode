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
- **P3 — polish + marketplace** — publicação automatizada FEITA
  (`.github/workflows/release.yml`: tag `v*` → vsce + ovsx, com dois portões:
  versão do `package.json` igual à tag, e a versão de CLI que o
  `MIN_CLI_VERSION` exige tem de estar no PyPI — foi esse o erro real, uma
  extensão pedindo uma CLI que só existia num checkout). Falta: walkthrough de
  onboarding. Windows entrou no CI (job `portable`); GA continua dependendo de
  alguém rodar o fluxo completo numa máquina Windows de verdade.
- **P4 — ESP32 debug interativo** (openocd-esp32 + gdb xtensa) e extras
  (SVD/peripheral viewer, RTT, plotter) — só com demanda real.

## Fora do v1 (corte explícito)

DAP próprio; telemetria; gerenciamento de Python/venv na extensão;
c_cpp_properties.json (o `compile_commands.json` do build-tree já serve
clangd e IntelliSense); debug ESP32; multi-root; edição GUI do alloy.toml.

**Localização — cortada, e a decisão foi reconfirmada (07/ago/2026).** Não é
falta de tempo: quase tudo que o usuário lê na tela vem da CLI em inglês —
as mensagens de validação ("pb3 has no route to i2c1 scl"), as notas de
clock ("115200 baud → 115107, 0.08% error"), a razão de um role indisponível,
a tabela da matriz, a saída do monitor. Traduzir a moldura deixaria botões
em português cercados de conteúdo em inglês, o que é pior que inglês
consistente num projeto cujo NORTH_STAR, código, docs e CLI são em inglês.

Fazer direito exigiria a CLI devolver **códigos de mensagem + parâmetros** em
vez de frases prontas, e a extensão traduzir — mudança nos oito envelopes
JSON, não trabalho de tradução. Se algum dia isso for feito, é essa a forma;
não `vscode.l10n` em cima das strings de hoje.

### Cortes que foram revistos e construídos

Três itens saíram desta lista porque a necessidade apareceu e o custo caiu:

- **webviews** — o configurador de placa precisa de um mapa de pinos, uma
  árvore de clock e o desenho do encapsulamento; nada disso cabe em
  QuickPick. Painéis estáticos (memória, matriz) renderizam de funções puras,
  sem bundle.
- **SVD / peripheral viewer** — virou barato: `alloy svd` emite CMSIS-SVD dos
  mapas de registrador que o `alloy-devices` já cura, e o Cortex-Debug lê
  `svdFile` nativamente. Zero dado novo.
- **gerenciador de bibliotecas** — `alloy lib list/add` já existia na CLI; a
  view é uma lista sobre um envelope JSON.
