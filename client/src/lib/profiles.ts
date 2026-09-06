export interface Profile {
  id: string;
  label: string;
  host: string;
  relayPort: number;
}

// Fixed addresses, via Tailscale. Each profile runs its own relay
// (systemd) — see infra/systemd/ and docs/12-prototipo-relay.md.
export const PROFILES: Profile[] = [
  { id: "pessoal", label: "Pessoal", host: "100.64.0.1", relayPort: 8765 },
  { id: "trabalho", label: "Trabalho", host: "100.64.0.1", relayPort: 8766 },
];

export function findProfile(id: string): Profile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}
