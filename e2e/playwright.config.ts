import { defineConfig, devices } from "@playwright/test";

// WhatsApp opens links in its own browser: on iPhone a WebView with its own user agent.
const WHATSAPP_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/2.25.20";

/**
 * End-to-end checks of the agency funnel. BASE_URL picks the deployment
 * (a local `next start` by default); DEMO_TOKEN and DEMO_CODE a demo and its
 * invitation for the funnel tests, which only read: no form is sent and
 * analytics, ads and the team's demo activity are blocked.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone-safari", use: { ...devices["iPhone 14"] } },
    { name: "whatsapp-iphone", use: { ...devices["iPhone 14"], userAgent: WHATSAPP_IOS } },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
