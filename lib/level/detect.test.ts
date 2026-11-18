import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCode,
  detectLevel,
  detectSemester,
  detectPrefix,
  detectProfile,
} from "./detect.ts";
import { majorityPackage, missingFromPackage, packageNote } from "./package.ts";

const c = (id: number, fullname: string) => ({ id, fullname });

// The real 200-level Computer Engineering second-semester list (lib/presets.ts).
const CE_200 = [
  c(1, "COS 202 - Computer Programming II"),
  c(2, "DTS 204 - Statistical Computing Inference and Modelling"),
  c(3, "GST 212 - Philosophy, Logic and Human Existence"),
  c(4, "IFT 212 - Computer Architecture and Organisation"),
  c(5, "MIVA-MTH 204 - Linear Algebra II"),
  c(6, "MTH 202 - Elementary Differential Equations"),
  c(7, "PHY 202 - Introduction to Electric Circuits and Electronics"),
];

test("parseCode reads prefixed and plain codes", () => {
  assert.deepEqual(parseCode("MIVA-MTH 204 - Linear Algebra II"), {
    prefix: "MTH",
    number: 204,
    level: 200,
    semester: "second",
    code: "MTH 204",
  });
  assert.equal(parseCode("GST 212 - Philosophy")?.code, "GST 212");
  assert.equal(parseCode("COS101 Intro")?.semester, "first");
  assert.equal(parseCode("Physics101")?.code, undefined); // no mid-word prefix
  assert.equal(parseCode("Student Orientation 2026"), null);
  assert.equal(parseCode("Welcome Hub"), null);
});

test("empty list detects nothing", () => {
  const d = detectProfile([]);
  assert.equal(d.level, null);
  assert.equal(d.semester, null);
  assert.equal(d.departmentPrefix, null);
  assert.equal(d.department, null);
  assert.deepEqual(d.selectedIds, []);
  assert.equal(d.levelSource, "none");
});

test("courses with no codes detect nothing", () => {
  const d = detectProfile([c(1, "Orientation"), c(2, "Library Skills")]);
  assert.equal(d.level, null);
  assert.deepEqual(d.selectedIds, []);
});

test("a single carry-over course does not decide the level", () => {
  const d = detectProfile([...CE_200, c(8, "COS 101 - Introduction to Computing")]);
  assert.equal(d.level, 200);
  assert.ok(!d.selectedIds.includes(8));
  assert.equal(d.selectedIds.length, 7);
});

test("one course taken ahead does not raise the level", () => {
  assert.equal(
    detectLevel(
      [ "COS 202", "MTH 202", "IFT 212", "COS 302" ].map((t) => parseCode(t)!),
    ),
    200,
  );
});

test("mixed levels: highest level shared by two courses wins", () => {
  const titles = ["COS 101", "MTH 101", "COS 201", "IFT 211", "GST 111", "SEN 301"];
  assert.equal(detectLevel(titles.map((t) => parseCode(t)!)), 200);
  const d = detectProfile(titles.map((t, i) => c(i + 1, t)));
  assert.equal(d.level, 200);
  assert.deepEqual(d.selectedIds, [3, 4]);
});

test("every course at a different level is undecided; a lone course decides", () => {
  assert.equal(detectLevel(["COS 101", "COS 201", "COS 301"].map((t) => parseCode(t)!)), null);
  assert.equal(detectLevel([parseCode("ACC 301")!]), 300);
});

test("semester is the odd/even majority; a tie is undecided", () => {
  assert.equal(detectSemester(["COS 201", "MTH 203", "GST 212"].map((t) => parseCode(t)!)), "first");
  assert.equal(detectSemester(["COS 201", "GST 212"].map((t) => parseCode(t)!)), null);
  assert.equal(detectProfile(CE_200).semester, "second");
});

test("general-studies prefixes never decide the department", () => {
  const p = ["GST 212", "GST 214", "ENT 212", "ACC 202"].map((t) => parseCode(t)!);
  assert.equal(detectPrefix(p), "ACC");
  assert.equal(detectPrefix(["GST 212", "ENT 202"].map((t) => parseCode(t)!)), null);
});

test("service-science prefixes lose to a department prefix", () => {
  // MTH appears twice in the CE list but COS/DTS/IFT are the department.
  const d = detectProfile(CE_200);
  assert.equal(d.departmentPrefix, "COS");
  assert.equal(d.department, "computer-science");
  assert.equal(d.departmentSource, "courses");
  // ...but decide when nothing else is present.
  assert.equal(detectPrefix(["MTH 101", "MTH 103", "GST 111"].map((t) => parseCode(t)!)), "MTH");
});

test("an override (SIS) beats the course-code guess field by field", () => {
  const d = detectProfile(CE_200, { department: "computer-engineering", level: 300 });
  assert.equal(d.department, "computer-engineering");
  assert.equal(d.departmentSource, "override");
  assert.equal(d.level, 300);
  assert.equal(d.levelSource, "override");
  assert.equal(d.semester, "second");
  assert.equal(d.semesterSource, "courses");
});

test("majority package needs a cohort and a clear majority", () => {
  const counts = [
    { code: "COS 305", students: 6 },
    { code: "SEN 301", students: 5 },
    { code: "ACC 301", students: 1 },
  ];
  assert.deepEqual(majorityPackage(counts, 10), ["COS 305"]);
  assert.deepEqual(majorityPackage(counts, 2), []);
  assert.deepEqual(missingFromPackage(["COS 305", "SEN 301"], ["cos305", "MTH 301"]), ["SEN 301"]);
  assert.equal(
    packageNote("COS 305", 300, "Computer Science"),
    "Most 300-level Computer Science students also take COS 305.",
  );
});
