// Gera a miniatura do chip de anexo de vídeo (composer + bolha enviada) na
// hora, no cliente, sem esperar o round-trip do upload/extração de frames no
// relay — igual ao `URL.createObjectURL(file)` que já existia pra imagem,
// só que precisa decodificar o vídeo primeiro pra tirar um frame.
//
// O elemento `<video>` precisa estar de verdade no DOM (não só criado em
// memória) pra `loadeddata`/`seeked` dispararem de forma confiável no
// WKWebView (Safari tem esse requisito, diferente do Chromium) — por isso
// fica fora da tela em vez de nunca ser anexado.
export function captureVideoFrame(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    document.body.appendChild(video);

    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.remove();
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout gerando prévia do vídeo"));
    }, 5000);

    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };

    video.onseeked = () => {
      window.clearTimeout(timeout);
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        reject(new Error("canvas 2d indisponível"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) {
            reject(new Error("falha ao gerar prévia do vídeo"));
            return;
          }
          resolve(URL.createObjectURL(blob));
        },
        "image/jpeg",
        0.8,
      );
    };

    video.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error("falha ao carregar vídeo pra prévia"));
    };
  });
}
