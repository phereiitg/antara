import type { DomainAdapter } from "./types";

// SYNTHETIC DEMO adapter. Nothing here is an official Jal Shakti, BIS (IS 10500) or test-kit
// requirement:
// - ftk_screening keeps an artificial DEMO_PARAM limit (1.0 demo units) for engine tests.
// - field_sample_capture has NO numeric limits: a stated reading is only RECORDED for review.
// Real limits must come from verified kit instructions and applicable standards.
export const jalShaktiAdapter: DomainAdapter = {
  id: "jal_shakti",
  version: "1.1.0",
  name: "Jal Shakti field water-testing evidence (synthetic demo)",
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
    {
      id: "field_sample_capture",
      name: "Field water sample capture: voice + photo evidence (synthetic demo)",
      standard: "SYNTHETIC DEMO - evidence completeness only; no water-quality limits",
      items: [
        { id: 1, question: "Did the field worker state the water source type (handpump, tap, well...)?", passCondition: "The field worker states the source type of the sample", responseType: "pass_fail_na" },
        { id: 2, question: "Did the field worker state that a water sample was collected?", passCondition: "The field worker states that a water sample was collected", responseType: "pass_fail_na",
          visualCheck: "a water sample container (bottle, vial or test tube) holding liquid" },
        { id: 3, question: "Was a field test performed with a reference colour chart?", passCondition: "The field worker states a field test was done and read against a reference colour chart", responseType: "pass_fail_na",
          visualCheck: "a printed reference colour chart or comparison card next to the sample" },
        { id: 4, question: "Did the field worker state the test reading?", passCondition: "A test reading is stated", responseType: "numeric", unit: "as stated" },
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
    "A lab_referral may only cite a reading item that FAILED against a configured limit. Procedure or evidence gaps call for a retest_request instead. " +
    "If the reading is above the limit AND the procedure had gaps, propose both. A RECORDED reading has no limit configured: leave it to the reviewer.",
  imageGuidance:
    "Field water-testing photo. Relevant visible things, if present: sample container, test vial or tube, reference colour " +
    "chart, labels. Describe colours only in words. A photo cannot show water quality.",
  reportDisclaimer:
    "SYNTHETIC DEMO. Preliminary field record for human review: not a laboratory result and not a drinking-water safety decision.",
};
