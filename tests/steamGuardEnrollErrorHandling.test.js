const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../node_sidecar/ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      for (const name of names) set.add(name);
    },
    remove(...names) {
      for (const name of names) set.delete(name);
    },
    toggle(name, force) {
      if (force === true) {
        set.add(name);
        return true;
      }
      if (force === false) {
        set.delete(name);
        return false;
      }
      if (set.has(name)) {
        set.delete(name);
        return false;
      }
      set.add(name);
      return true;
    },
    contains(name) {
      return set.has(name);
    }
  };
}

function createElement({value = "", classes = []} = {}) {
  return {
    value,
    textContent: "",
    disabled: false,
    className: "",
    classList: createClassList(classes)
  };
}

function createHarness(apiImpl) {
  const source = extractBlock("let enrollState =", "// ═══ Steam Guard 令牌详情 ═══");
  const elements = {
    enrollStatusText: createElement(),
    enrollActionBtn: createElement(),
    enrollAccountSelect: createElement({value: "demo"}),
    enrollRevocationWrap: createElement(),
    enrollRevocationCode: createElement(),
    enrollSmsInput: createElement(),
    enrollFinalRevCode: createElement(),
    enrollFinalModeText: createElement(),
    enrollStep1: createElement(),
    enrollStep2: createElement({classes: ["hidden"]}),
    enrollStep3: createElement({classes: ["hidden"]}),
    enrollBackBtn: createElement({classes: ["hidden"]}),
    steamGuardEnrollModal: createElement({classes: ["hidden"]})
  };
  const document = {
    getElementById(id) {
      const el = elements[id];
      if (!el) {
        throw new Error(`missing element: ${id}`);
      }
      return el;
    }
  };
  const context = {
    Promise,
    String,
    Number,
    Boolean,
    document,
    api: apiImpl,
    loadAccounts: async () => {}
  };
  vm.runInNewContext(
    `${source}\nthis.handleEnrollAction = handleEnrollAction;\nthis.enrollState = enrollState;`,
    context,
    {filename: APP_PATH}
  );
  return {
    context,
    elements
  };
}

async function test_step1_uses_error_data_reason_instead_of_generic_http_200() {
  const app = createHarness(async () => {
    const err = new Error("http 200");
    err.status = 200;
    err.data = {ok: false, reason: "no_phone_number", status: 2};
    throw err;
  });

  await app.context.handleEnrollAction();

  assert.equal(
    app.elements.enrollStatusText.textContent,
    "该账号未绑定手机号，请先在 Steam 客户端绑定手机"
  );
  assert.equal(app.elements.enrollStatusText.className, "enroll-status error");
  assert.equal(app.elements.enrollActionBtn.disabled, false);
}

async function test_step2_uses_error_data_message_instead_of_generic_http_200() {
  const app = createHarness(async () => {
    const err = new Error("http 200");
    err.status = 200;
    err.data = {ok: false, message: "验证码错误"};
    throw err;
  });
  app.context.enrollState.step = 2;
  app.context.enrollState.username = "demo";
  app.elements.enrollSmsInput.value = "123456";

  await app.context.handleEnrollAction();

  assert.equal(app.elements.enrollStatusText.textContent, "验证码错误");
  assert.equal(app.elements.enrollStatusText.className, "enroll-status error");
  assert.equal(app.elements.enrollActionBtn.disabled, false);
}

async function main() {
  await test_step1_uses_error_data_reason_instead_of_generic_http_200();
  await test_step2_uses_error_data_message_instead_of_generic_http_200();
  console.log("steamGuardEnrollErrorHandling tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
