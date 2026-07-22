const {normalizeSteamGuardImportMaFile} = require("./steamGuardTokenService");
const {asString} = require("./utils");

function baseProjection(entry, accountName = "") {
  return {
    client_id: asString(entry && entry.client_id).trim(),
    file_name: asString(entry && entry.file_name).trim(),
    account_name: asString(accountName).trim()
  };
}

function safeExistingProjection(entry, existing, isConnected, passwordComparison = null) {
  const accountName = asString(entry && entry.account_name).trim();
  const projection = {
    ...baseProjection(entry && entry.source, accountName),
    existing_remark: asString(existing && existing.remark).trim(),
    connected: !!isConnected(accountName)
  };
  if (passwordComparison && passwordComparison.provided) {
    projection.password_differs = passwordComparison.differs;
  }
  return projection;
}

function existingHasSteamGuard(existing) {
  return !!(existing && existing.has_steam_guard);
}

function targetAction(existing) {
  if (!existing) return "create";
  return existingHasSteamGuard(existing) ? "overwrite" : "attach";
}

function readSafeAccountName(content) {
  try {
    const raw = typeof content === "string" ? JSON.parse(content) : content;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
    return asString(raw.account_name).trim();
  } catch (_) {
    return "";
  }
}

function readSteamId64(content) {
  try {
    const raw = typeof content === "string" ? JSON.parse(content) : content;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
    return asString(raw.steamid || raw.steam_id64).trim();
  } catch (_) {
    return "";
  }
}

function prepareEntries(entries) {
  const prepared = (Array.isArray(entries) ? entries : []).map((entry) => {
    try {
      const normalized = normalizeSteamGuardImportMaFile(entry && entry.maFileContent);
      return {
        source: entry || {},
        account_name: normalized.accountName,
        mafile_content: normalized.maFileContent,
        steam_id64: readSteamId64(normalized.maFileContent)
      };
    } catch (_) {
      return {
        source: entry || {},
        invalid: true,
        account_name: readSafeAccountName(entry && entry.maFileContent),
        mafile_content: ""
      };
    }
  });
  const counts = new Map();
  for (const entry of prepared) {
    if (!entry.invalid && entry.account_name) {
      counts.set(entry.account_name, (counts.get(entry.account_name) || 0) + 1);
    }
  }
  for (const entry of prepared) {
    entry.group_size = !entry.invalid && entry.account_name ? (counts.get(entry.account_name) || 0) : 0;
  }
  return prepared;
}

function compareImportedPassword(accountStore, entry, existing) {
  const importedPassword = asString(entry && entry.source && entry.source.password).trim();
  if (!existing || !importedPassword) {
    return {provided: false, differs: false, importedPassword};
  }
  const credentials = typeof accountStore.getCredentials === "function"
    ? accountStore.getCredentials(entry.account_name)
    : null;
  return {
    provided: true,
    differs: importedPassword !== asString(credentials && credentials.password).trim(),
    importedPassword
  };
}

function summarizeResults(results) {
  const summary = {
    added: 0,
    attached: 0,
    overwritten: 0,
    pending_selection: 0,
    pending_confirmation: 0,
    skipped: 0,
    failed: 0
  };
  const pendingGroups = new Set();
  const pendingConfirmations = new Set();
  for (const result of results) {
    if (result.status === "added") summary.added += 1;
    else if (result.status === "attached") summary.attached += 1;
    else if (result.status === "overwritten") summary.overwritten += 1;
    else if (result.status === "selection_required") pendingGroups.add(result.selection_group);
    else if (["duplicate_confirmation_required", "password_confirmation_required"].includes(result.status)) {
      pendingConfirmations.add(result.account_name);
    }
    else summary.failed += 1;
  }
  summary.pending_selection = pendingGroups.size;
  summary.pending_confirmation = pendingConfirmations.size;
  return summary;
}

