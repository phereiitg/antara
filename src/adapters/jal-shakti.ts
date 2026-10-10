import type { DomainAdapter } from "./types";

// DEMO checklist for a field-test-kit (FTK) water sample. The parameter, unit and
// limit below are artificial fixture values, not water-quality standards: real
// limits must come from the kit instructions and applicable BIS norms.
export const jalShaktiAdapter: DomainAdapter = {
  id: "jal_shakti",
  version: "1.0.0",
  name: "Jal Shakti FTK screening (demo)",
  checklists: [
    {
      id: "ftk_screening",
      name: "FTK sample capture and screening (demo)",
      standard: "DEMO - fixture values only",
      items: [
        { id: 1, question: "Was the sample ID stated?", passCondition: "The tester states the sample ID", responseType: "pass_fail_na" },
        { id: 2, question: "Was the source type stated (handpump, tap, well...)?", passCondition: "The tester states the water source type", responseType: "pass_fail_na" },
        { id: 3, question: "Was the reference colour card held next to the sample when reading?", passCondition: "The reference colour card was next to the sample when the reading was taken", responseType: "pass_fail_na" },
        { id: 4, question: "Was the kit's reaction waiting time followed?", passCondition: "The tester waited the reaction time given in the kit instructions before reading", responseType: "pass_fail_na" },
        { id: 5, question: "Tester's reading for DEMO_PARAM (demo units)", passCondition: "The tester's DEMO_PARAM reading is at or below the demo limit", responseType: "numeric", unit: "demo units", max: 1.0 },
      ],
    },
  ],
  defaultLanguage: "hi-IN",
  // Hands are busy with vial, dropper and card, so wearable capture fits well. Frames are
  // allowed: they show the kit, not people. Field users must still avoid filming faces.
  allowVideoFrames: true,
  actions: {
    lab_referral: {
      description: "Refer the sample for laboratory confirmation. Only for a tester reading above the limit; a supervisor must approve.",
      allowedItemStatuses: ["FAIL"],
    },
    retest_request: {
      description: "Ask the field tester to repeat the test because the capture was incomplete or the procedure was not followed.",
      allowedItemStatuses: ["FAIL", "NEEDS_REVIEW", "NOT_INSPECTED"],
    },
  },
  agentGuidance:
    "Jal Shakti: a field kit reading is a presumptive screen, never a safety verdict. Never say water is safe or unsafe. " +
    "A lab_referral may only cite the reading item (5). Procedure gaps (items 1-4) call for a retest_request instead. " +
    "If the reading is above the limit AND the procedure had gaps, propose both.",
};
