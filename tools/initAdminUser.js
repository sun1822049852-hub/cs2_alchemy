const {AppAuthStore} = require("../node_sidecar/src/appAuthStore");

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? [...argv] : [];
  const options = {
    password: "",
    displayName: "管理员"
  };
  for (let i = 0; i < args.length; i += 1) {
    const item = String(args[i] || "").trim();
    if (item === "--password" && args[i + 1]) {
      options.password = String(args[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (item === "--display-name" && args[i + 1]) {
      options.displayName = String(args[i + 1] || "").trim() || "管理员";
      i += 1;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.password) {
    console.error("缺少 --password 参数");
    process.exit(1);
  }

  const store = new AppAuthStore();
  try {
    if (!store.needsBootstrap()) {
      console.log("admin 已初始化，跳过创建");
      return;
    }
    const result = store.bootstrapAdmin({
      password: options.password,
      displayName: options.displayName
    });
    console.log(`admin 初始化完成: ${result.user.username}`);
  } finally {
    store.close();
  }
}

main();
