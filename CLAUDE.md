# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

MVP funcional completo e validado (chat, dois perfis, multi-sessão, voz, imagem). Cliente migrado de TS vanilla pra **React + TypeScript + Tailwind CSS + shadcn/ui** sobre Tauri 2.0 — migração completa em 8 fases, todas validadas no Windows real. Relay ganhou persistência de sessão em disco (sobrevive a restart). Backlog de prioridade alta definido (`docs/20`); a primeira dele já tem plano de implementação aprovado, pronto pra codar.

**Próxima sessão: comece por [`docs/21-titlebar-customizada-plano.md`](./docs/21-titlebar-customizada-plano.md).** Plano aprovado (Fase A → B → C → D, com checkpoint obrigatório no Windows ao fim da Fase A) pra remover a barra de título nativa do SO e construir uma própria (back/forward, busca de sessão, visual próprio). [`docs/20-backlog.md`](./docs/20-backlog.md) lista os demais itens deferidos, se este não for mais a prioridade quando você retomar. Não precisa reler `docs/00` a `docs/19` pra começar.

Toda a documentação (histórico de decisão completo) vive em [`/docs`](./docs), em ordem numérica, começando por [`docs/00-premissa.md`](./docs/00-premissa.md).
