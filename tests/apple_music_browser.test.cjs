const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../static/apple-music.js"), "utf8");
const tick = () => new Promise(setImmediate);

function harness({ userToken = "user-test-token", libraryError = null, configurationError = null } = {}) {
  const steps = [];
  const handlers = {};
  const button = { disabled: true, addEventListener: (name, callback) => { handlers[name] = callback; } };
  const status = { textContent: "" };
  const requests = [];
  const music = {
    authorize: async () => { steps.push("authorize"); return userToken; },
    unauthorize: async () => { steps.push("unauthorize"); },
  };
  const MusicKit = { configure: async (config) => { assert.equal(config.developerToken, "developer-test-token"); }, getInstance: () => music };
  const document = { getElementById: (id) => id === "apple-authorize" ? button : status, addEventListener: () => {} };
  const window = { MusicKit, addEventListener: () => {}, location: { assign: (target) => { steps.push("navigate:" + target); } } };
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === "/apple-music/config") {
      return { ok: !configurationError, json: async () => configurationError ? { error: configurationError } : { developerToken: "developer-test-token" } };
    }
    assert.equal(url, "/apple-music/library");
    return { ok: !libraryError, json: async () => libraryError ? { error: libraryError } : { ok: true } };
  };
  vm.runInNewContext(source, { window, document, MusicKit, fetch });
  return { button, status, requests, steps, click: () => handlers.click() };
}

test("Apple authorization sends the token in a POST body and clears SDK authorization before navigation", async () => {
  const app = harness();
  await tick();
  assert.equal(app.button.disabled, false);
  await app.click();
  const request = app.requests.find((item) => item.url === "/apple-music/library");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).music_user_token, "user-test-token");
  assert.deepEqual(app.steps, ["authorize", "unauthorize", "navigate:/apple-music/artists"]);
});

test("Canceling Apple consent sends no library request", async () => {
  const app = harness({ userToken: undefined });
  // Use null because the harness defaults undefined to the successful test token.
  const canceled = harness({ userToken: null });
  await tick();
  await canceled.click();
  assert.equal(canceled.requests.length, 1);
  assert.match(canceled.status.textContent, /cancelada/);
  assert.deepEqual(canceled.steps, ["authorize", "unauthorize"]);
});

test("Library errors remain visible and never navigate to a partial selection", async () => {
  const app = harness({ libraryError: "Assinatura Apple Music inválida" });
  await tick();
  await app.click();
  assert.match(app.status.textContent, /Assinatura Apple Music inválida/);
  assert.deepEqual(app.steps, ["authorize", "unauthorize"]);
});

test("Invalid developer configuration leaves authorization unavailable", async () => {
  const app = harness({ configurationError: "Token expirado" });
  await tick();
  assert.equal(app.button.disabled, true);
  assert.match(app.status.textContent, /Token expirado/);
});
