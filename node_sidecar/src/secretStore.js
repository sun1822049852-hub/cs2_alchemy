const {execSync} = require("node:child_process");

const DPAPI_PREFIX = "dpapi:";

function isDpapiAvailable() {
  return process.platform === "win32";
}

function isDpapiEncrypted(value) {
  return typeof value === "string" && value.startsWith(DPAPI_PREFIX);
}

function encryptSecret(plaintext) {
  if (!plaintext || typeof plaintext !== "string") {
    return "";
  }
  if (!isDpapiAvailable()) {
    return plaintext;
  }
  try {
    const b64Input = Buffer.from(plaintext, "utf8").toString("base64");
    const psScript = `
      Add-Type -AssemblyName System.Security
      $bytes = [Convert]::FromBase64String('${b64Input}')
      $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($encrypted)
    `.trim();
    const result = execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true
    });
    return DPAPI_PREFIX + result.trim();
  } catch (_) {
    return plaintext;
  }
}

function decryptSecret(ciphertext) {
  if (!ciphertext || typeof ciphertext !== "string") {
    return "";
  }
  if (!isDpapiEncrypted(ciphertext)) {
    return ciphertext;
  }
  if (!isDpapiAvailable()) {
    return ciphertext;
  }
  try {
    const b64Encrypted = ciphertext.slice(DPAPI_PREFIX.length);
    const psScript = `
      Add-Type -AssemblyName System.Security
      $encrypted = [Convert]::FromBase64String('${b64Encrypted}')
      $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
      [Convert]::ToBase64String($decrypted)
    `.trim();
    const result = execSync(`powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true
    });
    return Buffer.from(result.trim(), "base64").toString("utf8");
  } catch (_) {
    return "";
  }
}

module.exports = {
  isDpapiAvailable,
  isDpapiEncrypted,
  encryptSecret,
  decryptSecret
};
