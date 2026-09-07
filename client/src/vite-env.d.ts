/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ULTRON_HOST?: string;
  readonly VITE_ULTRON_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
