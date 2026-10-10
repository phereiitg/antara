// Case report (prewritten content for the demo; the photo is the one you uploaded).
function renderReport() {
  const src = $("source").value;
  const loc = $("location").value || "Demo Village A";
  const img = $("previewImg").src;
  const now = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  $("report").innerHTML = `
  <div class="glass rep-head fade-in">
    <div><h3>ANTARA — Jal Shakti Field Case</h3>
      <div class="meta">Case ID <b>${state.caseId}</b> · ${now} · ${src}, ${loc}</div></div>
    <span class="pill pending" id="casePill">● Pending Review</span>
  </div>
  <div class="rep-grid fade-in">
    <div class="glass card">
      <h4>Evidence received</h4>
      <div class="kv">
        <div>Voice report</div><div>🎙 Recorded audio · Hindi</div>
        <div>Transcript</div><div class="hindi">${DEMO.transcript}</div>
        <div>Photograph</div><div>📷 Water test kit</div>
      </div>
      <img src="${img}" style="width:100%;border-radius:12px;margin-top:14px;border:1px solid var(--line)" alt="Submitted photo" />
    </div>
    <div class="glass card">
      <h4>AI observations · Gemini Vision</h4>
      <ul class="obs">
        <li>Handheld two-vial water test comparator</li>
        <li>Left vial: pale yellow-green liquid, beside a <b>chlorine (CL)</b> colour scale</li>
        <li>Right vial: pink-red liquid, beside a <b>pH</b> colour scale</li>
        <li>Reference colour charts clearly visible · image quality good</li>
        <li style="color:var(--amber)">Exact colour match cannot be confirmed reliably from a photo</li>
      </ul>
      <h4 style="margin-top:20px">Extracted field information</h4>
      <div class="kv">
        <div>Sample source</div><div>${src} <span class="tag pass">VOICE</span></div>
        <div>Location</div><div>${loc}</div>
        <div>Sample collected</div><div>Yes <span class="tag pass">VOICE + PHOTO</span></div>
        <div>Test method</div><div>Colour comparator (Cl, pH) <span class="tag pass">PHOTO</span></div>
        <div>Test reading</div><div>Not stated <span class="tag review">MISSING</span></div>
      </div>
    </div>
  </div>
  <div class="rep-grid fade-in">
    <div class="glass card">
      <h4>Central engine decision</h4>
      <div class="check"><span class="tag pass">PASS</span>Water source stated by field worker</div>
      <div class="check"><span class="tag pass">PASS</span>Sample collection stated · vials visible in photo</div>
      <div class="check"><span class="tag pass">PASS</span>Test kit and reference charts visible in photo</div>
      <div class="check"><span class="tag review">REVIEW</span>No numeric reading stated · colour reading needs human verification</div>
      <div class="disclaimer">Preliminary field screening record. Not a laboratory result and not a drinking-water safety decision.</div>
    </div>
    <div class="glass card">
      <h4>Recommended action · Cline agent</h4>
      <div style="font-size:14px;line-height:1.7">Request human verification of the colour-chart reading and prepare a
        <b>laboratory referral</b> if required by the applicable procedure.</div>
      <div class="kv" style="margin-top:12px"><div>Action</div><div>lab_referral · retest_request</div><div>Priority</div><div>Normal</div></div>
      <label>Reviewer</label><input type="text" id="reviewer" value="Block Water Officer" />
      <div class="review-row">
        <button class="btn ok" data-r="approved">✔ Approve</button>
        <button class="btn bad" data-r="rejected">✖ Reject</button>
        <button class="btn warn" data-r="clarify">? Request Clarification</button>
      </div>
      <div id="reviewMsg" style="margin-top:10px;font-size:13px"></div>
    </div>
  </div>
  <div class="glass voicebox fade-in">
    <div class="speaking" id="speaking"><i></i><i></i><i></i><i></i></div>
    <div class="txt"><div style="font-size:11px;color:var(--cyan);letter-spacing:1px">ANTARA VOICE · GNANI TTS</div>
      <div class="hindi">${DEMO.reply}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">${DEMO.replyEn}</div></div>
    <button class="btn ghost" id="replay">▶ Play response</button>
  </div>`;
  $("report").classList.remove("hidden");
  $("replay").addEventListener("click", playReply);
  document.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => review(b.dataset.r)));
}
