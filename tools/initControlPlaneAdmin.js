#!/usr/bin/env node
const path = require("node:path");
const {ControlPlaneStore} = require(path.join(__dirname, "..", "admin_console", "src", "controlPlaneStore"));
const {PATHS} = require(path.join(__dirname, "..", "admin_console", "src", "constants"));

function readArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return String(process.argv[index + 1] || "").trim();
}

function main() {
  const username = readArg("--username", "admin") || "admin";
  const password = readArg("--password", "");
  const dbPath = readArg("--db", PATHS.DEFAULT_DB_FILE) || PATHS.DEFAULT_DB_FILE;
  if (!password) {
    console.error("Usage: node tools/initControlPlaneAdmin.js --password \"YourPassword\" [--username admin] [--db path]");
    process.exit(1);
  }
  const store = new ControlPlaneStore({dbPath});
  try {
    const user = store.createOrUpdateAdminUser({
      username,
      password,
      isSuperAdmin: true
    });
    console.log(`control-plane admin ready: ${user.username} (${dbPath})`);
  } finally {
    store.close();
  }
}

main();
