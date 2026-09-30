import { defineConfig } from "@playwright/test";

const remoteBaseURL = process.env.POLYTOUR_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: remoteBaseURL ?? "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  webServer: remoteBaseURL
    ? undefined
    : {
        command: "pnpm dev --host 127.0.0.1",
        url: "http://127.0.0.1:5173/api/health",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
