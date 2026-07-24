# Alloy Embedded — VS Code Extension

Do zero ao blink com um clique, em qualquer placa suportada pelo
[framework Alloy](https://github.com/Alloy-Embedded/alloy).

## O que faz

- **Alloy: New Project** — assistente em 3 passos: escolhe **fabricante → placa**
  (dados do `alloy boards --json`), nomeia e faz o scaffold. Sem editar config na mão.
- **Bibliotecas (drivers)** — navega o registro de drivers do ecossistema
  (sensores, displays, RTCs…) agrupado por categoria no painel lateral, e
  **adiciona** um com um clique (`alloy lib add`) — ele é vendorizado no projeto e
  entra no build automaticamente. `#include <sht31.hpp>` e pronto.
- **Alloy: Setup Environment** — verifica/instala toolchains via `alloy setup`
  (tudo visível no terminal; a extensão nunca baixa toolchain por conta própria)
- **Statusbar + painel** — placa atual + build / flash / run / monitor / debug em um clique
- **Tasks** tipo `alloy` (build/flash/run/monitor/clean/gen) com problem
  matcher GCC — erros de compilação caem no painel Problems
- **Alloy: Pick Board** — troca a placa do projeto (`alloy set-board`)

IntelliSense funciona de cara: `alloy build` emite `compile_commands.json`, então o
clangd pega todos os includes/defines sem configuração extra.

## Requisitos

O CLI `alloy` (>= 0.1.0). Em dev: `uv tool install alloy-embedded  # (ou --from <checkout>/alloy/tools/alloy em dev)`
ou aponte `alloy.cliPath` nas settings.

## Desenvolvimento

```
npm install
npm run build      # typecheck + bundle
# F5 no VS Code abre o Extension Development Host
npx vsce package --no-dependencies
```

Arquitetura e guardrails: [NORTH_STAR.md](NORTH_STAR.md).
