const {nowString} = require("./utils");
const {DevFileLogSink} = require("./devFileLog");

const defaultFileSink = new DevFileLogSink({
  onError(error) {
    const code = error && error.code ? String(error.code) : "unknown";
    // eslint-disable-next-line no-console
    console.error(`${nowString()} dev_file_log WARN file logging unavailable: code=${code}`);
  }
});

class DedupLogger {
  constructor({windowMs = 1200, fileSink = defaultFileSink} = {}) {
    this.windowMs = Math.max(0, Number(windowMs) || 0);
    this.last = new Map();
    this.fileSink = fileSink;
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
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    if (!this.fileSink || typeof this.fileSink.write !== "function") {
      return;
    }
    try {
      this.fileSink.write({level, scope, message: text});
    } catch (_) {
      // File diagnostics must never change application control flow.
    }
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
