import packageMetadata from "../../package.json" with { type: "json" };

// Application releases are independent of saved-state, rules and protocol versions.
// Vite bundles this value for both the browser and Worker without runtime I/O.
export const APP_VERSION = packageMetadata.version;
