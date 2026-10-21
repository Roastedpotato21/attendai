import assert from "node:assert/strict";
import { test } from "node:test";
import { completePeriodMarks, periodCounts, periodStatuses } from "../src/lib/period-attendance.ts";
const roster = [
  { student_id: "one", name_snapshot: "One", approved_leave: false, mark: null },
  { student_id: "two", name_snapshot: "Two", approved_leave: true, mark: null },
];
test("roster submission never treats a missing mark as absent", () => {
  assert.throws(() => completePeriodMarks(roster, {}), /never assumed absent/);
  assert.throws(() => completePeriodMarks(roster, { one: "late" }), /Choose Present or Absent/);
});
test("recorded approved leave overrides a stale client selection", () => {
  assert.deepEqual(completePeriodMarks(roster, { one: "present", two: "absent" }), [
    { student_id: "one", status: "present" },
    { student_id: "two", status: "approved_leave" },
  ]);
});
test("complete roster values preserve exact session student identities", () => {
  assert.deepEqual(completePeriodMarks(roster, { one: "absent", forged: "present" }), [
    { student_id: "one", status: "absent" },
    { student_id: "two", status: "approved_leave" },
  ]);
});
test("raw counts keep approved leave and unmarked separate without calculating a percentage", () => {
  assert.deepEqual(
    periodCounts([
      { mark: "present" },
      { mark: "absent" },
      { mark: "approved_leave" },
      { mark: null },
    ]),
    { present: 1, absent: 1, approvedLeave: 1, unmarked: 1 },
  );
  assert.deepEqual(periodStatuses, ["present", "absent", "approved_leave"]);
});
