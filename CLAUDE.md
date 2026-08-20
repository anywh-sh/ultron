# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

MVP funcional completo e validado (chat, dois perfis, multi-sessão, voz, imagem). Cliente migrado de TS vanilla pra **React + TypeScript + Tailwind CSS + shadcn/ui** sobre Tauri 2.0 — migração completa em 8 fases, todas validadas no Windows real. Relay ganhou persistência de sessão em disco (sobrevive a restart). Barra de título customizada implementada e validada no Windows ([`docs/21`](./docs/21-titlebar-customizada-plano.md)): chrome nativo removido, botões próprios, Back/Forward, busca de sessão (Ctrl/Cmd+K), toggle de sidebar unificado.

**Próxima sessão: veja [`docs/20-backlog.md`](./docs/20-backlog.md)** pra escolher o próximo item de prioridade alta (instalador de um clique, waveform de voz com áudio real, ou destacar aba em janela própria — nenhum tem plano de implementação aprovado ainda, ao contrário do que a titlebar tinha). Não precisa reler `docs/00` a `docs/21` pra começar.

Toda a documentação (histórico de decisão completo) vive em [`/docs`](./docs), em ordem numérica, começando por [`docs/00-premissa.md`](./docs/00-premissa.md).

## Workflow de contribuição

- Commits separados por responsabilidade (atômicos) — nunca misturar mudanças de propósitos diferentes num único commit, mesmo que tenham sido feitas na mesma sessão. Se o working tree acumulou mais de uma feature/fix, separa em commits distintos (stage seletivo por arquivo/hunk) em vez de um commit único.
- Sempre seguir [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `style:`, `docs:` etc., com escopo quando fizer sentido, ex. `feat(client): ...`).
- Ao terminar um trabalho (bug corrigido, feature implementada, o que foi pedido na sessão), o passo de conclusão inclui commitar (nos moldes acima) e dar `git push` pro repo remoto — isso faz parte de "terminar a tarefa", não é uma ação extra que precisa ser pedida à parte toda vez.
