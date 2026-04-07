const {PATHS} = require("./constants");
const {readJson} = require("./jsonStore");

class SchemaStore {
  constructor(filePath = PATHS.SCHEMA_CACHE_FILE) {
    this.filePath = filePath;
    this.schema = null;
  }

  load() {
    if (this.schema) {
      return this.schema;
    }
    const data = readJson(this.filePath, null);
    if (!data || typeof data !== "object") {
      throw new Error(`schema cache invalid: ${this.filePath}`);
    }
    this.schema = {
      weapons: data.weapons || {},
      paints: data.paints || {},
      item_defs: data.item_defs || {},
      item_defs_by_category: data.item_defs_by_category || {}
    };
    return this.schema;
  }
}

module.exports = {
  SchemaStore
};
