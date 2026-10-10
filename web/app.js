// ANTARA hackathon prototype: scripted demo flow. Real pieces: the photo you upload, your mic
// recording (playback), and the spoken reply, generated with Gnani TTS (assets/antara-reply.wav).
// The transcript, image observations and case shown are prewritten for this demo.
const $ = (id) => document.getElementById(id);

const DEMO = {
  transcript: "नमस्ते, मैंने हैंडपंप से पानी का नमूना लिया है। मैंने टेस्ट किट की फोटो अपलोड की है। कृपया इसकी रिपोर्ट तैयार करें और जाँच के लिए भेजें।",
  reply: "नमस्ते। आपका हैंडपंप के पानी का नमूना दर्ज कर लिया गया है। फोटो में दो परीक्षण शीशियाँ और क्लोरीन तथा पीएच के रंग तुलना चार्ट दिखाई दे रहे हैं। आपकी रिपोर्ट तैयार कर दी गई है और मानवीय जाँच के लिए भेज दी गई है। जाँच पूरी होने तक पानी को सुरक्षित घोषित नहीं किया गया है।",
  replyEn: "Your handpump water sample has been recorded. The photo shows two test vials and chlorine and pH colour comparison charts. Your report has been prepared and sent for human review. The water has not been declared safe until the check is complete.",
  stages: [
    ["📥", "Receiving evidence", "Voice report + test-kit photo received", 900],
    ["🎙", "Gnani speech-to-text", "Hindi (hi-IN) · Gnani Prisma", 2200],
    ["👁", "Gemini image analysis", "Test equipment, vials and colour charts", 2600],
    ["🧩", "Structured extraction", "Source, collection, test method, reading", 1700],
    ["✔", "Evidence verification", "Voice and photo cross-checked", 1400],
    ["🤖", "Cline agent · reviewer routing", "Proposed: human verification + lab referral", 1900],
    ["📁", "Case created", "Pending human review", 900],
  ],
};

const state = { recorded: false, photo: false, rec: null, stream: null, raf: null, caseId: "" };

function show(view) {
  for (const v of ["home", "analysis", "adapters", "about"]) $(`view-${v}`).classList.toggle("hidden", v !== view);
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
}
document.querySelectorAll("nav a").forEach((a) => a.addEventListener("click", () => show(a.dataset.view)));
$("pick-jal").addEventListener("click", () => show("analysis"));

$("view-adapters").innerHTML = `<header class="top"><div><h2>Ministry Adapters</h2><p>Domain knowledge plugs into one shared engine.</p></div></header>
  <div class="glass info"><h3>Like antibodies: one body, specialised receptors</h3>Each adapter supplies a checklist, allowed actions,
  privacy rules and agent guidance. The core engine (speech, vision, extraction, grounding, verification, decisions and human
  review) stays the same.<ul><li><b>Jal Shakti</b>: field water sample capture (voice + photo), lab referral / retest routing.</li>
  <li><b>Education</b>: school facility inspection; wearable video frames disabled (minors in view).</li><li><b>Health</b>: medication
  instruction teach-back (planned).</li></ul></div>`;
$("view-about").innerHTML = `<header class="top"><div><h2>About the Engine</h2><p>How ANTARA turns field evidence into reviewable action.</p></div></header>
  <div class="glass info"><h3>Pipeline</h3>Voice (Gnani STT) and photo (Gemini Vision) are processed independently, then fused: the photo
  can corroborate or question what the worker said, but never overrides it. A Cline SDK agent proposes follow-up actions; deterministic
  guardrails ensure nothing is left unreviewed. Every action waits for a named human reviewer.<h3 style="margin-top:20px">Safety</h3>
  ANTARA never declares water safe from a photo. Field-kit colours are screening evidence only.</div>`;

function renderPipeline(active = -1, doneUpTo = -1) {
  const last = DEMO.stages.length - 1;
  $("pipeline").innerHTML = DEMO.stages.map(([icon, name, det], i) => {
    const done = i <= doneUpTo;
    const cls = done ? (i === last ? "review" : "completed") : i === active ? "running" : "";
    const st = done ? (i === last ? "Needs review" : "Completed") : i === active ? "Running" : "Waiting";
    const ic = done ? (i === last ? "!" : "✓") : i === active ? "<span>◌</span>" : icon;
    return `<div class="stage ${cls}"><div class="sicon">${ic}</div><div><div class="name">${name}</div><div class="det">${det}</div></div><div class="st">${st}</div></div>`;
  }).join("");
}
renderPipeline();
