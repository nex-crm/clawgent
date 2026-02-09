/**
 * Clawgent E2E Test Suite
 *
 * Covers:
 *   1. Status API (public, no auth)
 *   2. Auth flow (dev-mode bypass — no WorkOS configured)
 *   3. User API (dev user identity + instance tracking)
 *   4. Deploy validation (missing fields, bad provider)
 *   5. Full instance lifecycle: deploy -> running -> agents -> deep link -> destroy
 *   6. Multi-agent operations: add, list, deep link, delete
 *   7. Error cases: duplicate deploy (409), destroy non-existent (404),
 *      agents on non-existent instance (404), delete main agent (400)
 *   8. Dashboard UI smoke test (proxy, assets, WebSocket pairing)
 *
 * Prerequisites:
 *   - Dev server running on localhost:3001 (npm run dev)
 *   - Docker available and clawgent-openclaw image built
 *   - No WorkOS env vars set (dev-mode auth bypass)
 *   - A valid LLM API key in TEST_API_KEY env var (or ANTHROPIC_API_KEY)
 *
 * Run:
 *   node test-e2e.mjs
 *   TEST_PROVIDER=google TEST_API_KEY=... node test-e2e.mjs
 */

import { chromium } from "/opt/homebrew/lib/node_modules/playwright/index.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE = process.env.TEST_BASE_URL || "http://localhost:3001";
const API = `${BASE}/api`;

// Provider + API key for deploy tests. Defaults to anthropic.
const TEST_PROVIDER = process.env.TEST_PROVIDER || "anthropic";
const TEST_API_KEY =
  process.env.TEST_API_KEY || process.env.ANTHROPIC_API_KEY || "";

// Persona used for initial deploy (must match a key in PERSONA_CONFIGS)
const DEPLOY_PERSONA = "dev-copilot";

// Persona used for multi-agent add test (different from deploy persona)
const ADD_AGENT_PERSONA = "marketing-pro";

// Timeouts
const DEPLOY_TIMEOUT_MS = 120_000; // 2 min for container startup + health
const WS_PAIRING_TIMEOUT_MS = 30_000; // 30s for WebSocket auto-pairing

// Dev-mode expected user
const DEV_USER_ID = "dev-user-local";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;
const failures = [];

function log(msg) {
  console.log(msg);
}

function section(name) {
  log(`\n${"=".repeat(70)}`);
  log(`  ${name}`);
  log("=".repeat(70));
}

function pass(name) {
  testsPassed++;
  log(`  PASS  ${name}`);
}

function fail(name, reason) {
  testsFailed++;
  failures.push({ name, reason });
  log(`  FAIL  ${name}`);
  log(`        Reason: ${reason}`);
}

function skip(name, reason) {
  testsSkipped++;
  log(`  SKIP  ${name}`);
  log(`        Reason: ${reason}`);
}

function assert(condition, testName, failReason) {
  if (condition) {
    pass(testName);
  } else {
    fail(testName, failReason);
  }
  return condition;
}

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function apiPost(path, data) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function apiDelete(path) {
  const res = await fetch(`${API}${path}`, { method: "DELETE" });
  const body = await res.json();
  return { status: res.status, body };
}

/**
 * Poll an API endpoint until a condition is met or timeout.
 */
