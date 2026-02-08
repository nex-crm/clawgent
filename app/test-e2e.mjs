import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3001";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("1. Loading landing page...");
  await page.goto(BASE);
  await page.waitForLoadState("networkidle");
  console.log(`   Title: ${await page.title()}`);

  const deployBtn = page.locator("button", { hasText: "Deploy New Instance" });
  await deployBtn.waitFor({ state: "visible" });
  console.log("   Deploy button visible.");

  console.log("\n2. Clicking Deploy...");
  await deployBtn.click();

  const deployingBtn = page.locator("button", { hasText: "Deploying..." });
  await deployingBtn.waitFor({ state: "visible", timeout: 5000 });
  console.log("   Deploying state shown.");

  console.log("\n3. Waiting for instance to become running...");
  const liveText = page.getByText("OpenClaw is live", { exact: true });
  await liveText.waitFor({ state: "visible", timeout: 90000 });
  console.log("   Instance is live!");

  const dashboardLink = page.locator("a", { hasText: "Open Dashboard" });
  await dashboardLink.waitFor({ state: "visible" });
  const dashboardHref = await dashboardLink.getAttribute("href");
  console.log(`   Dashboard link: ${dashboardHref}`);

  console.log("\n4. Opening dashboard...");
  const dashboardPage = await browser.newPage();
  const failedRequests = [];
  dashboardPage.on("response", (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`${res.status()} ${res.url()}`);
    }
  });

  const consoleMessages = [];
  dashboardPage.on("console", (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  await dashboardPage.goto(`${BASE}${dashboardHref}`, { waitUntil: "load" });
  console.log(`   Dashboard title: ${await dashboardPage.title()}`);

  // Check assets loaded
  if (failedRequests.length > 0) {
    console.log(`\n   FAILED REQUESTS (${failedRequests.length}):`);
    failedRequests.forEach((r) => console.log(`     - ${r}`));
  } else {
    console.log("   All HTTP requests succeeded.");
  }

  const pageContent = await dashboardPage.content();
  const hasTitle = pageContent.includes("OpenClaw Control");
  const hasApp = pageContent.includes("openclaw-app");
  const isBlank = !hasTitle;
  console.log(`   Page has title: ${hasTitle}, has <openclaw-app>: ${hasApp}`);
  console.log(`   Page URL: ${dashboardPage.url()}`);
  console.log(`   Has injection script: ${pageContent.includes("openclaw.control.settings")}`);

  // Check localStorage
  const lsCheck = await dashboardPage.evaluate(() => {
    const keys = Object.keys(localStorage);
    return { keys, length: localStorage.length };
  });
  console.log(`   localStorage keys: ${JSON.stringify(lsCheck)}`);

  // Wait for auto-approver to approve device pairing + WS reconnect.
  // Flow: page loads → WS connects → pairing request → auto-approver polls
  // (2s interval) → approves → client reconnects. Total ~6-10s.
  console.log("\n5. Waiting for WebSocket connection (auto-pairing)...");
  let wsConnected = false;
  for (let i = 0; i < 15; i++) {
    await dashboardPage.waitForTimeout(2000);

    const bodyText = await dashboardPage.evaluate(() => document.body?.innerText || "");
    const hasPairingError = bodyText.includes("pairing required");
    // "connected" appears in the UI only when WS is up, but "disconnected"
    // also contains "connected" as a substring. Check for standalone status.
    const hasDisconnected = bodyText.includes("disconnected");

    if (!hasPairingError && !hasDisconnected && i >= 2) {
      // After at least 4s with no errors, check for positive connection signs
      wsConnected = true;
      console.log(`   Connected after ~${(i + 1) * 2}s`);
      break;
    }

    if (i < 5) {
      console.log(`   [${(i + 1) * 2}s] waiting... (pairing=${hasPairingError} disconnected=${hasDisconnected})`);
    }
  }

  // Verify connection by checking localStorage for device auth token
  // (only set after successful pairing + connect)
  const settings = await dashboardPage.evaluate(() => {
    return localStorage.getItem("openclaw.control.settings.v1");
  });
  const deviceAuth = await dashboardPage.evaluate(() => {
    return localStorage.getItem("openclaw.device.auth.v1");
  });
  if (settings) {
    const parsed = JSON.parse(settings);
    console.log(`   localStorage gatewayUrl: ${parsed.gatewayUrl}`);
    console.log(`   localStorage token: ${parsed.token ? "set (" + parsed.token.substring(0, 8) + "...)" : "empty"}`);
  } else {
    console.log("   localStorage settings: NOT SET");
  }
  console.log(`   localStorage device auth: ${deviceAuth ? "set (paired)" : "not set"}`);

  // Check console for persistent WS errors (transient 1008 during pairing is expected)
  const persistentErrors = consoleMessages.filter(
    (m) => m.includes("1006") // 1006 = abnormal closure (real error)
  );
  if (persistentErrors.length > 0) {
    console.log("   Persistent WS errors:");
    persistentErrors.forEach((m) => console.log(`     ${m}`));
  } else {
    console.log("   No persistent WS errors.");
  }

  console.log("\n6. Destroying instance...");
  await page.bringToFront();
  const destroyBtn = page.locator("button", { hasText: "Destroy" }).first();
  if (await destroyBtn.isVisible()) {
    await destroyBtn.click();
    await page.waitForTimeout(2000);
    console.log("   Destroyed.");
  }

  const pass = failedRequests.length === 0 && !isBlank && wsConnected;
  console.log(`\n=== RESULT: ${pass ? "PASS" : "FAIL"} ===`);
  if (!pass) {
    if (!wsConnected) console.log("   REASON: WebSocket did not connect after pairing");
    if (failedRequests.length > 0) console.log("   REASON: HTTP requests failed");
    if (isBlank) console.log("   REASON: Page is blank");
  }

  await browser.close();
  process.exit(pass ? 0 : 1);
}

run().catch((err) => {
  console.error("TEST FAILED:", err.message);
  process.exit(1);
});
