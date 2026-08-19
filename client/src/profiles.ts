export interface Profile {
  id: string;
  label: string;
  host: string;
  port: number;
}

// Milestone 3 (cliente xterm.js próprio): endereços fixos, via Tailscale.
// Cada perfil roda numa instância própria (ttyd+tmux+systemd) na Debian —
// ver infra/systemd/ e docs/08-prototipo-servidor.md.
export const PROFILES: Profile[] = [
  { id: "pessoal", label: "Pessoal", host: "100.64.0.1", port: 7681 },
  { id: "trabalho", label: "Trabalho", host: "100.64.0.1", port: 7682 },
];

export function findProfile(id: string): Profile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}
