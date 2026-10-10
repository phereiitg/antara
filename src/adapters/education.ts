import type { DomainAdapter } from "./types";

// DEMO checklist. Items are illustrative and need sign-off from a school
// infrastructure inspector before any real use (blueprint section 19, item 4).
export const educationAdapter: DomainAdapter = {
  id: "education",
  version: "1.0.0",
  name: "School facility inspection (demo)",
  checklists: [
    {
      id: "school_facilities",
      name: "School facility usability check (demo)",
      standard: "DEMO - not an official checklist",
      items: [
        { id: 1, question: "Are the girls' toilets usable (water available, door locks, clean)?", passCondition: "The girls' toilets are usable: water is available, doors lock and they are clean", responseType: "pass_fail_na" },
        { id: 2, question: "Are the boys' toilets usable (water available, door locks, clean)?", passCondition: "The boys' toilets are usable: water is available, doors lock and they are clean", responseType: "pass_fail_na" },
        { id: 3, question: "Is safe drinking water available to students?", passCondition: "Drinking water is available to students from a working source", responseType: "pass_fail_na" },
        { id: 4, question: "Is a fire extinguisher present and within its refill date?", passCondition: "A fire extinguisher is present and within its refill/expiry date", responseType: "pass_fail_na_date" },
        { id: 5, question: "Any exposed wiring or electrical hazards in classrooms?", passCondition: "There is NO exposed wiring or electrical hazard in classrooms", responseType: "pass_fail_na" },
        { id: 6, question: "Is there a ramp for wheelchair access?", passCondition: "A usable wheelchair ramp is present", responseType: "pass_fail_na" },
        { id: 7, question: "Does the roof leak in any classroom?", passCondition: "No classroom roof leaks", responseType: "pass_fail_na" },
      ],
    },
  ],
  defaultLanguage: "hi-IN",
  // Students (minors) are likely in view of wearable video. Under the DPDP Act children's
  // data needs verifiable parental consent, so frames are not saved or sent to the vision
  // model unless this is changed after a consent/redaction process exists.
  allowVideoFrames: false,
  actions: {
    repair_inspection: {
      description: "Create a repair inspection request for failed facility items, for the block education officer to approve.",
      allowedItemStatuses: ["FAIL"],
    },
  },
  agentGuidance:
    "Education: one narration cannot prove plumbing or electrical work is sound; describe what the staff member reported. " +
    "Never propose sanctions against the school or staff. Treat exposed wiring as high priority.",
};
