import { defineConfig } from "@playwright/test";

const remoteBaseURL = process.env.POLYTOUR_BASE_URL?.trim() || undefined;
const isCI = Boolean(process.env.CI);
const devPort = process.env.POLYTOUR_DEV_PORT ?? "5173";
const previewPort = process.env.POLYTOUR_PREVIEW_PORT ?? "4173";
const devURL = `http://127.0.0.1:${devPort}`;
const productionURL = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    locale: "fr-CH",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  projects: [
    {
      name: "desktop-ui",
      testMatch: [
        "client-flow.spec.ts",
        "ui-clarity.spec.ts",
        "settings-help.spec.ts",
        "network-flow.spec.ts",
        "language-flow.spec.ts",
        "pause-menu.spec.ts",
        "invitation-flow.spec.ts",
        "sale-flow.spec.ts",
        "privacy-flow.spec.ts",
      ],
      use: { baseURL: remoteBaseURL ?? devURL },
    },
    {
      name: "production",
      testMatch: [
        "room-flow.spec.ts",
        "bot-difficulty.spec.ts",
        "pause-game.spec.ts",
        "smoke.spec.ts",
        "seo.spec.ts",
        "not-found.spec.ts",
      ],
      use: { baseURL: remoteBaseURL ?? productionURL },
    },
  ],
  webServer: remoteBaseURL
    ? undefined
    : [
        {
          command: `pnpm dev --host 127.0.0.1 --port ${devPort} --strictPort`,
          url: `${devURL}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
        {
          command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
          url: `${productionURL}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      ],
});
