import type { Checklist } from "../contracts";
import type { DomainAdapter } from "./types";

// Ported from Meta-Glass-Inspection-Fire-Safety/checklist_schema.py (App 1-4).
// Questions and NFPA references are kept as in the source repo. An Indian
// deployment would replace these with NBC 2016 Part 4 (Fire and Life Safety)
// items signed off by the fire department.
const STANDARD = "NFPA (as in source repo); Indian deployment needs NBC 2016 Part 4 items";

const fireExtinguisher: Checklist = {
  id: "fire_extinguisher",
  name: "Fire Extinguisher Inspection (NFPA 10)",
  standard: STANDARD,
  items: [
    { id: 1, question: "Are fire extinguishers present? (50-75 ft travel distance for ABC extinguishers)", passCondition: "Fire extinguishers are present within the required travel distance", code: "NFPA 10, 5.1.4", responseType: "pass_fail_na" },
    { id: 2, question: "Is the annual inspection of fire extinguishers up-to-date?", passCondition: "The annual inspection of the fire extinguishers is up to date", code: "NFPA 10, 6.2.1", responseType: "pass_fail_na_date" },
    { id: 3, question: "Are fire extinguishers installed in accessible and visible areas? (3.5-5 ft height, min 4\" from floor)", passCondition: "Fire extinguishers are mounted in accessible, visible locations at the required height", code: "NFPA 10, 157(C)(1)", responseType: "pass_fail_na" },
    { id: 4, question: "Is the locking pin intact and tamper seal unbroken?", passCondition: "The locking pin is intact and the tamper seal is unbroken", code: "NFPA 10", responseType: "pass_fail_na" },
    { id: 5, question: "Is the pressure gauge in the operable range?", passCondition: "The pressure gauge needle is in the operable (green) range", code: "NFPA 10", responseType: "pass_fail_na" },
    { id: 6, question: "Are operating instructions on the nameplate legible and facing outward?", passCondition: "Nameplate operating instructions are legible and face outward", code: "NFPA 10", responseType: "pass_fail_na" },
    { id: 7, question: "No visible physical damage, corrosion, leakage, or clogged nozzle?", passCondition: "There is NO visible physical damage, corrosion, leakage or clogged nozzle", code: "NFPA 10", responseType: "pass_fail_na" },
    { id: 8, question: "Is the last professional service date within 12 months?", passCondition: "The last professional service was within the past 12 months", code: "NFPA 10", responseType: "pass_fail_na_date" },
  ],
};

const exterior: Checklist = {
  id: "exterior",
  name: "Exterior Fire Inspection",
  standard: STANDARD,
  items: [
    { id: 1, question: "Is there waste accumulation around the building?", passCondition: "There is NO waste accumulation around the building", code: "NFPA 80A", responseType: "pass_fail_na" },
    { id: 2, question: "Is the fire department connection blocked?", passCondition: "The fire department connection is NOT blocked", code: "NFPA 13, 8.17.2.4", responseType: "pass_fail_na" },
    { id: 3, question: "Are caps missing from fire department connection?", passCondition: "All caps are present on the fire department connection", code: "NFPA 13, 8.17.2.4", responseType: "pass_fail_na" },
    { id: 4, question: "Are fire lanes obstructed?", passCondition: "Fire lanes are NOT obstructed", code: "NFPA 1, 3.3.10.5", responseType: "pass_fail_na" },
    // Source repo used response_type "Distance", which its prompt never treated as numeric (bug); fixed here.
    { id: 5, question: "What is the distance to the nearest fire hydrant?", passCondition: "A distance to the nearest fire hydrant is stated", code: "NFPA 13", responseType: "numeric", unit: "ft" },
  ],
};

const fireAlarm: Checklist = {
  id: "fire_alarm",
  name: "Fire Alarm System Inspection",
  standard: STANDARD,
  items: [
    { id: 1, question: "Is alarm annunciator panel located near entry?", passCondition: "The alarm annunciator panel is located near the entry", code: "NFPA 72, 4.4.6.3", responseType: "pass_fail_na" },
    { id: 2, question: "Are smoke detectors provided in the elevator lobby area?", passCondition: "Smoke detectors are provided in the elevator lobby", code: "NFPA 72, 9.5.4.6", responseType: "pass_fail_na" },
    { id: 3, question: "Is annual inspection and testing of system up-to-date?", passCondition: "Annual inspection and testing of the alarm system is up to date", code: "NFPA 72, 10.2.1.2.2", responseType: "pass_fail_na_date" },
    { id: 4, question: "Is there a fire alarm system test log available?", passCondition: "A fire alarm system test log is available", code: "NFPA 72, 10.2.2.2", responseType: "pass_fail_na" },
    { id: 5, question: "Are alarm system components clear and/or accessible?", passCondition: "Alarm system components are clear and accessible", responseType: "pass_fail_na" },
    { id: 6, question: "Are smoke detectors located in corridors and all sleeping areas?", passCondition: "Smoke detectors are located in corridors and all sleeping areas", code: "NFPA 72, 4.4.6", responseType: "pass_fail_na" },
    { id: 7, question: "Is elevator recall tied to the alarm system and working properly?", passCondition: "Elevator recall is tied to the alarm system and works properly", code: "NFPA 72, 5.5.2.1", responseType: "pass_fail_na" },
    { id: 8, question: "Do magnetic door locks release when alarm system activated?", passCondition: "Magnetic door locks release when the alarm is activated", code: "NFPA 72, 7.2", responseType: "pass_fail_na" },
    { id: 9, question: "Does HVAC system shut down when alarm system is activated?", passCondition: "The HVAC system shuts down when the alarm is activated", code: "NFPA 72, 7.2", responseType: "pass_fail_na" },
    { id: 10, question: "Are all strobes operating properly in all assembly rooms, restrooms, ADA rooms and corridors?", passCondition: "All strobes operate properly in assembly rooms, restrooms, ADA rooms and corridors", code: "NFPA 72, 5.7.4.2.2", responseType: "pass_fail_na" },
    { id: 11, question: "Are smoke alarms located in the elevator shaft? (smoke detector at shaft, heat detector at bottom)", passCondition: "The elevator shaft has a smoke detector at the shaft and a heat detector at the bottom", code: "NFPA 72, 5.4.6", responseType: "pass_fail_na" },
    { id: 12, question: "Do all mechanical, data, electrical, laundry and storage rooms have operable smoke and/or heat detectors?", passCondition: "All mechanical, data, electrical, laundry and storage rooms have operable smoke or heat detectors", code: "NFPA 72, 5.4.6", responseType: "pass_fail_na" },
  ],
};