function createSteamGuardImportService({accountStore, isConnected = () => false} = {}) {
  if (!accountStore) throw new Error("accountStore is required");

  function preflight(entries) {
    const items = prepareEntries(entries).map((entry) => {
      if (entry.invalid) {
        return {
          ...baseProjection(entry.source, entry.account_name),
          status: "invalid",
          reason: "invalid_mafile_format",
          message: "令牌文件格式错误"
        };
      }
      const existing = accountStore.get(entry.account_name);
      const action = targetAction(existing);
      const passwordComparison = compareImportedPassword(accountStore, entry, existing);
      if (entry.group_size > 1) {
        return {
          ...(existing
            ? safeExistingProjection(entry, existing, isConnected, passwordComparison)
            : baseProjection(entry.source, entry.account_name)),
          status: "selection_required",
          selection_group: entry.account_name,
          group_size: entry.group_size,
          target_action: action,
          existing_has_steam_guard: existingHasSteamGuard(existing)
        };
      }
      if (existingHasSteamGuard(existing)) {
        return {
          ...safeExistingProjection(entry, existing, isConnected, passwordComparison),
          status: "duplicate_existing",
          target_action: action,
          existing_has_steam_guard: true
        };
      }
      if (existing) {
        return {
          ...safeExistingProjection(entry, existing, isConnected, passwordComparison),
          status: passwordComparison.differs ? "password_confirmation_required" : "ready",
          target_action: action,
          existing_has_steam_guard: false
        };
      }
      return {...baseProjection(entry.source, entry.account_name), status: "ready", target_action: action};
    });
    return {
      items,
      counts: {
        ready: items.filter((item) => item.status === "ready").length,
        duplicate_existing: items.filter((item) => item.status === "duplicate_existing").length,
        selection_required: new Set(items
          .filter((item) => item.status === "selection_required")
          .map((item) => item.selection_group)).size,
        invalid: items.filter((item) => item.status === "invalid").length
      }
    };
  }

  function accountStateChanged(entry) {
    return {
      ...baseProjection(entry.source, entry.account_name),
      username: entry.account_name,
      ok: false,
      status: "failed",
      reason: "account_state_changed",
      message: "账号状态已变化，请刷新后重试"
    };
  }

  function duplicateConfirmation(entry, existing, passwordComparison = null) {
    if (!existing || !existingHasSteamGuard(existing)) {
      return accountStateChanged(entry);
    }
    return {
      ...safeExistingProjection(entry, existing, isConnected, passwordComparison),
      username: entry.account_name,
      ok: false,
      status: "duplicate_confirmation_required",
      reason: "duplicate_existing",
      message: "该账号已保存本地令牌，请确认是否覆盖令牌文件",
      existing_has_steam_guard: true,
      target_action: "overwrite"
    };
  }

  function passwordConfirmation(entry, existing, passwordComparison) {
    return {
      ...safeExistingProjection(entry, existing, isConnected, passwordComparison),
      username: entry.account_name,
      ok: false,
      status: "password_confirmation_required",
      reason: "password_confirmation_required",
      message: "导入密码与本地密码不同，请选择覆盖或丢弃导入密码",
      existing_has_steam_guard: existingHasSteamGuard(existing),
      target_action: targetAction(existing)
    };
  }

  function attach(entry, password, passwordAction) {
    const base = {...baseProjection(entry.source, entry.account_name), username: entry.account_name};
    try {
      accountStore.attachSteamGuardImport(entry.account_name, {
        password,
        password_action: passwordAction,
        mafile_content: entry.mafile_content,
        steam_id64: entry.steam_id64
      });
      return {...base, ok: true, status: "attached", message: "已为现有账号添加本地令牌"};
    } catch (err) {
      if (err && err.code === "duplicate_existing") {
        const raced = accountStore.get(entry.account_name);
        return duplicateConfirmation(entry, raced, compareImportedPassword(accountStore, entry, raced));
      }
      if (err && err.code === "account_not_found") {
        return accountStateChanged(entry);
      }
      return {...base, ok: false, status: "failed", reason: "persistence_failed", message: "账号保存失败"};
    }
  }

  function execute(entries) {
    const prepared = prepareEntries(entries);
    const results = prepared.map((entry) => {
      const base = {...baseProjection(entry.source, entry.account_name), username: entry.account_name};
      if (entry.invalid) {
        return {...base, ok: false, status: "invalid", reason: "invalid_mafile_format", message: "令牌文件格式错误"};
      }
      const existing = accountStore.get(entry.account_name);
      const action = targetAction(existing);
      const passwordComparison = compareImportedPassword(accountStore, entry, existing);
      if (entry.group_size > 1) {
        return {
          ...(existing
            ? safeExistingProjection(entry, existing, isConnected, passwordComparison)
            : baseProjection(entry.source, entry.account_name)),
          username: entry.account_name,
          ok: false,
          status: "selection_required",
          reason: "selection_required",
          message: "同一账号有多个令牌文件，请选择一个",
          selection_group: entry.account_name,
          group_size: entry.group_size,
          target_action: action,
          existing_has_steam_guard: existingHasSteamGuard(existing)
        };
      }
      const password = asString(entry.source && entry.source.password).trim();
      const passwordAction = asString(entry.source && entry.source.password_action).trim().toLowerCase();
      if (passwordComparison.differs && !["overwrite", "discard"].includes(passwordAction)) {
        return passwordConfirmation(entry, existing, passwordComparison);
      }
      if (passwordAction === "overwrite" && !password) {
        return {...base, ok: false, status: "failed", reason: "password_required", message: "覆盖密码时密码不能为空"};
      }
      if (entry.source && entry.source.overwrite === true) {
        if (!existing) {
          return {...base, ok: false, status: "failed", reason: "overwrite_target_missing", message: "待覆盖账号不存在"};
        }
        if (!existingHasSteamGuard(existing)) {
          return attach(entry, password, passwordAction);
        }
        try {
          accountStore.overwriteSteamGuardImport(entry.account_name, {
            password,
            password_action: passwordAction,
            mafile_content: entry.mafile_content,
            steam_id64: entry.steam_id64
          });
          return {...base, ok: true, status: "overwritten", message: "已覆盖本地令牌"};
        } catch (_) {
          return {...base, ok: false, status: "failed", reason: "persistence_failed", message: "账号保存失败"};
        }
      }
      if (existingHasSteamGuard(existing)) {
        return duplicateConfirmation(entry, existing, passwordComparison);
      }
      if (existing) {
        return attach(entry, password, passwordAction);
      }
      try {
        accountStore.createGuardOnlyAccount({
          username: entry.account_name,
          password,
          mafile_content: entry.mafile_content,
          steam_id64: entry.steam_id64,
          set_active: false
        });
        return {...base, ok: true, status: "added", message: "账号与本地令牌已保存"};
      } catch (err) {
        if (err && err.code === "duplicate_existing") {
          const raced = accountStore.get(entry.account_name);
          if (raced && !existingHasSteamGuard(raced)) {
            const racedComparison = compareImportedPassword(accountStore, entry, raced);
            if (racedComparison.differs && !["overwrite", "discard"].includes(passwordAction)) {
              return passwordConfirmation(entry, raced, racedComparison);
            }
            return attach(entry, password, passwordAction);
          }
          return raced
            ? duplicateConfirmation(entry, raced, compareImportedPassword(accountStore, entry, raced))
            : accountStateChanged(entry);
        }
        return {...base, ok: false, status: "failed", reason: "persistence_failed", message: "账号保存失败"};
      }
    });
    return {results, summary: summarizeResults(results)};
  }

  return {execute, preflight};
}

module.exports = {
  createSteamGuardImportService
};
