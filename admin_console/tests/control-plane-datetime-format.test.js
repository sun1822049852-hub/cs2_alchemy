const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.resolve(__dirname, "../ui/app.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

function extractBlock(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  const end = APP_SOURCE.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

function loadDateTimeFns() {
  const source = [
    'const DEFAULT_EXPIRY_TIME = "23:59";',
    extractBlock("function toLocalDateTimeInput(", "function toIsoDateTime("),
    extractBlock("function toIsoDateTime(", "function formatLocalDateTimeText("),
    extractBlock("function formatLocalDateTimeText(", "function splitLocalDateTimeParts("),
    extractBlock("function splitLocalDateTimeParts(", "function syncPermissionsFromPlan(")
  ].join("\n");
  const context = {
    Date,
    Number,
    String
  };
  vm.runInNewContext(source, context, {filename: APP_PATH});
  return context;
}

function test_local_datetime_input_round_trips_via_iso_storage() {
  const {toIsoDateTime, toLocalDateTimeInput} = loadDateTimeFns();
  const storedIso = toIsoDateTime("2026-04-20T00:00");
  assert.equal(storedIso, "2026-04-19T16:00:00.000Z");
  assert.equal(toLocalDateTimeInput(storedIso), "2026-04-20T00:00");
}

function test_display_formatter_shows_local_time_instead_of_raw_utc() {
  const {formatLocalDateTimeText} = loadDateTimeFns();
  assert.equal(formatLocalDateTimeText("2026-04-19T16:00:00.000Z"), "2026-04-20 00:00");
  assert.equal(formatLocalDateTimeText(""), "未设置");
}

function test_split_local_datetime_parts_supports_cross_browser_date_and_time_inputs() {
  const {splitLocalDateTimeParts} = loadDateTimeFns();
  assert.deepEqual(
    JSON.parse(JSON.stringify(splitLocalDateTimeParts("2026-04-19T16:00:00.000Z"))),
    {
      dateValue: "2026-04-20",
      timeValue: "00:00"
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(splitLocalDateTimeParts(""))),
    {
      dateValue: "",
      timeValue: "23:59"
    }
  );
}

function test_date_and_time_parts_round_trip_via_iso_storage() {
  const {toIsoDateTimeFromParts} = loadDateTimeFns();
  assert.equal(
    toIsoDateTimeFromParts("2026-04-20", "00:00"),
    "2026-04-19T16:00:00.000Z"
  );
  assert.equal(
    toIsoDateTimeFromParts("2026-04-20", ""),
    "2026-04-20T15:59:00.000Z"
  );
  assert.equal(toIsoDateTimeFromParts("", "23:59"), "");
}

function main() {
  test_local_datetime_input_round_trips_via_iso_storage();
  test_display_formatter_shows_local_time_instead_of_raw_utc();
  test_split_local_datetime_parts_supports_cross_browser_date_and_time_inputs();
  test_date_and_time_parts_round_trip_via_iso_storage();
  console.log("control-plane-datetime-format tests passed");
}

main();
