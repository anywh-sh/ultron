export interface Profile {
  id: string;
  label: string;
  host: string;
  relayPort: number;
}

// Endereços fixos, via Tailscale. Cada perfil roda seu próprio relay
// (systemd) — ver infra/systemd/ e docs/12-prototipo-relay.md.
export const PROFILES: Profile[] = [
  { id: "pessoal", label: "Pessoal", host: "100.64.0.1", relayPort: 8765 },
  { id: "trabalho", label: "Trabalho", host: "100.64.0.1", relayPort: 8766 },
];

export function findProfile(id: string): Profile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}
