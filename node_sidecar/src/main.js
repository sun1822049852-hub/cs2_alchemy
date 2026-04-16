const {AccountStore} = require("./accountStore");
const {TokenStore} = require("./tokenStore");
const {DedupLogger} = require("./logger");
const {refreshInventory} = require("./refreshWorkflow");
const {redeemMissionRewardDebug} = require("./redeemMissionRewardWorkflow");
const {captureGcSession} = require("./gcSessionCaptureWorkflow");
const {normalizeRedeemMissionRewardOptions} = require("./redeemMissionReward");
const {asString} = require("./utils");

function parseArgs(argv) {
  const out = {_positional: []};
  for (let i = 2; i < argv.length; i += 1) {
    const x = argv[i];
    if (!x.startsWith("--")) {
      out._positional.push(x);
      continue;
    }
    const key = x.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  node node_sidecar/src/main.js refresh [--account <name>] [--password <pwd>] [--dump-raw true|false]",
      "  node node_sidecar/src/main.js accounts list",
      "  node node_sidecar/src/main.js accounts use --account <name>",
      "  node node_sidecar/src/main.js accounts delete --account <name>",
      "  node node_sidecar/src/main.js tokens clear --account <name>",
      "  node node_sidecar/src/main.js redeem-mission-reward --account <name> [--campaign-id <id>] [--redeem-id <idx>] [--balance <n>] [--cost <n>] [--bid-control <n>] [--ack-tracks true|false] [--ack-wait-ms <ms>] [--wait-ms <ms>]",
      "  node node_sidecar/src/main.js gc-capture --account <name> [--duration-seconds <n>] [--ack-tracks true|false] [--ack-wait-ms <ms>] [--output <file>]",
      "",
      "Equivalent entry (inside node_sidecar):",
      "  node src/main.js ..."
    ].join("\n")
  );
}

function cmdAccounts(args) {
  const store = new AccountStore();
  const action = asString(args._positional[1] || "list").trim();
  if (action === "list") {
    const rows = store.list();
    // eslint-disable-next-line no-console
    console.log("Saved accounts:");
    for (const row of rows) {
      // eslint-disable-next-line no-console
      console.log(`- ${row.username}${row.is_active ? " [active]" : ""} (${row.remark})`);
    }
    return 0;
  }
  if (action === "use") {
    const account = asString(args.account).trim();
    if (!account) {
      throw new Error("--account required");
    }
    if (!store.setActive(account)) {
      throw new Error(`account not found: ${account}`);
    }
    // eslint-disable-next-line no-console
    console.log(`active account => ${account}`);
    return 0;
  }
  if (action === "delete") {
    const account = asString(args.account).trim();
    if (!account) {
      throw new Error("--account required");
    }
    if (!store.remove(account)) {
      throw new Error(`account not found: ${account}`);
    }
    // eslint-disable-next-line no-console
    console.log(`deleted account => ${account}`);
    return 0;
  }
  throw new Error(`unknown accounts action: ${action}`);
}

function cmdTokens(args) {
  const store = new TokenStore();
  const action = asString(args._positional[1] || "").trim();
  if (action === "clear") {
    const account = asString(args.account).trim();
    if (!account) {
      throw new Error("--account required");
    }
    store.remove(account);
    // eslint-disable-next-line no-console
    console.log(`token cleared => ${account}`);
    return 0;
  }
  throw new Error(`unknown tokens action: ${action}`);
}

async function cmdRefresh(args) {
  const logger = new DedupLogger({windowMs: 1000});
  const result = await refreshInventory({
    username: asString(args.account).trim(),
    password: asString(args.password).trim(),
    includeHidden: asString(args["include-hidden"] || "true") !== "false",
    dumpRaw: asString(args["dump-raw"] || "false") === "true",
    logger
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

async function cmdRedeemMissionReward(args) {
  const logger = new DedupLogger({windowMs: 1000});
  const normalized = normalizeRedeemMissionRewardOptions(args, {allowMissing: true});
  const result = await redeemMissionRewardDebug({
    ...normalized,
    logger
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

async function cmdGcCapture(args) {
  const logger = new DedupLogger({windowMs: 1000});
  const durationSeconds = Math.max(0, Number(args["duration-seconds"] || args.duration || 3) || 3);
  const result = await captureGcSession({
    accountName: asString(args.account).trim(),
    password: asString(args.password).trim(),
    durationMs: Math.round(durationSeconds * 1000),
    ackTracks: asString(args["ack-tracks"] || "true") !== "false",
    ackWaitMs: Math.max(0, Number(args["ack-wait-ms"] || 500) || 500),
    outputPath: asString(args.output).trim(),
    logger
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = asString(args._positional[0] || "refresh").trim();
  if (!cmd || cmd === "help" || cmd === "--help") {
    printHelp();
    return 0;
  }
  if (cmd === "accounts") {
    return cmdAccounts(args);
  }
  if (cmd === "tokens") {
    return cmdTokens(args);
  }
  if (cmd === "refresh") {
    return cmdRefresh(args);
  }
  if (cmd === "redeem-mission-reward" || cmd === "xpshop-redeem") {
    return cmdRedeemMissionReward(args);
  }
  if (cmd === "gc-capture") {
    return cmdGcCapture(args);
  }
  throw new Error(`unknown command: ${cmd}`);
}

main()
  .then((code) => process.exit(Number(code) || 0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
