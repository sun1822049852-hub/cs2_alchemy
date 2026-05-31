"use strict";

const fs = require("fs");
const path = require("path");
const {execFileSync} = require("child_process");
const {asString} = require("./utils");

const ENV_PROXY_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "HTTP_PROXY",
  "http_proxy"
];

function defaultConfigPath() {
  return path.resolve(__dirname, "../..", "config.py");
}

function parseConfigValue(rawValue) {
  const value = asString(rawValue).trim();
  if (!value || value === "None") {
    return "";
  }
  const quoted = value.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) {
    return quoted[2].trim();
  }
  return "";
}

function readPythonProxyConfig(configPath) {
  const filePath = asString(configPath).trim() || defaultConfigPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const text = fs.readFileSync(filePath, "utf8");
    const useProxyMatch = text.match(/^\s*USE_PROXY\s*=\s*(True|False)\s*(?:#.*)?$/m);
    const proxyUrlMatch = text.match(/^\s*PROXY_URL\s*=\s*(.+?)\s*(?:#.*)?$/m);
    if (!useProxyMatch || !proxyUrlMatch) {
      return null;
    }
    return {
      useProxy: useProxyMatch[1] === "True",
      proxyUrl: parseConfigValue(proxyUrlMatch[1])
    };
  } catch (_) {
    return null;
  }
}

function getEnvProxyUrl(env = process.env) {
  for (const key of ENV_PROXY_KEYS) {
    const value = asString(env && env[key]).trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function readWindowsSystemProxy() {
  if (process.platform !== "win32") {
    return "";
  }
  try {
    const output = execFileSync(
      "reg",
      [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true
      }
    );
    return parseWindowsProxyServer(output);
  } catch (_) {
    return "";
  }
}

function parseWindowsProxyServer(output) {
  const text = asString(output);
  const enabledMatch = text.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  if (enabledMatch && Number.parseInt(enabledMatch[1], 16) === 0) {
    return "";
  }
  const match = text.match(/ProxyServer\s+REG_\w+\s+([^\r\n]+)/i);
  if (!match) {
    return "";
  }
  return normalizeProxyUrl(match[1]);
}

function normalizeProxyUrl(value) {
  const text = asString(value).trim();
  if (!text) {
    return "";
  }
  const entries = text.split(";").map((item) => item.trim()).filter(Boolean);
  const selected = entries.find((item) => /^https\s*=/i.test(item))
    || entries.find((item) => /^http\s*=/i.test(item))
    || entries[0];
  const raw = selected.includes("=") ? selected.slice(selected.indexOf("=") + 1).trim() : selected;
  if (!raw) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return raw;
  }
  return `http://${raw}`;
}

function getWindowsSystemProxyUrl({windowsProxyResolver = readWindowsSystemProxy} = {}) {
  if (typeof windowsProxyResolver !== "function") {
    return "";
  }
  return normalizeProxyUrl(windowsProxyResolver());
}

function getProxyUrl({configPath, env = process.env, windowsProxyResolver = readWindowsSystemProxy} = {}) {
  const pythonConfig = readPythonProxyConfig(configPath);
  if (pythonConfig && pythonConfig.useProxy && pythonConfig.proxyUrl) {
    return pythonConfig.proxyUrl;
  }
  return getEnvProxyUrl(env) || getWindowsSystemProxyUrl({windowsProxyResolver});
}

function isSocksProxy(proxyUrl) {
  return /^socks[45]h?:\/\//i.test(asString(proxyUrl).trim());
}

function isHttpProxy(proxyUrl) {
  return /^https?:\/\//i.test(asString(proxyUrl).trim());
}

function parseProxyUrl(proxyUrl) {
  const value = asString(proxyUrl).trim();
  if (!value) {
    return null;
  }
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch (err) {
    throw new Error(`Invalid proxy configuration: ${value}`);
  }
  const protocol = asString(parsed.protocol).trim().toLowerCase();
  if (!["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(protocol)) {
    throw new Error(`Unsupported proxy scheme: ${protocol || value}`);
  }
  if (!parsed.hostname) {
    throw new Error(`Invalid proxy configuration: ${value}`);
  }
  return {
    url: value,
    protocol
  };
}

function createProxyAgent({configPath, env = process.env, windowsProxyResolver = readWindowsSystemProxy, keepAlive = false, targetProtocol = "https:"} = {}) {
  const proxyUrl = getProxyUrl({configPath, env, windowsProxyResolver});
  if (!proxyUrl) {
    return null;
  }
  const parsedProxy = parseProxyUrl(proxyUrl);
  try {
    if (parsedProxy.protocol.startsWith("socks")) {
      const {SocksProxyAgent} = require("socks-proxy-agent");
      return new SocksProxyAgent(parsedProxy.url, {keepAlive});
    }
    if (asString(targetProtocol).trim().toLowerCase() === "http:") {
      const {HttpProxyAgent} = require("http-proxy-agent");
      return new HttpProxyAgent(parsedProxy.url, {keepAlive});
    }
    const {HttpsProxyAgent} = require("https-proxy-agent");
    return new HttpsProxyAgent(parsedProxy.url, {keepAlive});
  } catch (err) {
    throw new Error(`Invalid proxy configuration: ${proxyUrl}${err && err.message ? ` (${err.message})` : ""}`);
  }
}

function createProxyAgentForUrl(targetUrl, options = {}) {
  let targetProtocol = "https:";
  try {
    targetProtocol = new URL(asString(targetUrl).trim()).protocol || "https:";
  } catch (_) {
    targetProtocol = "https:";
  }
  return createProxyAgent({
    ...options,
    targetProtocol
  });
}

function getSteamSessionProxyOptions(options = {}) {
  const proxyUrl = getProxyUrl(options);
  if (!proxyUrl) {
    return {};
  }
  const parsedProxy = parseProxyUrl(proxyUrl);
  if (parsedProxy.protocol.startsWith("socks")) {
    return {socksProxy: parsedProxy.url};
  }
  return {httpProxy: parsedProxy.url};
}

function getSteamCommunityRequestOptions(options = {}) {
  const proxyUrl = getProxyUrl(options);
  if (!proxyUrl) {
    return {};
  }
  const parsedProxy = parseProxyUrl(proxyUrl);
  if (parsedProxy.protocol.startsWith("socks")) {
    throw new Error("SteamCommunity does not support SOCKS proxy");
  }
  return {proxy: parsedProxy.url};
}

function getSteamCommunityOptions(options = {}) {
  const requestOptions = getSteamCommunityRequestOptions(options);
  if (!requestOptions.proxy) {
    return {};
  }
  try {
    const Request = require("request");
    return {
      request: Request.defaults({
        forever: true,
        proxy: requestOptions.proxy
      }),
      requestProxy: requestOptions.proxy
    };
  } catch (err) {
    throw new Error(
      `Invalid SteamCommunity proxy configuration: ${requestOptions.proxy}${
        err && err.message ? ` (${err.message})` : ""
      }`
    );
  }
}

function redactProxyUrl(proxyUrl) {
  const value = asString(proxyUrl).trim();
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch (_) {
    return value.replace(/:\/\/([^:@\s]+):([^@\s]+)@/, "://***:***@");
  }
}

function proxyHint({configPath, env = process.env, windowsProxyResolver = readWindowsSystemProxy} = {}) {
  const proxyUrl = getProxyUrl({configPath, env, windowsProxyResolver});
  if (proxyUrl) {
    return ` (proxy=${redactProxyUrl(proxyUrl)})`;
  }
  return " (proxy not configured)";
}

module.exports = {
  getProxyUrl,
  proxyHint,
  getWindowsSystemProxyUrl,
  parseWindowsProxyServer,
  redactProxyUrl,
  createProxyAgent,
  createProxyAgentForUrl,
  getSteamSessionProxyOptions,
  getSteamCommunityRequestOptions,
  getSteamCommunityOptions,
  parseProxyUrl,
  isHttpProxy,
  isSocksProxy
};
