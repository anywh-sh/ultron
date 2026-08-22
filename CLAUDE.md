# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

MVP funcional completo e validado (chat, dois perfis, multi-sessão, voz, imagem). Cliente migrado de TS vanilla pra **React + TypeScript + Tailwind CSS + shadcn/ui** sobre Tauri 2.0 — migração completa em 8 fases, todas validadas no Windows real. Relay ganhou persistência de sessão em disco (sobrevive a restart). Barra de título customizada implementada e validada no Windows ([`docs/21`](./docs/21-titlebar-customizada-plano.md)): chrome nativo removido, botões próprios, Back/Forward, busca de sessão (Ctrl/Cmd+K), toggle de sidebar unificado. Ícone final do app (`>` + cursor) exportado e aplicado pros dois SOs. Primeiro teste real no macOS feito (2026-08-21): app rodando, `.dmg` de instalação (arrastar-pra-Applications) validado com assinatura ad-hoc — ver `docs/20-backlog.md` pros detalhes e pro que ainda falta lá (download automático do modelo Whisper) e no instalador do Windows (não iniciado).

**Frente ativa: port iOS.** Phase 0 de investigação concluída ([`docs/22`](./docs/22-mobile-ios-investigacao.md), 3 spikes validados: toolchain, UI nativa Liquid Glass via plugin Swift, reconexão em background). Plano de implementação ([`docs/23`](./docs/23-mobile-ios-plano-implementacao.md)) com as Fases A-E **todas concluídas**: fundação do projeto iOS, gating de voz/titlebar/tabs, Photo Picker nativo validado, reconexão com backoff (`RelayClient`), e o plugin `tauri-plugin-native-chrome` promovido com um comando real de indicador de conexão. **Só falta a Fase F (distribuição)** — depende de uma decisão do usuário (conta Apple Developer paga, $99/ano) antes de configurar signing/TestFlight; sem essa conta, o app já é totalmente iterável no Simulator. Não precisa reler `docs/00` a `docs/22` pra continuar — `docs/23` tem tudo.

O backlog do desktop ([`docs/20-backlog.md`](./docs/20-backlog.md) — instalador de um clique, waveform de voz, destacar aba em janela própria) continua válido mas não é a prioridade da sessão atual.

Toda a documentação (histórico de decisão completo) vive em [`/docs`](./docs), em ordem numérica, começando por [`docs/00-premissa.md`](./docs/00-premissa.md).

## Workflow de contribuição

- Commits separados por responsabilidade (atômicos) — nunca misturar mudanças de propósitos diferentes num único commit, mesmo que tenham sido feitas na mesma sessão. Se o working tree acumulou mais de uma feature/fix, separa em commits distintos (stage seletivo por arquivo/hunk) em vez de um commit único.
- Sempre seguir [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `style:`, `docs:` etc., com escopo quando fizer sentido, ex. `feat(client): ...`).
- Ao terminar um trabalho (bug corrigido, feature implementada, o que foi pedido na sessão), o passo de conclusão inclui commitar (nos moldes acima) e dar `git push` pro repo remoto — isso faz parte de "terminar a tarefa", não é uma ação extra que precisa ser pedida à parte toda vez.
