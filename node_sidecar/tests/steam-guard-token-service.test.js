const assert = require("node:assert/strict");

const {
  getSteamGuardCapabilities,
  normalizeSteamGuardImportMaFile,
  normalizeMaFileForExport,
  readSteamGuardSummary
} = require("../src/steamGuardTokenService");

function makeMaFile() {
  return {
    shared_secret: Buffer.from("shared").toString("base64"),
    identity_secret: Buffer.from("identity").toString("base64"),
    secret_1: Buffer.from("secret-1").toString("base64"),
    serial_number: "123456789",
    revocation_code: "R12345",
    account_name: "demo",
    device_id: "android:12345678-1234-4123-8123-123456789abc",
    steamid: "76561198000000001",
    access_token: "access_secret",
    refresh_token: "refresh_secret",
    Session: {
      SteamID: "76561198000000001",
      SteamLoginSecure: "steamLoginSecure=76561198000000001%7C%7Crefresh_secret",
      WebCookie: "secret_cookie"
    }
  };
}

function makeLoginOnlyMaFile() {
  return {
    account_name: "demo",
    shared_secret: Buffer.from("shared").toString("base64"),
    Session: {SteamID: "76561198000000001"}
  };
}

function test_export_strips_all_login_session_material() {
  const normalized = normalizeMaFileForExport(makeMaFile());
  assert.equal(normalized.Session, null);
  assert.equal(Object.hasOwn(normalized, "access_token"), false);
  assert.equal(Object.hasOwn(normalized, "refresh_token"), false);
  assert.equal(JSON.stringify(normalized).includes("refresh_secret"), false);
  assert.equal(normalized.shared_secret, makeMaFile().shared_secret);
  assert.equal(normalized.revocation_code, "R12345");
}

function test_summary_never_contains_guard_secrets() {
  const summary = readSteamGuardSummary(makeMaFile(), {nowSeconds: 90});
  assert.equal(summary.accountName, "demo");
  assert.equal(summary.steamId64, "76561198000000001");
  assert.equal(summary.revocationCode, "R12345");
  assert.equal(typeof summary.currentTotp, "string");
  assert.equal(summary.currentTotp.length, 5);
  assert.equal(summary.period, 30);
  assert.equal(summary.remainingSeconds, 30);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(makeMaFile().shared_secret), false);
  assert.equal(serialized.includes(makeMaFile().identity_secret), false);
}

function test_import_normalization_accepts_login_only_mafile_with_generation_fields() {
  const source = makeLoginOnlyMaFile();
  const result = normalizeSteamGuardImportMaFile(source);
  const normalized = JSON.parse(result.maFileContent);

  assert.equal(result.accountName, "demo");
  assert.equal(result.steamGuardType, "login_only");
  assert.deepEqual(result.capabilities, {
    login_code: true,
    confirmation: false,
    recovery_code: false,
    web_session: false
  });
  assert.equal(normalized.account_name, "demo");
  assert.equal(normalized.shared_secret, source.shared_secret);
  assert.deepEqual(normalized.Session, {SteamID: "76561198000000001"});
}

function test_import_normalization_preserves_full_mafile_private_material() {
  const source = makeMaFile();
  delete source.steamid;
  source.fully_enrolled = false;
  source.status = 0;

  const result = normalizeSteamGuardImportMaFile(source);
  const normalized = JSON.parse(result.maFileContent);

  assert.equal(result.accountName, "demo");
  assert.equal(result.steamGuardType, "full");
  assert.deepEqual(result.capabilities, {
    login_code: true,
    confirmation: true,
    recovery_code: true,
    web_session: true
  });
  assert.equal(normalized.account_name, "demo");
  assert.equal(normalized.revocation_code, "R12345");
  assert.equal(normalized.shared_secret, source.shared_secret);
  assert.equal(normalized.Session.WebCookie, "secret_cookie");
  assert.equal(normalized.access_token, "access_secret");
  assert.equal(normalized.refresh_token, "refresh_secret");
  assert.equal(normalized.fully_enrolled, false);
  assert.equal(normalized.status, 0);
}

function test_import_validation_rejects_missing_required_guard_fields_with_generic_error() {
  const cases = [
    {...makeMaFile(), account_name: ""},
    {...makeMaFile(), shared_secret: ""}
  ];

  for (const value of cases) {
    assert.throws(
      () => normalizeSteamGuardImportMaFile(value),
      (err) => err && err.code === "invalid_mafile_format" && err.message === "令牌文件格式错误"
    );
  }
  assert.throws(
    () => normalizeSteamGuardImportMaFile("not-json"),
    (err) => err && err.code === "invalid_mafile_format" && err.message === "令牌文件格式错误"
  );
}

function test_capabilities_are_derived_only_from_available_secret_fields() {
  assert.deepEqual(getSteamGuardCapabilities(makeLoginOnlyMaFile()), {
    type: "login_only",
    login_code: true,
    confirmation: false,
    recovery_code: false,
    web_session: false
  });
  assert.deepEqual(getSteamGuardCapabilities(makeMaFile()), {
    type: "full",
    login_code: true,
    confirmation: true,
    recovery_code: true,
    web_session: true
  });
}

function test_login_only_classification_cannot_be_upgraded_by_other_private_fields() {
  const source = {
    ...makeLoginOnlyMaFile(),
    revocation_code: "R12345",
    refresh_token: "must-be-stripped",
    Session: {
      SteamID: "76561198000000001",
      AccessToken: "must-be-stripped",
      RefreshToken: "must-be-stripped"
    }
  };
  const result = normalizeSteamGuardImportMaFile(source);
  const normalized = JSON.parse(result.maFileContent);
  assert.equal(result.steamGuardType, "login_only");
  assert.deepEqual(result.capabilities, {
    login_code: true,
    confirmation: false,
    recovery_code: false,
    web_session: false
  });
  assert.deepEqual(Object.keys(normalized).sort(), ["Session", "account_name", "shared_secret"]);
  assert.deepEqual(normalized.Session, {SteamID: "76561198000000001"});
  assert.equal(JSON.stringify(normalized).includes("must-be-stripped"), false);
}

function main() {
  test_export_strips_all_login_session_material();
  test_summary_never_contains_guard_secrets();
  test_import_normalization_accepts_login_only_mafile_with_generation_fields();
  test_import_normalization_preserves_full_mafile_private_material();
  test_import_validation_rejects_missing_required_guard_fields_with_generic_error();
  test_capabilities_are_derived_only_from_available_secret_fields();
  test_login_only_classification_cannot_be_upgraded_by_other_private_fields();
  console.log("steam-guard-token-service tests passed");
}

main();