const sprinklerStandpipe: Checklist = {
  id: "sprinkler_standpipe",
  name: "Sprinkler & Standpipe Inspection",
  standard: STANDARD,
  items: [
    { id: 1, question: "Sprinkler heads in stairways (top and bottom)", passCondition: "Sprinkler heads are present at the top and bottom of stairways", code: "NFPA 13, 8.15.3.2", responseType: "pass_fail_na" },
    { id: 2, question: "Date of last full sprinkler system inspection", passCondition: "The full sprinkler system inspection is current and its date is stated", code: "NFPA 13, 2.2.4.2", responseType: "pass_fail_na_date" },
    { id: 3, question: "Date of last standpipe system inspection", passCondition: "The standpipe system inspection is current and its date is stated", code: "NFPA 13, 2.2.4.2", responseType: "pass_fail_na_date" },
    { id: 4, question: "Fire hydrant within 100 ft of fire department connection", passCondition: "A fire hydrant is within 100 ft of the fire department connection", code: "NFPA 14", responseType: "pass_fail_na" },
    { id: 5, question: "FDC / standpipe signage visible", passCondition: "FDC / standpipe signage is visible", code: "NFPA 13, 8.17.2.4.5", responseType: "pass_fail_na" },
    { id: 6, question: "Backflow preventer or check valve present", passCondition: "A backflow preventer or check valve is present", code: "NFPA 13, 7.8.4.2", responseType: "pass_fail_na" },
    { id: 7, question: "Sprinkler head in elevator pit within 2 ft of floor", passCondition: "There is a sprinkler head in the elevator pit within 2 ft of the floor", code: "NFPA 13, 8.15.5", responseType: "pass_fail_na" },
    { id: 8, question: "Is Attic sprinklered?", passCondition: "The attic is sprinklered", code: "NFPA 13, 8.3.2.5", responseType: "pass_fail_na" },
    { id: 9, question: "Are sprinkler heads installed under fixed obstructions over 4 ft wide?", passCondition: "Sprinkler heads are installed under fixed obstructions wider than 4 ft", code: "NFPA 13, 8.10.6.2", responseType: "pass_fail_na" },
    { id: 10, question: "Are sprinkler heads located in all mechanical, communication, electrical and storage rooms?", passCondition: "Sprinkler heads are located in all mechanical, communication, electrical and storage rooms", code: "NFPA 13, 8.15.10.1", responseType: "pass_fail_na" },
    { id: 11, question: "Dry pipe systems - is the trip test connection located on the end of the most distant sprinkler pipe in the upper story?", passCondition: "The dry pipe trip test connection is at the end of the most distant sprinkler pipe in the upper story", code: "NFPA 13, 8.16.2.4.6", responseType: "pass_fail_na" },
  ],
};

export const fireSafetyAdapter: DomainAdapter = {
  id: "fire_safety",
  version: "1.0.0",
  name: "Fire safety inspection (state fire services)",
  checklists: [fireExtinguisher, exterior, fireAlarm, sprinklerStandpipe],
  defaultLanguage: "en-IN",
  allowVideoFrames: true,
  actions: {
    rectification_notice_draft: {
      description: "Draft a notice asking the occupier to rectify failed items; a fire officer must approve before it is issued.",
      allowedItemStatuses: ["FAIL"],
    },
    reinspection_visit: {
      description: "Schedule a follow-up inspection visit for items that could not be confirmed or were not inspected.",
      allowedItemStatuses: ["NEEDS_REVIEW", "NOT_INSPECTED", "FAIL"],
    },
  },
  agentGuidance:
    "Fire safety: a FAIL on extinguisher presence, pressure, damage, blocked connections or obstructed fire lanes is high priority. " +
    "Group related failed items into one rectification_notice_draft rather than one per item.",
};
