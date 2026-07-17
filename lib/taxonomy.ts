/**
 * Gists taxonomy. Both lists are plain arrays — adding, renaming, or removing an
 * entry is an edit here, not a migration. Rows store the `slug`, so changing a
 * `label` is always safe; changing a `slug` orphans existing rows.
 */

export type Category = {
  slug: string;
  label: string;
  blurb: string;
};

export type Department = {
  slug: string;
  label: string;
  school: string;
};

/**
 * Categories don't identify anyone, so they carry the browsing.
 * Keep this list short — an empty category reads as a dead forum.
 */
export const CATEGORIES: Category[] = [
  { slug: "general", label: "General", blurb: "Anything else" },
  { slug: "academics", label: "Academics", blurb: "Courses, exams, results" },
  { slug: "lecturers", label: "Lecturers", blurb: "Teaching and feedback" },
  { slug: "housing", label: "Housing", blurb: "Accommodation and logistics" },
  { slug: "events", label: "Events", blurb: "Meetups and happenings" },
];

/**
 * Undergraduate programmes, per miva.edu.ng/miva-programmes (fetched 2026-07-17),
 * grouped by school. Postgraduate programmes are deliberately excluded — Miva Cliq
 * is coursework automation, which is an undergrad use case; add them here if that
 * changes.
 *
 * Note: "Computer Engineering" is not on Miva's published programme list but is
 * the label used by the preset in lib/presets.ts, and was confirmed as real.
 */
export const DEPARTMENTS: Department[] = [
  // School of Computing
  { slug: "computer-science", label: "Computer Science", school: "Computing" },
  { slug: "computer-engineering", label: "Computer Engineering", school: "Computing" },
  { slug: "cybersecurity", label: "Cybersecurity", school: "Computing" },
  { slug: "data-science", label: "Data Science", school: "Computing" },
  { slug: "software-engineering", label: "Software Engineering", school: "Computing" },
  { slug: "information-technology", label: "Information Technology", school: "Computing" },
  { slug: "artificial-intelligence", label: "Artificial Intelligence", school: "Computing" },

  // School of Management and Social Sciences
  { slug: "business-management", label: "Business Management", school: "Management and Social Sciences" },
  { slug: "economics", label: "Economics", school: "Management and Social Sciences" },
  { slug: "accounting", label: "Accounting", school: "Management and Social Sciences" },
  { slug: "public-policy-administration", label: "Public Policy and Administration", school: "Management and Social Sciences" },
  { slug: "entrepreneurship", label: "Entrepreneurship", school: "Management and Social Sciences" },
  { slug: "criminology-security-studies", label: "Criminology and Security Studies", school: "Management and Social Sciences" },

  // School of Communication and Media Studies
  { slug: "mass-communication", label: "Mass Communication and Media Studies", school: "Communication and Media Studies" },

  // School of Allied Health Sciences
  { slug: "nursing-science", label: "Nursing Science", school: "Allied Health Sciences" },
  { slug: "public-health", label: "Public Health", school: "Allied Health Sciences" },
  { slug: "community-health-science", label: "Community Health Science", school: "Allied Health Sciences" },
  { slug: "environmental-health-science", label: "Environmental Health Science", school: "Allied Health Sciences" },

  // School of Education
  { slug: "early-childhood-education", label: "Early Childhood Education", school: "Education" },
  { slug: "primary-education", label: "Primary Education", school: "Education" },
];

export const DEFAULT_CATEGORY = "general";

const categorySlugs = new Set(CATEGORIES.map((c) => c.slug));
const departmentSlugs = new Set(DEPARTMENTS.map((d) => d.slug));

/** Never trust a slug off the wire — it lands in a WHERE clause and the UI. */
export function isCategory(slug: unknown): slug is string {
  return typeof slug === "string" && categorySlugs.has(slug);
}

export function isDepartment(slug: unknown): slug is string {
  return typeof slug === "string" && departmentSlugs.has(slug);
}

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}

export function departmentLabel(slug: string): string {
  return DEPARTMENTS.find((d) => d.slug === slug)?.label ?? slug;
}

/** Departments grouped by school, for <optgroup> in the composer. */
export function departmentsBySchool(): { school: string; items: Department[] }[] {
  const out: { school: string; items: Department[] }[] = [];
  for (const d of DEPARTMENTS) {
    const group = out.find((g) => g.school === d.school);
    if (group) group.items.push(d);
    else out.push({ school: d.school, items: [d] });
  }
  return out;
}