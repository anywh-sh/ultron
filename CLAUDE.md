# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

MVP funcional completo e validado (chat, dois perfis, multi-sessão, voz, imagem). Cliente migrado de TS vanilla pra **React + TypeScript + Tailwind CSS + shadcn/ui** sobre Tauri 2.0 — migração completa em 8 fases, todas validadas no Windows real. Relay ganhou persistência de sessão em disco (sobrevive a restart). Projeto está numa pausa natural: sem próxima fase já definida, só itens deferidos que podem virar prioridade quando fizer sentido.

**Próxima sessão: comece por [`docs/19-migracao-react-completa.md`](./docs/19-migracao-react-completa.md).** Resume o que foi implementado, onde as decisões de `docs/17`/`docs/18` mudaram na prática durante a implementação, e a lista do que ficou deferido de propósito — não precisa reler `docs/00` a `docs/18` pra começar.

Toda a documentação (histórico de decisão completo) vive em [`/docs`](./docs), em ordem numérica, começando por [`docs/00-premissa.md`](./docs/00-premissa.md).
