/** Random verbs for the turn-in-progress indicator (TurnIndicator) — same
 * idea as the Claude Code CLI's spinner, which swaps "Thinking…" for a
 * random verb (~200 options, ranging from technical/mock-serious to playful)
 * on every operation. Only one is picked per turn (doesn't keep changing
 * every second) — replicates the CLI's real behavior, not a cycling scheme
 * of our own. */
const THINKING_WORDS = [
  "Pensando",
  "Cogitando",
  "Ponderando",
  "Processando",
  "Computando",
  "Deliberando",
  "Refletindo",
  "Analisando",
  "Sintetizando",
  "Decifrando",
  "Deduzindo",
  "Formulando",
  "Arquitetando",
  "Investigando",
  "Ruminando",
  "Filosofando",
  "Especulando",
  "Matutando",
  "Remoendo",
  "Fuçando",
  "Xeretando",
  "Vasculhando",
  "Garimpando",
  "Farejando pistas",
  "Espremendo os miolos",
  "Destrinchando o problema",
  "Bolando um plano",
  "Catando ideias",
  "Rabiscando possibilidades",
  "Juntando as peças",
  "Conectando os pontos",
  "Consultando os neurônios",
  "Compilando ideias",
  "Depurando os pensamentos",
  "Buscando na memória",
  "Coçando a cabeça",
];

export function pickThinkingWord(): string {
  return THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)];
}
