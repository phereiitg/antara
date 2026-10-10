// Analyze: animate the pipeline, type the transcript, build the report, play the Gnani reply.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$("analyze").addEventListener("click", async () => {
  $("analyze").disabled = true;
  $("analyze").textContent = "Processing…";
  $("report").classList.add("hidden");
  $("transcript").classList.remove("done");
  $("transcript").textContent = "Listening to your recording…";
  for (let i = 0; i < DEMO.stages.length; i++) {
    renderPipeline(i, i - 1);
    await sleep(DEMO.stages[i][3]);
    if (i === 1) await typeTranscript();
  }
  renderPipeline(-1, DEMO.stages.length - 1);
  state.caseId = "JS-" + Date.now().toString(36).toUpperCase().slice(-6);
  renderReport();
  $("analyze").textContent = "⚡ Analyze Another Sample";
  $("analyze").disabled = false;
  $("report").scrollIntoView({ behavior: "smooth", block: "start" });
  await sleep(700);
  playReply();
});

async function typeTranscript() {
  const el = $("transcript");
  el.textContent = "";
  el.classList.add("done");
  for (const word of DEMO.transcript.split(" ")) {
    el.textContent += (el.textContent ? " " : "") + word;
    await sleep(70);
  }
}

const replyAudio = new Audio("assets/antara-reply.wav");
replyAudio.addEventListener("play", () => $("speaking")?.classList.add("on"));
replyAudio.addEventListener("ended", () => $("speaking")?.classList.remove("on"));
replyAudio.addEventListener("pause", () => $("speaking")?.classList.remove("on"));
function playReply() {
  replyAudio.currentTime = 0;
  replyAudio.play().catch(() => {
    if ($("reviewMsg")) $("reviewMsg").textContent = "Click ▶ Play response to hear ANTARA.";
  });
}

function review(kind) {
  const who = $("reviewer").value.trim() || "Reviewer";
  const pill = $("casePill");
  const msg = $("reviewMsg");
  if (kind === "approved") {
    pill.className = "pill approved";
    pill.textContent = "✔ Approved · Lab referral";
    msg.innerHTML = `<span style="color:var(--green)">Approved by ${who}. Referral queued (mock system, no real submission).</span>`;
  } else if (kind === "rejected") {
    pill.className = "pill rejected";
    pill.textContent = "✖ Rejected";
    msg.innerHTML = `<span style="color:var(--red)">Rejected by ${who}. Field worker asked to retest.</span>`;
  } else {
    pill.className = "pill pending";
    pill.textContent = "? Clarification requested";
    msg.innerHTML = `<span class="hindi" style="color:var(--amber)">क्षेत्र कर्मी को भेजा गया: कृपया रंग चार्ट से मिलान की गई रीडिंग बोलकर दोबारा रिकॉर्ड करें।</span>`;
  }
}
