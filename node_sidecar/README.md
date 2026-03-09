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
node main_node.js refresh --account <username>
```

From `node_sidecar`:

```powershell
npm run refresh -- --account <username>
```

## Web UI

```powershell
node main_ui_node.js
```

Open `http://127.0.0.1:8787`.

Optional CLI menu:

```powershell
npm run ui:cli
```

## Commands

```powershell
node main_node.js accounts list
node main_node.js accounts use --account <username>
node main_node.js accounts delete --account <username>
node main_node.js tokens clear --account <username>
```
