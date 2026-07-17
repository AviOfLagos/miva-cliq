/**
 * Course presets. One curated preset for now; the UI also offers Custom.
 * Add more presets here — the UI renders whatever this list contains.
 */
export interface Preset {
  id: string;
  label: string; // programme
  semester: string;
  courses: string[]; // course titles, resolved to enrolled course ids at run time
}

export const PRESETS: Preset[] = [
  {
    id: "ce-2",
    label: "Computer Engineering",
    semester: "Second Semester",
    courses: [
      "COS 202 - Computer Programming II",
      "DTS 204 - Statistical Computing Inference and Modelling",
      "GST 212 - Philosophy, Logic and Human Existence",
      "IFT 212 - Computer Architecture and Organisation",
      "MIVA-MTH 204 - Linear Algebra II",
      "MTH 202 - Elementary Differential Equations",
      "PHY 202 - Introduction to Electric Circuits and Electronics",
    ],
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
