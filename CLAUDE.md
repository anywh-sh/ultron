# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

MVP funcional completo e validado (chat, dois perfis, multi-sessão, voz, imagem). Cliente migrado de TS vanilla pra **React + TypeScript + Tailwind CSS + shadcn/ui** sobre Tauri 2.0 — migração completa em 8 fases, todas validadas no Windows real. Relay ganhou persistência de sessão em disco (sobrevive a restart). Projeto está numa pausa natural: sem próxima fase já definida, só itens deferidos que podem virar prioridade quando fizer sentido.

**Próxima sessão: comece por [`docs/20-backlog.md`](./docs/20-backlog.md).** Lista os itens deferidos de propósito (com o porquê de cada um), sem ordem fixa — o usuário escolhe o que puxar. [`docs/19-migracao-react-completa.md`](./docs/19-migracao-react-completa.md) tem o resumo de tudo que foi implementado na migração, se precisar de mais contexto. Não precisa reler `docs/00` a `docs/18` pra começar.

Toda a documentação (histórico de decisão completo) vive em [`/docs`](./docs), em ordem numérica, começando por [`docs/00-premissa.md`](./docs/00-premissa.md).