async function pollUntil(path, conditionFn, timeoutMs, intervalMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await apiGet(path);
    if (conditionFn(result)) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil timed out after ${timeoutMs}ms on ${path}`);
}

/**
 * Ensure no leftover instance exists for the dev user.
 * Destroys any existing instance so tests start clean.
 */
async function ensureCleanState() {
  const { body } = await apiGet("/user");
  if (body.instance && body.instance.id) {
    log(`  Cleaning up leftover instance ${body.instance.id}...`);
    await apiDelete(`/instances/${body.instance.id}`);
    // Wait a moment for container teardown
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------------------------------------------------------------------------
// Test Sections
// ---------------------------------------------------------------------------

async function testStatusApi() {
  section("1. Status API (public, no auth required)");

  const { status, body } = await apiGet("/status");

  assert(status === 200, "GET /api/status returns 200", `Got ${status}`);
  assert(
    typeof body.dockerAvailable === "boolean",
    "Response includes dockerAvailable boolean",
    `Got ${typeof body.dockerAvailable}`,
  );
  assert(
    typeof body.totalInstances === "number",
    "Response includes totalInstances number",
    `Got ${typeof body.totalInstances}`,
  );
  assert(
    typeof body.runningInstances === "number",
    "Response includes runningInstances number",
    `Got ${typeof body.runningInstances}`,
  );
  assert(
    body.dockerAvailable === true,
    "Docker is available (required for remaining tests)",
    "Docker is not available -- cannot continue",
  );

  return body.dockerAvailable;
}

async function testAuthDevMode() {
  section("2. Auth — Dev-Mode Bypass");

  // In dev mode (no WorkOS env vars), the user API should return the dev user
  const { status, body } = await apiGet("/user");

  assert(status === 200, "GET /api/user returns 200", `Got ${status}`);
  assert(body.user !== null, "User object is present", "user is null");
  assert(
    body.user?.id === DEV_USER_ID,
    `User ID is '${DEV_USER_ID}'`,
    `Got '${body.user?.id}'`,
  );
  assert(
    body.user?.email === "dev@localhost",
    "Dev user email is dev@localhost",
    `Got '${body.user?.email}'`,
  );
  assert(
    body.user?.firstName === "Dev",
    "Dev user firstName is 'Dev'",
    `Got '${body.user?.firstName}'`,
  );
}

async function testDeployValidation() {
  section("3. Deploy Validation (error cases)");

  // 3a. Missing provider and apiKey
  {
    const { status, body } = await apiPost("/deploy", {});
    assert(
      status === 400,
      "Deploy with empty body returns 400",
      `Got ${status}: ${JSON.stringify(body)}`,
    );
  }

  // 3b. Missing apiKey
  {
    const { status, body } = await apiPost("/deploy", {
      provider: "anthropic",
    });
    assert(
      status === 400,
      "Deploy with missing apiKey returns 400",
      `Got ${status}: ${JSON.stringify(body)}`,
    );
  }

  // 3c. Invalid provider
  {
    const { status, body } = await apiPost("/deploy", {
      provider: "invalid-provider",
      apiKey: "fake-key",
    });
    assert(
      status === 400,
      "Deploy with invalid provider returns 400",
      `Got ${status}: ${JSON.stringify(body)}`,
    );
    assert(
      body.error?.includes("Unknown provider"),
      "Error message mentions unknown provider",
      `Got: ${body.error}`,
    );
  }
}

async function testInstanceLifecycle() {
  section("4. Instance Lifecycle — Deploy, Run, Agents, Destroy");

  if (!TEST_API_KEY) {
    skip(
      "Full instance lifecycle",
      "No TEST_API_KEY or ANTHROPIC_API_KEY set. Skipping deploy tests.",
    );
    return null;
  }

  // -----------------------------------------------------------------------
  // 4a. Deploy a new instance
  // -----------------------------------------------------------------------
  log("\n  --- 4a. Deploy ---");

  const deployRes = await apiPost("/deploy", {
    provider: TEST_PROVIDER,
    apiKey: TEST_API_KEY,
    persona: DEPLOY_PERSONA,
  });

  const deployOk = assert(
    deployRes.status === 200,
    "POST /api/deploy returns 200",
    `Got ${deployRes.status}: ${JSON.stringify(deployRes.body)}`,
  );

  if (!deployOk) return null;

  const instanceId = deployRes.body.id;
  assert(
    typeof instanceId === "string" && instanceId.length > 0,
    "Deploy returns an instance ID",
    `Got: ${instanceId}`,
  );
  assert(
    deployRes.body.status === "starting",
    "Initial status is 'starting'",
    `Got: ${deployRes.body.status}`,
  );

  log(`  Instance ID: ${instanceId}`);

  // -----------------------------------------------------------------------
  // 4b. Duplicate deploy should return 409
  // -----------------------------------------------------------------------
  log("\n  --- 4b. Duplicate Deploy (409) ---");

  // Wait a moment for the instance to register
  await new Promise((r) => setTimeout(r, 1000));

  const dupRes = await apiPost("/deploy", {
    provider: TEST_PROVIDER,
    apiKey: TEST_API_KEY,
    persona: DEPLOY_PERSONA,
  });

  assert(
    dupRes.status === 409,
    "Duplicate deploy returns 409",
    `Got ${dupRes.status}: ${JSON.stringify(dupRes.body)}`,
  );
  assert(
    dupRes.body.existingInstanceId === instanceId,
    "409 response references existing instance ID",
    `Got: ${dupRes.body.existingInstanceId}`,
  );

  // -----------------------------------------------------------------------
  // 4c. Poll until instance is running
  // -----------------------------------------------------------------------
  log("\n  --- 4c. Wait for Running ---");

  let runningInstance;
  try {
    runningInstance = await pollUntil(
      `/instances/${instanceId}`,
      (r) => r.body.status === "running" || r.body.status === "error",
      DEPLOY_TIMEOUT_MS,
      3000,
    );
  } catch (e) {
    fail("Instance reaches running state", `Timed out: ${e.message}`);
    return instanceId; // Return ID for cleanup
  }

  const isRunning = assert(
    runningInstance.body.status === "running",
    "Instance reaches 'running' status",
    `Got '${runningInstance.body.status}'. Logs: ${runningInstance.body.logs?.slice(-3)?.join(" | ")}`,
  );

  if (!isRunning) return instanceId;

  assert(
    runningInstance.body.dashboardUrl !== null,
    "Running instance has a dashboardUrl",
    `Got: ${runningInstance.body.dashboardUrl}`,
  );
  assert(
    runningInstance.body.persona === DEPLOY_PERSONA,
    `Instance persona is '${DEPLOY_PERSONA}'`,
    `Got: ${runningInstance.body.persona}`,
  );
  assert(
    runningInstance.body.provider === TEST_PROVIDER,
    `Instance provider is '${TEST_PROVIDER}'`,
    `Got: ${runningInstance.body.provider}`,
  );
  assert(
    typeof runningInstance.body.token === "string" &&
      runningInstance.body.token.length > 0,
    "Instance has a gateway token",
    "Token is missing or empty",
  );

  // -----------------------------------------------------------------------
  // 4d. User API should now show the instance
  // -----------------------------------------------------------------------
  log("\n  --- 4d. User API Reflects Instance ---");

  const { body: userBody } = await apiGet("/user");
  assert(
    userBody.instance !== null,
    "GET /api/user shows user has an instance",
    "instance is null",
  );
  assert(
    userBody.instance?.id === instanceId,
    "User's instance ID matches deployed instance",
    `Got: ${userBody.instance?.id}`,
  );

  // -----------------------------------------------------------------------
  // 4e. Deploy list includes our instance
  // -----------------------------------------------------------------------
  log("\n  --- 4e. Deploy List ---");

  const { status: listStatus, body: listBody } = await apiGet("/deploy");
  assert(listStatus === 200, "GET /api/deploy returns 200", `Got ${listStatus}`);
  const found = listBody.instances?.find((i) => i.id === instanceId);
  assert(
    found !== undefined,
    "Instance appears in deploy list",
    "Instance not found in list",
  );
  assert(
    found?.status === "running",
    "Instance status in list is 'running'",
    `Got: ${found?.status}`,
  );

  return instanceId;
}

async function testMultiAgentOperations(instanceId) {
  section("5. Multi-Agent Operations");

  if (!instanceId) {
    skip("Multi-agent operations", "No running instance (deploy was skipped or failed)");
    return;
  }

  // -----------------------------------------------------------------------
  // 5a. List agents — should have at least "main"
  // -----------------------------------------------------------------------
  log("\n  --- 5a. List Agents (initial) ---");

  const { status: listStatus, body: listBody } = await apiGet(
    `/instances/${instanceId}/agents`,
  );
  assert(
    listStatus === 200,
    "GET /agents returns 200",
    `Got ${listStatus}: ${JSON.stringify(listBody)}`,
  );
  assert(
    Array.isArray(listBody.agents),
    "Response has agents array",
    `Got: ${typeof listBody.agents}`,
  );

  const mainAgent = listBody.agents?.find((a) => a.agentId === "main");
  assert(
    mainAgent !== undefined,
    "'main' agent exists in agent list",
    `Agents: ${JSON.stringify(listBody.agents?.map((a) => a.agentId))}`,
  );

  if (mainAgent) {
    assert(
      typeof mainAgent.deepLink === "string" && mainAgent.deepLink.includes(`/i/${instanceId}/`),
      "Main agent has a valid deep link",
      `Got: ${mainAgent.deepLink}`,
    );
  }

  // -----------------------------------------------------------------------
  // 5b. Add an agent with a persona
  // -----------------------------------------------------------------------
  log("\n  --- 5b. Add Agent ---");

  const addRes = await apiPost(`/instances/${instanceId}/agents`, {
    persona: ADD_AGENT_PERSONA,
  });

  const addOk = assert(
    addRes.status === 200,
    `POST /agents with persona '${ADD_AGENT_PERSONA}' returns 200`,
    `Got ${addRes.status}: ${JSON.stringify(addRes.body)}`,
  );

  let addedAgentId = null;

  if (addOk) {
    addedAgentId = addRes.body.agentId;
    assert(
      typeof addedAgentId === "string" && addedAgentId.length > 0,
      "Add agent returns an agentId",
      `Got: ${addedAgentId}`,
    );
    assert(
      addRes.body.persona === ADD_AGENT_PERSONA,
      `Added agent persona is '${ADD_AGENT_PERSONA}'`,
      `Got: ${addRes.body.persona}`,
    );
    assert(
      typeof addRes.body.deepLink === "string",
      "Added agent has a deepLink",
      `Got: ${addRes.body.deepLink}`,
    );
    assert(
      addRes.body.deepLink?.includes(`session=agent:${addedAgentId}:main`),
      "Deep link contains correct session param format",
      `Got: ${addRes.body.deepLink}`,
    );
    assert(
      addRes.body.status === "configured",
      "Added agent status is 'configured' (persona was provided)",
      `Got: ${addRes.body.status}`,
    );

    log(`  Added agent ID: ${addedAgentId}`);
  }

  // -----------------------------------------------------------------------
  // 5c. List agents again — should include the new agent
  // -----------------------------------------------------------------------
  log("\n  --- 5c. List Agents (after add) ---");

  // Give the agent a moment to be fully registered
  await new Promise((r) => setTimeout(r, 2000));

  const { status: list2Status, body: list2Body } = await apiGet(
    `/instances/${instanceId}/agents`,
  );
  assert(list2Status === 200, "GET /agents returns 200 after add", `Got ${list2Status}`);

  if (addedAgentId) {
    const newAgent = list2Body.agents?.find((a) => a.agentId === addedAgentId);
    assert(
      newAgent !== undefined,
      `New agent '${addedAgentId}' appears in agent list`,
      `Agents: ${JSON.stringify(list2Body.agents?.map((a) => a.agentId))}`,
    );
    assert(
      list2Body.agents?.length >= 2,
      "Agent list has at least 2 agents (main + added)",
      `Got ${list2Body.agents?.length} agents`,
    );
  }

  // -----------------------------------------------------------------------
  // 5d. Add agent with invalid persona — should 400
  // -----------------------------------------------------------------------
  log("\n  --- 5d. Add Agent — Invalid Persona ---");

  {
    const { status, body } = await apiPost(`/instances/${instanceId}/agents`, {
      persona: "nonexistent-persona-xyz",
    });
    assert(
      status === 400,
      "Add agent with invalid persona returns 400",
      `Got ${status}: ${JSON.stringify(body)}`,
    );
    assert(
      body.error?.includes("Unknown persona"),
      "Error mentions unknown persona",
      `Got: ${body.error}`,
    );
  }

  // -----------------------------------------------------------------------
  // 5e. Cannot delete the main agent
  // -----------------------------------------------------------------------
  log("\n  --- 5e. Delete Main Agent (should fail) ---");

  {
    const { status, body } = await apiDelete(
      `/instances/${instanceId}/agents/main`,
    );
    assert(
      status === 400,
      "DELETE main agent returns 400",
      `Got ${status}: ${JSON.stringify(body)}`,
    );
    assert(
      body.error?.includes("Cannot delete the main agent"),
      "Error says cannot delete main agent",
      `Got: ${body.error}`,
    );
  }

  // -----------------------------------------------------------------------
  // 5f. Delete the added agent
  // -----------------------------------------------------------------------
  log("\n  --- 5f. Delete Added Agent ---");

  if (addedAgentId) {
    const delRes = await apiDelete(
      `/instances/${instanceId}/agents/${addedAgentId}`,
    );
    assert(
      delRes.status === 200,
      `DELETE agent '${addedAgentId}' returns 200`,
      `Got ${delRes.status}: ${JSON.stringify(delRes.body)}`,
    );
    assert(
      delRes.body.agentId === addedAgentId,
      "Delete response includes correct agentId",
      `Got: ${delRes.body.agentId}`,
    );

    // Verify deletion
    await new Promise((r) => setTimeout(r, 2000));
    const { body: list3Body } = await apiGet(
      `/instances/${instanceId}/agents`,
    );
    const deleted = list3Body.agents?.find((a) => a.agentId === addedAgentId);
    assert(
      deleted === undefined,
      `Deleted agent '${addedAgentId}' no longer in list`,
      `Agent still found: ${JSON.stringify(deleted)}`,
    );
  } else {
    skip("Delete added agent", "No agent was added");
  }
}

async function testAgentsOnNonExistentInstance() {
  section("6. Agent Operations on Non-Existent Instance");

  const fakeId = "deadbeef";

  // List agents
  {
    const { status } = await apiGet(`/instances/${fakeId}/agents`);
    assert(
      status === 404,
      "GET /agents on non-existent instance returns 404",
      `Got ${status}`,
    );
  }

  // Add agent
  {
    const { status } = await apiPost(`/instances/${fakeId}/agents`, {
      persona: "dev-copilot",
    });
    assert(
      status === 404,
      "POST /agents on non-existent instance returns 404",
      `Got ${status}`,
    );
  }

  // Delete agent
  {
    const { status } = await apiDelete(`/instances/${fakeId}/agents/some-agent`);
    assert(
      status === 404,
      "DELETE /agents/:agentId on non-existent instance returns 404",
      `Got ${status}`,
    );
  }
}

async function testDestroyNonExistent() {
  section("7. Destroy Non-Existent Instance");

  const { status, body } = await apiDelete("/instances/nonexistent99");
  assert(
    status === 404,
    "DELETE non-existent instance returns 404",
    `Got ${status}: ${JSON.stringify(body)}`,
  );
  assert(
    body.error?.includes("not found"),
    "Error message mentions not found",
    `Got: ${body.error}`,
  );
}

async function testDashboardUI(instanceId, browser) {
  section("8. Dashboard UI Smoke Test");

  if (!instanceId) {
    skip("Dashboard UI", "No running instance");
    return;
  }

  // Get instance details for dashboard URL
  const { body: inst } = await apiGet(`/instances/${instanceId}`);
  if (!inst.dashboardUrl) {
    skip("Dashboard UI", "No dashboardUrl on instance");
    return;
  }

  const dashboardUrl = `${BASE}${inst.dashboardUrl}`;
  log(`  Dashboard URL: ${dashboardUrl}`);

  const page = await browser.newPage();

  // Track failed requests
  const failedRequests = [];
  page.on("response", (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`${res.status()} ${res.url()}`);
    }
  });

  // Track console messages
  const consoleMessages = [];
  page.on("console", (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  await page.goto(dashboardUrl, { waitUntil: "load", timeout: 30000 });

  const pageContent = await page.content();
  assert(
    pageContent.includes("OpenClaw Control"),
    "Dashboard page contains 'OpenClaw Control' title",
    "Title not found in page content",
  );

  assert(
    failedRequests.length === 0,
    "No failed HTTP requests loading dashboard",
    `Failed: ${failedRequests.join(", ")}`,
  );

  // Check for localStorage settings injection
  assert(
    pageContent.includes("openclaw.control.settings"),
    "Dashboard page has settings injection script",
    "Settings injection script not found",
  );

  // -----------------------------------------------------------------------
  // 8a. Wait for WebSocket auto-pairing
  // -----------------------------------------------------------------------
  log("\n  --- 8a. WebSocket Auto-Pairing ---");

  let wsConnected = false;
  const startWait = Date.now();
  while (Date.now() - startWait < WS_PAIRING_TIMEOUT_MS) {
    await page.waitForTimeout(2000);

    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    const hasPairingError = bodyText.includes("pairing required");
    const hasDisconnected = bodyText.includes("disconnected");
    const elapsed = Math.round((Date.now() - startWait) / 1000);

    if (
      !hasPairingError &&
      !hasDisconnected &&
      Date.now() - startWait > 4000
    ) {
      wsConnected = true;
      log(`  Connected after ~${elapsed}s`);
      break;
    }

    if (elapsed <= 10) {
      log(`  [${elapsed}s] waiting... (pairing=${hasPairingError} disconnected=${hasDisconnected})`);
    }
  }

  // Check localStorage for successful pairing
  const settings = await page.evaluate(() =>
    localStorage.getItem("openclaw.control.settings.v1"),
  );

  assert(
    wsConnected,
    "WebSocket connects after auto-pairing",
    "Timed out waiting for WS connection",
  );

  if (settings) {
    const parsed = JSON.parse(settings);
    assert(
      typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.length > 0,
      "localStorage has gatewayUrl set",
      `Got: ${parsed.gatewayUrl}`,
    );
    assert(
      typeof parsed.token === "string" && parsed.token.length > 0,
      "localStorage has token set",
      `Got: ${parsed.token ? "(set)" : "(empty)"}`,
    );
  }

  // Check for persistent WS errors (1006 = abnormal closure)
  const persistentErrors = consoleMessages.filter((m) => m.includes("1006"));
  assert(
    persistentErrors.length === 0,
    "No persistent WebSocket errors (1006)",
    `Found ${persistentErrors.length} errors`,
  );

  // -----------------------------------------------------------------------
  // 8b. Deep link navigation (agent session)
  // -----------------------------------------------------------------------
  log("\n  --- 8b. Deep Link Navigation ---");

  const deepLinkUrl = `${BASE}/i/${instanceId}/?token=${inst.token}&session=agent:main:main`;
  const deepPage = await browser.newPage();
  const deepFailedRequests = [];
  deepPage.on("response", (res) => {
    if (res.status() >= 400) {
      deepFailedRequests.push(`${res.status()} ${res.url()}`);
    }
  });

  await deepPage.goto(deepLinkUrl, { waitUntil: "load", timeout: 30000 });

  const deepContent = await deepPage.content();
  assert(
    deepContent.includes("OpenClaw Control"),
    "Deep link loads dashboard page",
    "Dashboard not loaded via deep link",
  );
  assert(
    deepFailedRequests.length === 0,
    "No failed requests on deep link page",
    `Failed: ${deepFailedRequests.join(", ")}`,
  );

  await deepPage.close();
  await page.close();
}

async function testDestroyInstance(instanceId) {
  section("9. Destroy Instance + Verify Cleanup");

  if (!instanceId) {
    skip("Destroy instance", "No instance to destroy");
    return;
  }

  // Destroy
  const { status, body } = await apiDelete(`/instances/${instanceId}`);
  assert(
    status === 200,
    `DELETE /instances/${instanceId} returns 200`,
    `Got ${status}: ${JSON.stringify(body)}`,
  );
  assert(
    body.id === instanceId,
    "Destroy response includes correct instance ID",
    `Got: ${body.id}`,
  );

  // Wait for container teardown
  await new Promise((r) => setTimeout(r, 3000));

  // Verify instance is gone from instance detail
  const { status: getStatus } = await apiGet(`/instances/${instanceId}`);
  assert(
    getStatus === 404,
    "GET destroyed instance returns 404",
    `Got ${getStatus}`,
  );

  // BUG REGRESSION TEST: Verify instance doesn't reappear after reconciliation
  // This tests the fix for the race condition where reconcileWithDocker()
  // would re-add destroyed instances from lingering Docker containers.
  const { status: userStatus, body: userData } = await apiGet("/user");
  assert(
    userStatus === 200,
    "GET /api/user returns 200 after destroy",
    `Got ${userStatus}`,
  );
  assert(
    userData.instance === null,
    "User instance is null after destroy (reconciliation doesn't resurrect it)",
    `Got instance: ${JSON.stringify(userData.instance)}`,
  );

  // Verify user no longer has an instance
  const { body: userBody } = await apiGet("/user");
  assert(
    userBody.instance === null,
    "User API shows no instance after destroy",
    `Got: ${JSON.stringify(userBody.instance)}`,
  );

  // Verify deploy list no longer includes it
  const { body: listBody } = await apiGet("/deploy");
  const found = listBody.instances?.find((i) => i.id === instanceId);
  assert(
    found === undefined,
    "Destroyed instance not in deploy list",
    `Found: ${JSON.stringify(found)}`,
  );
}

async function testLandingPageUI(browser) {
  section("10. Landing Page UI");

  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });

  const title = await page.title();
  assert(
    typeof title === "string" && title.length > 0,
    "Landing page has a title",
    `Got empty title`,
  );

  const deployBtn = page.locator("button", { hasText: "Deploy New Instance" });
  const btnVisible = await deployBtn
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  assert(
    btnVisible,
    "Deploy button is visible on landing page",
    "Deploy button not found or not visible",
  );

  await page.close();
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function run() {
  log("Clawgent E2E Test Suite");
  log(`Base URL: ${BASE}`);
  log(`Provider: ${TEST_PROVIDER}`);
  log(`API Key:  ${TEST_API_KEY ? `${TEST_API_KEY.substring(0, 8)}...` : "(not set)"}`);
  log(`Deploy persona: ${DEPLOY_PERSONA}`);
  log(`Add agent persona: ${ADD_AGENT_PERSONA}`);

  const browser = await chromium.launch({ headless: true });
  let instanceId = null;

  try {
    // Clean up any leftover state from previous runs
    await ensureCleanState();

    // Run tests in order — later tests depend on earlier ones

    // 1. Status API (public)
    const dockerAvailable = await testStatusApi();
    if (!dockerAvailable) {
      log("\nABORT: Docker is not available. Cannot run remaining tests.");
      await browser.close();
      process.exit(1);
    }

    // 2. Auth dev-mode bypass
    await testAuthDevMode();

    // 3. Deploy validation (error cases — no actual deploy)
    await testDeployValidation();

    // 4. Full instance lifecycle (deploy -> running)
    instanceId = await testInstanceLifecycle();

    // 5. Multi-agent operations (requires running instance)
    await testMultiAgentOperations(instanceId);

    // 6. Agent operations on non-existent instance (error cases)
    await testAgentsOnNonExistentInstance();

    // 7. Destroy non-existent instance (error case)
    await testDestroyNonExistent();

    // 8. Dashboard UI smoke test (requires running instance)
    await testDashboardUI(instanceId, browser);

    // 9. Destroy instance + verify cleanup
    await testDestroyInstance(instanceId);
    instanceId = null; // Cleared — no cleanup needed

    // 10. Landing page UI (after instance is destroyed — clean state)
    await testLandingPageUI(browser);
  } catch (err) {
    log(`\nUNEXPECTED ERROR: ${err.message}`);
    log(err.stack);
    testsFailed++;
    failures.push({ name: "Unexpected error", reason: err.message });
  } finally {
    // Cleanup: destroy instance if tests failed mid-way
    if (instanceId) {
      log("\n  Cleanup: destroying leftover instance...");
      try {
        await apiDelete(`/instances/${instanceId}`);
        await new Promise((r) => setTimeout(r, 2000));
        log("  Cleanup complete.");
      } catch (e) {
        log(`  Cleanup failed: ${e.message}`);
      }
    }

    await browser.close();
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  log(`\n${"=".repeat(70)}`);
  log("  RESULTS");
  log("=".repeat(70));
  log(`  Passed:  ${testsPassed}`);
  log(`  Failed:  ${testsFailed}`);
  log(`  Skipped: ${testsSkipped}`);
  log(`  Total:   ${testsPassed + testsFailed + testsSkipped}`);

  if (failures.length > 0) {
    log("\n  Failures:");
    for (const f of failures) {
      log(`    - ${f.name}: ${f.reason}`);
    }
  }

  log(`\n=== ${testsFailed === 0 ? "PASS" : "FAIL"} ===\n`);
  process.exit(testsFailed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("TEST SUITE CRASHED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
