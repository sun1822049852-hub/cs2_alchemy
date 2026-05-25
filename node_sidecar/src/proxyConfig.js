"use strict";

const fs = require("fs");
const path = require("path");
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

function getProxyUrl({configPath, env = process.env} = {}) {
  const pythonConfig = readPythonProxyConfig(configPath);
  if (pythonConfig && pythonConfig.useProxy && pythonConfig.proxyUrl) {
    return pythonConfig.proxyUrl;
  }
  return getEnvProxyUrl(env);
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

function createProxyAgent({configPath, env = process.env, keepAlive = false, targetProtocol = "https:"} = {}) {
  const proxyUrl = getProxyUrl({configPath, env});
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

function getSteamSessionProxyOptions({configPath, env = process.env} = {}) {
  const proxyUrl = getProxyUrl({configPath, env});
  if (!proxyUrl) {
    return {};
  }
  const parsedProxy = parseProxyUrl(proxyUrl);
  if (parsedProxy.protocol.startsWith("socks")) {
    return {socksProxy: parsedProxy.url};
  }
  return {httpProxy: parsedProxy.url};
}

function getSteamCommunityRequestOptions({configPath, env = process.env} = {}) {
  const proxyUrl = getProxyUrl({configPath, env});
  if (!proxyUrl) {
    return {};
  }
  const parsedProxy = parseProxyUrl(proxyUrl);
  if (parsedProxy.protocol.startsWith("socks")) {
    throw new Error("SteamCommunity does not support SOCKS proxy");
  }
  return {proxy: parsedProxy.url};
}

function getSteamCommunityOptions({configPath, env = process.env} = {}) {
  const requestOptions = getSteamCommunityRequestOptions({configPath, env});
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

function proxyHint({configPath, env = process.env} = {}) {
  const proxyUrl = getProxyUrl({configPath, env});
  if (proxyUrl) {
    return ` (proxy=${proxyUrl})`;
  }
  return " (proxy not configured)";
}

module.exports = {
  getProxyUrl,
  proxyHint,
  createProxyAgent,
  createProxyAgentForUrl,
  getSteamSessionProxyOptions,
  getSteamCommunityRequestOptions,
  getSteamCommunityOptions,
  parseProxyUrl,
  isHttpProxy,
  isSocksProxy
};
