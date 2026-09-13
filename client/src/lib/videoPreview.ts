// Generates the video attachment chip's thumbnail (composer + sent bubble)
// right away, on the client, without waiting for the relay's upload/frame
// extraction round trip — same idea as the `URL.createObjectURL(file)` that
// already existed for images, just needs to decode the video first to grab
// a frame.
//
// The `<video>` element needs to genuinely be in the DOM (not just created
// in memory) for `loadeddata`/`seeked` to fire reliably on WKWebView (Safari
// has this requirement, unlike Chromium) — that's why it sits off-screen
// instead of never being attached.
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
      reject(new Error("timed out generating the video preview"));
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
        reject(new Error("no 2d canvas context available"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          if (!blob) {
            reject(new Error("failed to encode the video preview"));
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
      reject(new Error("failed to load the video for a preview"));
    };
  });
}
