# Node Rewrite Entry

This folder contains a Node implementation that does not depend on Python Steam libraries.

Implemented flow:
- account load (`accounts.json`)
- refresh token reuse (`login_keys.json`)
- Steam + CS2 GC connect
- inventory + storage unit preload
- processed snapshot export (`logs/processed_inventory/*.json`)

## Quick Start

From project root:

```powershell
node node_sidecar/src/main.js refresh --account <username>
```

From `node_sidecar`:

```powershell
npm run refresh -- --account <username>
```

## Web UI

```powershell
node main_ui_node_desktop.js
```

Desktop 版本会直接打开窗口。  
如需浏览器模式可运行：

```powershell
node src/uiServer.js
```

然后打开 `http://127.0.0.1:8787`。

Optional CLI menu:

```powershell
npm run ui:cli
```

## Commands

```powershell
node node_sidecar/src/main.js accounts list
node node_sidecar/src/main.js accounts use --account <username>
node node_sidecar/src/main.js accounts delete --account <username>
node node_sidecar/src/main.js tokens clear --account <username>
```
