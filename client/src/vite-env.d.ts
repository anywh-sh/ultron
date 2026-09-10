/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANYWH_HOST?: string;
  readonly VITE_ANYWH_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
