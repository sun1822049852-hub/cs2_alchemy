function pad2(v) {
  return String(v).padStart(2, "0");
}

function nowString() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

function nowStamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  const ms = Math.max(1, Number(timeoutMs) || 1);
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage || `timeout(${ms}ms)`)), ms);
    })
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function toInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.trunc(n);
}

function toFloat(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return n;
}

function asString(v) {
  if (v === null || v === undefined) {
    return "";
  }
  return String(v);
}

module.exports = {
  nowString,
  nowStamp,
  sleep,
  withTimeout,
  toInt,
  toFloat,
  asString
};
