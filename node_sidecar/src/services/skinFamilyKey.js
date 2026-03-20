const WEAR_SUFFIXES = [
  "Factory New",
  "Minimal Wear",
  "Field-Tested",
  "Well-Worn",
  "Battle-Scarred"
];

function asText(value) {
  return String(value == null ? "" : value).trim();
}

function stripWearSuffix(text, suffixes = WEAR_SUFFIXES) {
  const raw = asText(text);
  for (const suffix of Array.isArray(suffixes) ? suffixes : []) {
    const token = ` (${suffix})`;
    if (raw.endsWith(token)) {
      return raw.slice(0, -token.length).trim();
    }
  }
  return raw;
}

function buildSkinFamilyKey(text) {
  let out = stripWearSuffix(text);
  let changed = true;
  while (changed) {
    changed = false;
    const next = asText(out)
      .replace(/^\u2605\s+/, "")
      .replace(/^(Souvenir|StatTrak(?:\u2122)?|Genuine)\s+/i, "")
      .trim();
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return asText(out);
}

module.exports = {
  buildSkinFamilyKey
};
