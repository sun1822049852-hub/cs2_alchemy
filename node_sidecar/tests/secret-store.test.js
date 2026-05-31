const assert = require("node:assert/strict");

const {
  decryptSecret,
  encryptSecret,
  isDpapiEncrypted
} = require("../src/secretStore");

function test_encrypt_secret_never_writes_empty_dpapi_payload() {
  const plaintext = "refresh_token_1";
  const encrypted = encryptSecret(plaintext);
  assert.notEqual(encrypted, "dpapi:");
  if (isDpapiEncrypted(encrypted)) {
    assert.ok(encrypted.length > "dpapi:".length);
    assert.equal(decryptSecret(encrypted), plaintext);
    return;
  }
  assert.equal(encrypted, plaintext);
}

function main() {
  test_encrypt_secret_never_writes_empty_dpapi_payload();
  console.log("secret-store tests passed");
}

main();
