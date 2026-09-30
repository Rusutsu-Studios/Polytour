import { defineConfig } from "@playwright/test";

const remoteBaseURL = process.env.POLYTOUR_BASE_URL;
const isCI = Boolean(process.env.CI);
const devURL = "http://127.0.0.1:5173";
const productionURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  projects: [
    {
      name: "desktop-ui",
      testMatch: "client-flow.spec.ts",
      use: { baseURL: remoteBaseURL ?? devURL },
    },
    {
      name: "production",
      testMatch: ["room-flow.spec.ts", "smoke.spec.ts"],
      use: { baseURL: remoteBaseURL ?? productionURL },
    },
  ],
  webServer: remoteBaseURL
    ? undefined
    : [
        {
          command: "pnpm dev --host 127.0.0.1 --port 5173 --strictPort",
          url: `${devURL}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
        {
          command:
            "pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
          url: `${productionURL}/api/health`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      ],
});
