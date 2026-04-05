const FEATURE_CODES = {
  ACCOUNTS_READ: "accounts.read",
  ACCOUNTS_WRITE: "accounts.write",
  INVENTORY_READ: "inventory.read",
  INVENTORY_REFRESH: "inventory.refresh",
  CRAFT_USE: "craft.use",
  SIMULATION_USE: "simulation.use"
};

const ALL_FEATURE_CODES = Object.freeze(Object.values(FEATURE_CODES));

module.exports = {
  FEATURE_CODES,
  ALL_FEATURE_CODES
};
