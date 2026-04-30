const {nowString} = require("./utils");

class DedupLogger {
  constructor({windowMs = 1200} = {}) {
    this.windowMs = Math.max(0, Number(windowMs) || 0);
    this.last = new Map();
  }

  _key(level, scope, text) {
    return `${level}|${scope}|${text}`;
  }

  _allow(level, scope, text) {
    if (this.windowMs <= 0) {
      return true;
    }
    const key = this._key(level, scope, text);
    const now = Date.now();
    const prev = this.last.get(key) || 0;
    if (now - prev <= this.windowMs) {
      return false;
    }
    this.last.set(key, now);
    return true;
  }

  _write(level, scope, text) {
    const line = `${nowString()} ${scope} ${level} ${text}`;
    if (level === "ERROR" || level === "WARN") {
      // eslint-disable-next-line no-console
      console.error(line);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(line);
  }

  info(scope, text) {
    if (this._allow("INFO", scope, text)) {
      this._write("INFO", scope, text);
    }
  }

  // Force log without deduplication
  infoAlways(scope, text) {
    this._write("INFO", scope, text);
  }

  warn(scope, text) {
    if (this._allow("WARN", scope, text)) {
      this._write("WARN", scope, text);
    }
  }

  // Force log without deduplication
  warnAlways(scope, text) {
    this._write("WARN", scope, text);
  }

  error(scope, text) {
    if (this._allow("ERROR", scope, text)) {
      this._write("ERROR", scope, text);
    }
  }

  debug(scope, text) {
    if (process.env.DEBUG !== "1") {
      return;
    }
    if (this._allow("DEBUG", scope, text)) {
      this._write("DEBUG", scope, text);
    }
  }
}

module.exports = {
  DedupLogger
};
