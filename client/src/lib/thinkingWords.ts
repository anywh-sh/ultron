/** Verbos aleatórios pro indicador de turno em andamento (TurnIndicator) —
 * mesma ideia do spinner do Claude Code CLI, que troca "Thinking…" por um
 * verbo aleatório (~200 opções, entre técnico/pseudo-sério e brincalhão) a
 * cada operação. Um só é sorteado por turno (não fica trocando a cada
 * segundo) — replica o comportamento real da CLI, não uma cyclagem nossa. */
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
