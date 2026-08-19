# ultron

Wrapper multiplataforma para o Claude Code CLI (máquina Debian headless central, acesso via SSH/Tailscale).

Fundação de arquitetura: relay próprio (Claude Code em modo `stream-json`) + Tauri client — ver [`docs/11-decisao-pivo-stream-json.md`](./docs/11-decisao-pivo-stream-json.md) pra decisão mais recente (substitui a fundação original de tmux+ttyd).

Toda a documentação vive em [`/docs`](./docs). Comece por [`docs/00-premissa.md`](./docs/00-premissa.md) e siga a ordem numérica.
