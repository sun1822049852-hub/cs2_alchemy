const {runVpkDevCommand} = require("./vpkDevTools");

const exitCode = runVpkDevCommand(process.argv.slice(2));
process.exit(Number(exitCode) || 0);
