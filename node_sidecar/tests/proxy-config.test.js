const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cs2-alchemy-proxy-config-"));
}

function writeConfig(dir, content) {
  const filePath = path.join(dir, "config.py");
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function withProxyEnv(envValues, fn) {
  const keys = [
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "HTTP_PROXY",
    "http_proxy"
  ];
  const original = {};
  for (const key of keys) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(envValues || {})) {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

function loadProxyConfigFresh() {
  const modulePath = path.resolve(__dirname, "../src/proxyConfig.js");
  delete require.cache[modulePath];
  return require(modulePath);
}

function test_config_py_enabled_takes_priority_over_env() {
  const tempDir = makeTempDir();
  try {
    const configPath = writeConfig(tempDir, [
      "USE_PROXY = True",
      "PROXY_URL = \"socks5://127.0.0.1:1080\"",
      ""
    ].join("\n"));
    const proxyConfig = loadProxyConfigFresh();

    withProxyEnv({HTTPS_PROXY: "http://env.example:8080"}, () => {
      assert.equal(proxyConfig.getProxyUrl({configPath}), "socks5://127.0.0.1:1080");
      assert.deepEqual(proxyConfig.getSteamSessionProxyOptions({configPath}), {
        socksProxy: "socks5://127.0.0.1:1080"
      });
    });
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_use_proxy_false_falls_back_to_env_priority_order() {
  const tempDir = makeTempDir();
  try {
    const configPath = writeConfig(tempDir, [
      "USE_PROXY = False",
      "PROXY_URL = \"socks5://127.0.0.1:1080\"",
      ""
    ].join("\n"));
    const proxyConfig = loadProxyConfigFresh();

    withProxyEnv({
      HTTP_PROXY: "http://http.example:8080",
      ALL_PROXY: "socks5://all.example:1080",
      HTTPS_PROXY: "http://https.example:8080"
    }, () => {
      assert.equal(proxyConfig.getProxyUrl({configPath}), "http://https.example:8080");
      assert.deepEqual(proxyConfig.getSteamSessionProxyOptions({configPath}), {
        httpProxy: "http://https.example:8080"
      });
    });
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_malformed_config_does_not_crash_and_falls_back_to_env() {
  const tempDir = makeTempDir();
  try {
    const configPath = writeConfig(tempDir, [
      "USE_PROXY = maybe",
      "PROXY_URL =",
      ""
    ].join("\n"));
    const proxyConfig = loadProxyConfigFresh();

    withProxyEnv({all_proxy: "socks4://env.example:1080"}, () => {
      assert.equal(proxyConfig.getProxyUrl({configPath}), "socks4://env.example:1080");
      assert.deepEqual(proxyConfig.getSteamSessionProxyOptions({configPath}), {
        socksProxy: "socks4://env.example:1080"
      });
    });
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_unconfigured_proxy_keeps_direct_connection() {
  const tempDir = makeTempDir();
  try {
    const configPath = path.join(tempDir, "config.py");
    const proxyConfig = loadProxyConfigFresh();

    withProxyEnv({}, () => {
      assert.equal(proxyConfig.getProxyUrl({configPath}), "");
      assert.equal(proxyConfig.createProxyAgent({configPath}), null);
      assert.deepEqual(proxyConfig.getSteamSessionProxyOptions({configPath}), {});
      assert.equal(proxyConfig.proxyHint({configPath}), " (proxy not configured)");
    });
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
}

function test_bad_proxy_url_fails_closed() {
  const proxyConfig = loadProxyConfigFresh();

  withProxyEnv({HTTPS_PROXY: "http://%"}, () => {
    assert.throws(
      () => proxyConfig.createProxyAgent(),
      /Invalid proxy configuration/
    );
  });
}

function test_unsupported_proxy_scheme_fails_closed() {
  const proxyConfig = loadProxyConfigFresh();

  withProxyEnv({HTTPS_PROXY: "ftp://127.0.0.1:21"}, () => {
    assert.throws(
      () => proxyConfig.createProxyAgent(),
      /Unsupported proxy scheme/
    );
  });
}

function main() {
  test_config_py_enabled_takes_priority_over_env();
  test_use_proxy_false_falls_back_to_env_priority_order();
  test_malformed_config_does_not_crash_and_falls_back_to_env();
  test_unconfigured_proxy_keeps_direct_connection();
  test_bad_proxy_url_fails_closed();
  test_unsupported_proxy_scheme_fails_closed();
  console.log("proxy-config tests passed");
}

main();
