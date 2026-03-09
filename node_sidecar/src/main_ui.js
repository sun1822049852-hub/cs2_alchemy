const readline = require("readline");
const {AccountStore} = require("./accountStore");
const {DedupLogger} = require("./logger");
const {refreshInventory} = require("./refreshWorkflow");
const {asString} = require("./utils");

function ask(question) {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(asString(answer).trim());
    });
  });
}

async function chooseAccount(store) {
  const rows = store.list();
  if (!rows.length) {
    // eslint-disable-next-line no-console
    console.log("No account found. Configure accounts.json first.");
    return null;
  }
  // eslint-disable-next-line no-console
  console.log("\nAccounts:");
  rows.forEach((row, idx) => {
    // eslint-disable-next-line no-console
    console.log(`${idx + 1}. ${row.username}${row.is_active ? " [active]" : ""}`);
  });
  const val = await ask("Select account index (Enter = active): ");
  if (!val) {
    const active = store.getActive();
    return active ? active.username : rows[0].username;
  }
  const idx = Number(val);
  if (!Number.isFinite(idx) || idx < 1 || idx > rows.length) {
    return null;
  }
  return rows[idx - 1].username;
}

async function runMenu() {
  const logger = new DedupLogger({windowMs: 1000});
  const store = new AccountStore();

  while (true) {
    const active = store.getActive();
    // eslint-disable-next-line no-console
    console.log("\n==============================");
    // eslint-disable-next-line no-console
    console.log(`Node UI | Active account: ${active ? active.username : "<none>"}`);
    // eslint-disable-next-line no-console
    console.log("1. Refresh inventory and write snapshot");
    // eslint-disable-next-line no-console
    console.log("2. Switch active account");
    // eslint-disable-next-line no-console
    console.log("0. Exit");
    // eslint-disable-next-line no-console
    console.log("==============================");

    const choice = await ask("Choose: ");
    if (choice === "0") {
      return;
    }
    if (choice === "2") {
      const username = await chooseAccount(store);
      if (!username) {
        // eslint-disable-next-line no-console
        console.log("Invalid selection");
        continue;
      }
      if (!store.setActive(username)) {
        // eslint-disable-next-line no-console
        console.log(`Switch failed: ${username}`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`active => ${username}`);
      }
      continue;
    }
    if (choice === "1") {
      const username = await chooseAccount(store);
      if (!username) {
        // eslint-disable-next-line no-console
        console.log("Invalid account");
        continue;
      }
      try {
        const result = await refreshInventory({
          username,
          includeHidden: true,
          dumpRaw: false,
          logger
        });
        // eslint-disable-next-line no-console
        console.log("\nRefresh done:");
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Refresh failed: ${err && err.message ? err.message : err}`);
      }
      continue;
    }
    // eslint-disable-next-line no-console
    console.log("Invalid option");
  }
}

runMenu().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`UI exited with error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
