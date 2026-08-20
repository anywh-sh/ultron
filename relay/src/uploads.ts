import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

// Onde as imagens anexadas pelo cliente ficam salvas — precisa ser um
// caminho que o processo `claude -p` do relay consiga ler (mesma máquina),
// pra ele usar a ferramenta Read e "ver" a imagem de verdade (ver docs/15).
const UPLOAD_DIR = process.env.RELAY_UPLOAD_DIR ?? "/tmp/ultron-uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

export function saveUpload(req: IncomingMessage, ext: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_UPLOAD_BYTES) {
        req.destroy();
        reject(new Error("upload maior que o limite de 25MB"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "") || "bin";
      const filePath = join(UPLOAD_DIR, `${randomUUID()}.${safeExt}`);
      writeFileSync(filePath, Buffer.concat(chunks));
      resolve(filePath);
    });

    req.on("error", (err) => reject(err));
  });
}
