const crypto = require("node:crypto");
const {stableJsonStringify} = require("../../shared/licensePolicy");

function createSignedLicenseBundle({privateKey, snapshot, refreshCredential = "", source = "manual"} = {}) {
  if (!privateKey) {
    throw new Error("privateKey is required");
  }
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("snapshot is required");
  }
  const signature = crypto.sign(null, Buffer.from(stableJsonStringify(snapshot)), privateKey).toString("base64");
  return {
    snapshot,
    signature,
    refresh_credential: String(refreshCredential || "").trim(),
    source: String(source || "").trim() || "manual"
  };
}

module.exports = {
  createSignedLicenseBundle
};
