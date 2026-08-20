# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

MVP funcional completo e validado (chat, dois perfis, multi-sessão, voz, imagem). Cliente migrado de TS vanilla pra **React + TypeScript + Tailwind CSS + shadcn/ui** sobre Tauri 2.0 — migração completa em 8 fases, todas validadas no Windows real. Relay ganhou persistência de sessão em disco (sobrevive a restart). Barra de título customizada implementada e validada no Windows ([`docs/21`](./docs/21-titlebar-customizada-plano.md)): chrome nativo removido, botões próprios, Back/Forward, busca de sessão (Ctrl/Cmd+K), toggle de sidebar unificado.

**Próxima sessão: veja [`docs/20-backlog.md`](./docs/20-backlog.md)** pra escolher o próximo item de prioridade alta (instalador de um clique, waveform de voz com áudio real, ou destacar aba em janela própria — nenhum tem plano de implementação aprovado ainda, ao contrário do que a titlebar tinha). Não precisa reler `docs/00` a `docs/21` pra começar.

Toda a documentação (histórico de decisão completo) vive em [`/docs`](./docs), em ordem numérica, começando por [`docs/00-premissa.md`](./docs/00-premissa.md).
