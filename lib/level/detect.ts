/**
 * Level, semester and department detection from enrolled course titles.
 *
 * Pure and dependency-free (no `@/` alias, no Node APIs) so the test runner can
 * import it directly. Rules, per docs/build/stage-0-completion-and-levels.md:
 *
 * - Level: the hundreds digit of the course code (`COS 202` is 200 level). The
 *   highest level that at least two courses share wins, so one carry-over (or
 *   one course taken ahead) does not decide it.
 * - Semester: last digit of the code, odd = first, even = second. Majority.
 * - Department: an authoritative source (the SIS, once we know its shape)
 *   always wins. Otherwise guess from the most common code prefix, ignoring
 *   general-studies prefixes (GST, ENT, ...) that every department takes.
 */

export type Semester = "first" | "second";

export interface CourseLike {
  id: number;
  fullname: string;
}

export interface ParsedCode {
  /** Upper-case subject prefix, e.g. "COS". */
  prefix: string;
  /** Three-digit course number, e.g. 202. */
  number: number;
  /** 100, 200, ... 900. */
  level: number;
  semester: Semester;
  /** Display form, e.g. "COS 202". */
  code: string;
}

/**
 * Prefixes shared across departments: general studies and entrepreneurship.
 * They count towards level and semester but never decide the department.
 */
export const GENERAL_PREFIXES = new Set(["GST", "GNS", "GES", "ENT", "MIVA"]);

/**
 * Foundation science prefixes taken by many departments. They only decide the
 * department when nothing more specific is present.
 */
export const SERVICE_PREFIXES = new Set(["MTH", "PHY", "CHM", "BIO", "STA"]);

/**
 * Best-effort prefix -> department slug (lib/taxonomy.ts). Only a starting
 * point for the confirm-once select; the student's answer is what is kept.
 */
export const PREFIX_DEPARTMENT: Record<string, string> = {
  COS: "computer-science",
  CSC: "computer-science",
  CPE: "computer-engineering",
  CEN: "computer-engineering",
  CYB: "cybersecurity",
  DTS: "data-science",
  SEN: "software-engineering",
  IFT: "information-technology",
  AIT: "artificial-intelligence",
  ACC: "accounting",
  ECO: "economics",
  BUS: "business-management",
  BAM: "business-management",
  PAD: "public-policy-administration",
  PPA: "public-policy-administration",
  CSS: "criminology-security-studies",
  CRM: "criminology-security-studies",
  MAC: "mass-communication",
  NSC: "nursing-science",
  PUH: "public-health",
  CHS: "community-health-science",
  EHS: "environmental-health-science",
  ECE: "early-childhood-education",
  PED: "primary-education",
};

const CODE_RE = /\b([a-z]{2,5})\s*-?\s*(\d{3})(?!\d)/gi;

/**
 * Pull the course code out of a title. "MIVA-MTH 204 - Linear Algebra II"
 * yields MTH 204: the "MIVA-" platform tag is skipped because it is not
 * followed by digits, and GENERAL_PREFIXES covers a "MIVA 101" style code.
 */
export function parseCode(title: string): ParsedCode | null {
  CODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE_RE.exec(title))) {
    const prefix = m[1].toUpperCase();
    const number = Number(m[2]);
    const hundreds = Math.floor(number / 100);
    if (hundreds < 1) continue; // "COS 050" is not a level
    return {
      prefix,
      number,
      level: hundreds * 100,
      semester: number % 2 === 1 ? "first" : "second",
      code: `${prefix} ${m[2]}`,
    };
  }
  return null;
}

