/**
 * The recommended course package for a department + level + semester, built
 * from what students actually enrol in (the `curriculum` table). Pure, so it
 * is testable without a database.
 */
import { codeKey } from "./detect.ts";

export interface CodeCount {
  code: string;
  /** Distinct students (salted hashes) enrolled in this code. */
  students: number;
}

/** Below this many students a "majority" is one or two people: not shown. */
export const MIN_STUDENTS = 3;

/** A clear majority: strictly more than this share of the cohort. */
export const MAJORITY_SHARE = 0.5;

/** Codes that more than half of at least MIN_STUDENTS students take. */
export function majorityPackage(counts: CodeCount[], cohort: number): string[] {
  if (cohort < MIN_STUDENTS) return [];
  return counts
    .filter((c) => c.students / cohort > MAJORITY_SHARE)
    .sort((a, b) => b.students - a.students || a.code.localeCompare(b.code))
    .map((c) => c.code);
}

/** Package codes the student is not enrolled in: shown as notes, never run. */
export function missingFromPackage(pkg: string[], enrolledCodes: string[]): string[] {
  const have = new Set(enrolledCodes.map(codeKey));
  return pkg.filter((c) => !have.has(codeKey(c)));
}

export function packageNote(code: string, level: number, departmentLabel: string): string {
  return `Most ${level}-level ${departmentLabel} students also take ${code}.`;
}
