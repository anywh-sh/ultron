export interface Profile {
  id: string;
  label: string;
  url: string;
}

// Milestone 2 (seletor de perfil): endereços fixos, via Tailscale.
// Cada perfil roda numa instância própria (ttyd+tmux+systemd) na Debian —
// ver infra/systemd/ e docs/08-prototipo-servidor.md.
export const PROFILES: Profile[] = [
  { id: "pessoal", label: "Pessoal", url: "http://100.64.0.1:7681" },
  { id: "trabalho", label: "Trabalho", url: "http://100.64.0.1:7682" },
];
