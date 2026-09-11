# anywh

Wrapper multiplataforma para o Claude Code CLI. O `claude` continua rodando numa máquina que você controla (tipicamente uma Debian headless); o app é só uma forma melhor de falar com ele de qualquer device.

## Arquitetura

- **`relay/`** — servidor Node/TypeScript. Dá spawn em `claude -p ...` por turno, faz streaming dos eventos JSON de volta por WebSocket, e persiste estado de sessão/aba em disco. `ANTHROPIC_API_KEY` é removido do ambiente do filho de propósito, nos quatro pontos de spawn, pra que o uso sempre caia na assinatura e nunca em billing por token.
- **`client/`** — React + TypeScript + Tailwind + shadcn/ui, empacotado com Tauri 2.0 pra desktop e iOS a partir de uma codebase só.
- **`infra/systemd/`** — unit template pra rodar o relay como serviço. Opcional; o caminho normal é `npm start`.

## Estado atual

MVP funcional e usado diariamente: chat, voz, upload de imagem, multi-sessão, multi-perfil, barra de título customizada, painel de terminal e navegador de arquivos do diretório da sessão (listar/ler/baixar, renomear/excluir via menu de contexto desde 2026-09-09, e desde 2026-09-09 também "abrir no editor" — Zed/VS Code/Cursor/Windsurf, local ou via SSH remoto, com locality declarada por env no relay em vez de inferida, já que os arquivos vivem na máquina do relay, não na do client — ver journal/60). Validado em Windows, macOS e iOS.

O port iOS está completo menos a distribuição — TestFlight/App Store dependem de conta Apple Developer paga. Sem ela, o app é totalmente iterável no Simulator e instalável em device físico via Xcode local.

## Armadilhas conhecidas

Achados que custaram caro pra descobrir e não são óbvios lendo o código:

- **Os serviços systemd rodam `dist/server.js` compilado, não `src/`.** Reiniciar o serviço sozinho não pega mudança de código — precisa `npm run build` no `relay/` antes. Não há watch/hot-reload em produção.
- **`window.confirm`/`alert`/`prompt` não são confiáveis** entre as webviews do Tauri. O `DropdownMenu` do Radix em modo modal quebra o focus-trap no WKWebView (macOS/iOS) — usar `modal={false}`.
- **Watch de arquivo roda só na forma não-recursiva** (um watcher por diretório/arquivo visível). Watch recursivo não escala em repo com `node_modules`.
- **`codesign` de iOS não funciona via SSH** — falha com `errSecInternalComponent` por não ter contexto de sessão gráfica. Build pra device físico só roda no Terminal.app local do Mac; nem `security set-key-partition-list` nem `unlock-keychain` contornam.
- **Notificação no macOS não funciona via `npm run tauri dev`.** `tauri-plugin-notification`/`notify-rust` usam a API legada `NSUserNotificationCenter`, que só consegue mostrar notificação "emprestando" a identidade de um bundle registrado (o processo de dev não é um `.app` de verdade) — o próprio plugin já faz isso de propósito, usando `com.apple.Terminal` como identidade em dev. No macOS 26 (Tahoe) o daemon `usernoted` passou a negar essa conexão pra qualquer identidade que não bata com a assinatura de código real do processo (`log stream --predicate 'process == "usernoted"'` mostra `Denying message ... LegacyConnection` no momento do disparo) — testado trocar a identidade emprestada pelo identifier real do app instalado (`sh.anywh.client`, via `mdfind`) e a negação persiste, então não é um problema de "qual identidade escolher". Só funciona em build assinado de verdade (`npm run tauri build` → `.app` instalado).
- **Foco de janela no iOS**: usar `document.visibilityState`, não a API de foco do Tauri — a segunda dispara falso positivo em qualquer interrupção momentânea (Control Center, alerta do sistema), não só background real.
- **Qualquer boot avulso do relay (`npm run dev`/`npm start` fora do `add-profile.sh`) se auto-registra como perfil `"default"`** (`ensureSelfRegistered`, `relay/src/profileRegistry.ts`) sempre que a porta do processo não bate com nenhum `.env` já existente — mesmo numa máquina que já tem perfis reais (`pessoal`/`trabalho`). Esse `default.env` fica órfão (fora do `profiles.json`, sem serviço systemd) e normalmente reporta `RELAY_HOST=127.0.0.1`, diferente do IP Tailscale dos perfis de verdade. O client deduplicava por `host` em vez de `id` (`syncProfilesForHost`, `client/src/lib/profiles.ts`), então esse "default" fantasma nunca era limpo entre syncs e cada porta nova empilhava mais uma cópia — apareciam vários "Default" no seletor a cada troca de perfil (corrigido 2026-09-07, commit `2eff9a7`). Se reaparecer um `default.env` órfão em `~/.config/anywh/env/`, é sinal de um teste avulso do relay rodando sem passar pelo `add-profile.sh` — é seguro apagar o arquivo se não houver `anywh-relay@default` habilitado.
- **O binário Go do `tailnet-sidecar` não é reconstruído por `npm run tauri
  dev`** e `src-tauri/binaries/` é gitignored, então cada máquina constrói o
  seu. Como o Tauri empacota silenciosamente o binário que já estiver lá, uma
  mudança no Go parece simplesmente não ter efeito, e uma mudança no Rust que
  passe uma flag nova faz o binário velho sair com código 2 — o que chega na
  UI como `tailnet-sidecar exited before printing LISTENING` e se parece com
  falha de tailnet sem ser. Rodar `npm run build:sidecar` (client) depois de
  qualquer mudança em `tailnet-sidecar/` ou nas flags que `tailnet_sidecar.rs`
  monta.
