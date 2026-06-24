import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const extensionDir = resolve(process.argv[2] ?? "dist");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing: ${path}`);
  }
}

function extensionPath(reference) {
  return join(extensionDir, reference.replace(/^\/+/, ""));
}

assertFile(extensionDir, "Extension directory");

const manifestPath = join(extensionDir, "manifest.json");
assertFile(manifestPath, "Manifest");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) {
  fail("manifest_version must be 3.");
}

if (manifest.action?.default_popup) {
  assertFile(extensionPath(manifest.action.default_popup), "Default popup");
}

if (manifest.background?.service_worker) {
  assertFile(extensionPath(manifest.background.service_worker), "Background service worker");
}

for (const [index, script] of (manifest.content_scripts ?? []).entries()) {
  for (const file of script.js ?? []) {
    assertFile(extensionPath(file), `Content script ${index}`);
  }
}

validateHtmlReferences(manifest.action?.default_popup);
runChromeSmokeTest();

function validateHtmlReferences(htmlReference) {
  if (!htmlReference) {
    return;
  }
  const htmlPath = extensionPath(htmlReference);
  const html = readFileSync(htmlPath, "utf8");
  if (html.includes("/src/")) {
    fail(`${htmlReference} still references source files.`);
  }
  const references = html.matchAll(/\b(?:src|href)="([^"]+)"/g);
  for (const [, reference] of references) {
    if (/^(?:https?:|data:|#)/.test(reference)) {
      continue;
    }
    const target = reference.startsWith("/")
      ? extensionPath(reference)
      : join(dirname(htmlPath), reference);
    assertFile(target, `${basename(htmlReference)} reference`);
  }
}

function runChromeSmokeTest() {
  const chrome = findChrome();
  if (!chrome) {
    fail("Chrome executable was not found for extension smoke test.");
  }
  const userDataDir = mkdtempSync(join(tmpdir(), "scenario-recorder-chrome-"));
  const result = spawnSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions-except=" + extensionDir,
    "--load-extension=" + extensionDir,
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=" + userDataDir,
    "data:text/html,<title>scenario-recorder-smoke</title>",
  ], {
    encoding: "utf8",
    killSignal: "SIGKILL",
    timeout: 15000,
  });
  rmSync(userDataDir, { recursive: true, force: true });

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error && result.error.code !== "ETIMEDOUT") {
    fail(`Chrome smoke test failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 && result.error?.code !== "ETIMEDOUT") {
    fail(`Chrome smoke test failed with status ${result.status}.\n${output}`);
  }
  if (/Failed to load extension|Could not load|Manifest is not valid/i.test(output)) {
    fail(`Chrome reported an extension load error.\n${output}`);
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isAbsolute(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }

  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  }
  return undefined;
}
