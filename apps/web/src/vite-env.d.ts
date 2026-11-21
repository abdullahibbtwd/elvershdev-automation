/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** When "true", Series episode page defaults Use mock AI on (still overridable in UI). */
  readonly VITE_SERIES_USE_MOCK_AI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