- **`infra/systemd/restart-profiles.sh` reinicia todos os perfis anywh-relay habilitados de uma vez**, e a sessão do Claude Code que está lendo este arquivo provavelmente está rodando como processo filho de um desses serviços agora mesmo. Rodar esse script (ou qualquer `systemctl --user restart/stop anywh-relay@*`) sem avisar antes derruba essa sessão no meio do turno — confirmado ao vivo mais de uma vez, inclusive rodando o próprio script "só pra testar". **Nunca rodar sem confirmação explícita do usuário na conversa atual**, mesmo em contexto de teste/dev — perguntar antes, não só avisar depois.
- **Qualquer elemento `position: fixed` renderizado dentro do conteúdo de uma aba de sessão (chat, terminal, painel de arquivos) acaba ancorado no *wrapper* da aba, não no viewport real.** `TabGroupLayout` envolve cada painel de aba num `div` com `contain: layout paint` — decisão deliberada pra escopar o re-layout de um resize de grupo só àquele painel — mas containment CSS também torna esse `div` o *containing block* de qualquer descendente `fixed`, do mesmo jeito que um `transform` faria. Descoberto porque os menus de contexto do painel de arquivos (`FileTree.tsx`) passaram a abrir longe do clique com um gap grande e direcional depois que esse `contain` foi introduzido (`92d3554`, tab splitting) — o span invisível usado como âncora do `DropdownMenu` (`left`/`top` = `event.clientX`/`clientY`, coordenadas de viewport) parou de resolver contra o viewport e passou a resolver contra o wrapper. Corrigido portando o próprio trigger pra `document.body` (`ContextMenuAnchor`, `client/src/hooks/useContextMenu.tsx`) em vez de só o `DropdownMenuContent` (que o Radix já porta por padrão) — `DownloadToasts.tsx` segue o mesmo padrão pro stack de toasts no canto da tela. Qualquer UI nova com posicionamento `fixed` (tooltip customizado, menu, toast) que precise viver dentro do conteúdo de uma aba tem que passar por um portal pra `document.body`, não confiar em `position: fixed` inline.



## Idioma

Tudo que não for texto de UI precisa estar em inglês, mesmo quando a conversa com o agente for em português:

- **Sempre em inglês**: comentário de código (`//`, `/* */`, doc comments), mensagem de commit (título + corpo), `console.log`/`console.error`/logs de servidor, e qualquer string que exista só pro desenvolvedor (nunca chega a ser renderizada pro usuário final).
- **Continua em português por enquanto**: qualquer string que é de fato mostrada na UI (texto JSX, `placeholder`/`title`/`aria-label`, `window.alert`/`window.confirm`, toast, mensagem de erro que chega até o usuário). Isso é intencional — o projeto não tem sistema de i18n ainda, então traduzir texto de UI hoje só criaria uma mistura pior. Antes de decidir se uma string é "UI" ou "não-UI", rastreia onde ela é consumida (ex.: um erro que sobe até um `alert`/toast é UI; um `console.error` não é) — não decide só por "parece uma frase".
- Este `AGENTS.md` continua em português por ora.
- Contexto: o projeto foi construído em conversas em português sem essa diretriz explícita, e acumulou texto em PT em código e commits. Corrigido retroativamente em 2026-09 (histórico de commit reescrito via `git filter-repo`, comentários/logs traduzidos) — esta seção existe pra isso não voltar a acontecer.

## Workflow de contribuição

- Commits separados por responsabilidade (atômicos) — nunca misturar mudanças de propósitos diferentes num único commit, mesmo que tenham sido feitas na mesma sessão. Se o working tree acumulou mais de uma feature/fix, separa em commits distintos (stage seletivo por arquivo/hunk) em vez de um commit único.
- Sempre seguir [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `style:`, `docs:` etc., com escopo quando fizer sentido, ex. `feat(client): ...`).
- **Texto do commit (título + corpo) sempre em inglês**, mesmo com o resto da conversa em português — ver seção "Idioma" acima.
- Ao terminar um trabalho (bug corrigido, feature implementada, o que foi pedido na sessão), o passo de conclusão inclui commitar (nos moldes acima) e dar `git push` pro repo remoto — isso faz parte de "terminar a tarefa", não é uma ação extra que precisa ser pedida à parte toda vez.

## Testes

Doutrina completa (o quê testar, onde cada tipo de teste mora, a única exceção sancionada a "sem mock" — o processo `claude`) está em `.anywh/skills/tests/SKILL.md`, symlinkado em `.claude/skills/tests` pra ficar auto-descoberto pelo Claude Code. Canônico fica em `.anywh/` de propósito (não `.claude/`) porque o roadmap já prevê suporte a múltiplos coding agents além do Claude Code — mesmo raciocínio por trás deste arquivo: `AGENTS.md` é o canônico, `CLAUDE.md` é symlink pra ele (não duplicar conteúdo entre convenções de nome de cada provider).

## Documentação

O `README.md` da raiz cobre o que é preciso pra rodar e contribuir. O histórico de decisão detalhado do projeto (o porquê de cada escolha de arquitetura) mora em `~/anywh/journal/` — um nível acima deste repo, fora dele (movido de `journal/` pra cá em 2026-09-08 quando o workspace virou `~/anywh/` com múltiplos repos irmãos; ver `~/anywh/AGENTS.md`). Nunca vai pro remote de nenhum dos quatro repos — é local à máquina do autor e compartilhado entre eles.

Comentários no código citam esse histórico por número — `docs/08`, `docs/23` e assim por diante — convenção antiga de quando a pasta ainda se chamava `docs/` (renomeada pra `journal/` em 2026-09-07 pra liberar `/docs` como espaço reservado a documentação futura de verdade, ex. um guia de instalação). Os marcadores continuam como estavam: apontam pra fora do repo, o comentário em volta deles carrega o achado em si, a referência é só a procedência — não vale a pena reescrever as centenas de citações existentes só pra bater com o nome novo da pasta nem com a mudança de nível. Ao escrever comentário novo que cite esse histórico, usa `journal/NN`.
