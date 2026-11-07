/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Platform API base URL, for example https://api.3-36-23-54.sslip.io. Unset means same origin. */
  readonly VITE_PLATFORM_URL?: string;
  /** HyperDX base URL for the "open in HyperDX" link, for example https://hyperdx.hopcharlie.dev. Unset means no link. */
  readonly VITE_HYPERDX_URL?: string;
}
