// Soft-offline entry: keep backward compatibility, but guide users to the new path.
// eslint-disable-next-line no-console
console.warn(
  "[deprecated] main_node.js 已软下线，请改用桌面入口 main_ui_node_desktop.js；" +
    "如需命令行请使用 node node_sidecar/src/main.js"
);
require("./node_sidecar/src/main.js");
