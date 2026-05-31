const {spawnSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_EXCLUDES = new Set([
  "client-auth-modal-guest-interaction.test.js",
  "tradeup-simulation-picker-interaction.test.js"
]);

function parseArgs(argv) {
  const options = {
    includeBrowser: false,
    list: false
  };
  for (const arg of argv) {
    if (arg === "--include-browser") {
      options.includeBrowser = true;
    } else if (arg === "--list") {
      options.list = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function listTestFiles({testsDir = path.resolve(__dirname, "..", "tests"), includeBrowser = false} = {}) {
  const files = fs.readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();
  return includeBrowser ? files : files.filter((name) => !DEFAULT_EXCLUDES.has(name));
}

function runTestFile(filePath) {
  return spawnSync(process.execPath, [filePath], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const testsDir = path.resolve(__dirname, "..", "tests");
    const files = listTestFiles({testsDir, includeBrowser: options.includeBrowser});
    if (options.list) {
      for (const file of files) {
        console.log(file);
      }
      return;
    }

    const startedAt = Date.now();
    for (const file of files) {
      const relativePath = path.join("tests", file);
      console.log(`RUN ${relativePath}`);
      const result = runTestFile(path.join(testsDir, file));
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
      if (result.status !== 0) {
        console.error(`FAIL ${relativePath}`);
        process.exit(result.status || 1);
      }
    }
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`PASS ${files.length} node_sidecar tests in ${elapsedSec}s`);
    if (!options.includeBrowser) {
      console.log("Excluded browser interaction tests by default. Run `npm run test:browser` for those.");
    }
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listTestFiles
};
