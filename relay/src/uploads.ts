import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { IncomingMessage } from "node:http";

// Onde as imagens/vídeos anexados pelo cliente ficam salvos — precisa ser um
// caminho que o processo `claude -p` do relay consiga ler (mesma máquina),
// pra ele usar a ferramenta Read e "ver" a imagem de verdade (ver docs/15).
const UPLOAD_DIR = process.env.RELAY_UPLOAD_DIR ?? "/tmp/ultron-uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB — vídeo curto de flow/animação passa fácil dos 25MB de imagem.

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "avi", "mkv"]);
const VIDEO_FRAME_COUNT = 6;

export interface UploadResult {
  path: string;
  /** Só presente pra vídeo — paths dos frames extraídos via ffmpeg, em
   * ordem cronológica (docs/15: o Claude só "vê" imagem via `Read`, não
   * vídeo, então isso é o que efetivamente vira contexto visual). */
  frames?: string[];
}

export function saveUpload(req: IncomingMessage, ext: string): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        req.destroy();
        reject(new Error("upload maior que o limite de 100MB"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      void handleUploadComplete(chunks, ext).then(resolve, reject);
    });

    req.on("error", (err) => reject(err));
  });
}

async function handleUploadComplete(chunks: Buffer[], ext: string): Promise<UploadResult> {
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const id = randomUUID();
  const filePath = join(UPLOAD_DIR, `${id}.${safeExt}`);
  writeFileSync(filePath, Buffer.concat(chunks));

  if (!VIDEO_EXTENSIONS.has(safeExt.toLowerCase())) {
    return { path: filePath };
  }

  try {
    const frames = await extractVideoFrames(filePath, id);
    return { path: filePath, frames };
  } catch (error) {
    // Não derruba o upload por causa disso — o vídeo original já está salvo
    // e ainda pode ser referenciado (o Claude consegue rodar ffmpeg nele
    // via Bash), só não ganha os frames como imagem de contexto direto.
    console.error("[relay] falha ao extrair frames do vídeo:", error);
    return { path: filePath };
  }
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} saiu com código ${String(code)}: ${stderr.trim()}`));
    });
  });
}

async function getVideoDuration(videoPath: string): Promise<number> {
  const out = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = parseFloat(out.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 1;
}

// Frames tirados no ponto médio de N fatias iguais da duração (não em
// t=0/t=fim) — evita cair em fade-in/fade-out preto nas pontas, comum em
// gravação de tela.
async function extractVideoFrames(videoPath: string, baseId: string): Promise<string[]> {
  const duration = await getVideoDuration(videoPath);
  const frames: string[] = [];
  for (let i = 0; i < VIDEO_FRAME_COUNT; i++) {
    const timestamp = (duration * (i + 0.5)) / VIDEO_FRAME_COUNT;
    const framePath = join(UPLOAD_DIR, `${baseId}-frame${String(i + 1)}.jpg`);
    await runCommand("ffmpeg", ["-y", "-ss", timestamp.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "3", framePath]);
    frames.push(framePath);
  }
  return frames;
}
