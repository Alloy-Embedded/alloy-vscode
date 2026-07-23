# Alloy Embedded — VS Code Extension

Do zero ao blink com um clique, em qualquer placa suportada pelo
[framework Alloy](https://github.com/Alloy-Embedded/alloy).

## O que faz (v0.1)

- **Alloy: Setup Environment** — verifica/instala toolchains via `alloy setup`
  (tudo visível no terminal; a extensão nunca baixa toolchain por conta própria)
- **Alloy: New Project** — board picker (dados do `alloy boards --json`) + scaffold
- **Statusbar** — placa atual + build / flash / run / monitor em um clique
- **Tasks** tipo `alloy` (build/flash/run/monitor/clean/gen) com problem
  matcher GCC — erros de compilação caem no painel Problems
- **Alloy: Pick Board** — troca a placa do projeto (`alloy set-board`)

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
