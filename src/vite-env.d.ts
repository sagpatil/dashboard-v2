/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Origin of the API server when it is not the same as the app's
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