/** Normalised code key for comparisons ("COS 202" -> "COS202"). */
export function codeKey(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Highest level shared by at least two courses; a lone course decides alone. */
export function detectLevel(parsed: ParsedCode[]): number | null {
  if (parsed.length === 0) return null;
  if (parsed.length === 1) return parsed[0].level;
  const counts = countBy(parsed, (p) => String(p.level));
  const shared = Object.entries(counts)
    .filter(([, n]) => n >= 2)
    .map(([lvl]) => Number(lvl));
  if (shared.length === 0) return null; // every course at a different level
  return Math.max(...shared);
}

/** Majority of odd (first) vs even (second). A tie is undecided. */
export function detectSemester(parsed: ParsedCode[]): Semester | null {
  let first = 0;
  let second = 0;
  for (const p of parsed) {
    if (p.semester === "first") first++;
    else second++;
  }
  if (first === second) return null;
  return first > second ? "first" : "second";
}

/**
 * Most common department-specific prefix. General-studies prefixes never
 * count; service-science prefixes count only when nothing else is there.
 * Ties break alphabetically so the answer is stable.
 */
export function detectPrefix(parsed: ParsedCode[]): string | null {
  const pick = (list: ParsedCode[]): string | null => {
    const counts = countBy(list, (p) => p.prefix);
    const ranked = Object.entries(counts).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    return ranked[0]?.[0] ?? null;
  };
  const eligible = parsed.filter((p) => !GENERAL_PREFIXES.has(p.prefix));
  const specific = eligible.filter((p) => !SERVICE_PREFIXES.has(p.prefix));
  return pick(specific) ?? pick(eligible);
}

/**
 * An authoritative source (e.g. the SIS profile) slots in here. Any field it
 * provides overrides the course-code guess; missing fields fall back.
 */
export interface ProfileOverride {
  department?: string | null;
  level?: number | null;
  semester?: Semester | null;
}

export type Source = "override" | "courses" | "none";

export interface DetectedCourse extends CourseLike {
  code: string | null;
  level: number | null;
}

export interface Detection {
  level: number | null;
  levelSource: Source;
  semester: Semester | null;
  semesterSource: Source;
  /** Prefix the department guess came from, e.g. "COS". */
  departmentPrefix: string | null;
  /** Department slug, if the override or the prefix map gave one. */
  department: string | null;
  departmentSource: Source;
  courses: DetectedCourse[];
  /** Courses at the detected level: what "Your courses this semester" pre-selects. */
  selectedIds: number[];
}

export function detectProfile(
  courses: CourseLike[],
  override: ProfileOverride = {},
): Detection {
  const detected: DetectedCourse[] = courses.map((c) => {
    const p = parseCode(c.fullname);
    return { id: c.id, fullname: c.fullname, code: p?.code ?? null, level: p?.level ?? null };
  });
  const parsed = courses
    .map((c) => parseCode(c.fullname))
    .filter((p): p is ParsedCode => p !== null);

  const guessedLevel = detectLevel(parsed);
  const level = override.level ?? guessedLevel;
  const levelSource: Source = override.level ? "override" : guessedLevel ? "courses" : "none";

  // Semester and department read the courses at the student's level first, so
  // carry-overs don't pull them; fall back to everything if that is empty.
  const atLevel = level ? parsed.filter((p) => p.level === level) : [];
  const basis = atLevel.length ? atLevel : parsed;

  const guessedSemester = detectSemester(basis) ?? detectSemester(parsed);
  const semester = override.semester ?? guessedSemester;
  const semesterSource: Source = override.semester
    ? "override"
    : guessedSemester
      ? "courses"
      : "none";

  const departmentPrefix = detectPrefix(basis) ?? detectPrefix(parsed);
  const guessedDept = departmentPrefix ? PREFIX_DEPARTMENT[departmentPrefix] ?? null : null;
  const department = override.department || guessedDept;
  const departmentSource: Source = override.department
    ? "override"
    : guessedDept
      ? "courses"
      : "none";

  const selectedIds = level
    ? detected.filter((c) => c.level === level).map((c) => c.id)
    : [];

  return {
    level,
    levelSource,
    semester,
    semesterSource,
    departmentPrefix,
    department,
    departmentSource,
    courses: detected,
    selectedIds,
  };
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
