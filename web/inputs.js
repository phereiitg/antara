// Microphone recording with live waveform, and photo upload with preview.
$("wave").innerHTML = "<span></span>".repeat(28);
const idleWave = () => document.querySelectorAll("#wave span").forEach((s) => (s.style.height = "6px"));

$("mic").addEventListener("click", async () => {
  if (state.rec) return stopRec();
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    $("micHint").textContent = "Microphone blocked: allow access and retry";
    return;
  }
  const chunks = [];
  const rec = new MediaRecorder(state.stream);
  state.rec = rec;
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    $("playback").src = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    $("playback").classList.remove("hidden");
  };
  rec.start();
  $("mic").classList.add("rec");
  $("mic").textContent = "■";
  const t0 = Date.now();
  const ctx = new AudioContext();
  const an = ctx.createAnalyser();
  an.fftSize = 64;
  ctx.createMediaStreamSource(state.stream).connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  const spans = document.querySelectorAll("#wave span");
  const loop = () => {
    an.getByteFrequencyData(buf);
    spans.forEach((s, i) => (s.style.height = `${6 + (buf[i % buf.length] / 255) * 30}px`));
    $("micHint").textContent = `Recording… ${Math.floor((Date.now() - t0) / 1000)}s (tap ■ to stop)`;
    if (Date.now() - t0 > 55000) return stopRec();
    state.raf = requestAnimationFrame(loop);
  };
  loop();
});

function stopRec() {
  cancelAnimationFrame(state.raf);
  state.rec?.stop();
  state.stream?.getTracks().forEach((t) => t.stop());
  state.rec = null;
  $("mic").classList.remove("rec");
  $("mic").textContent = "🎙";
  idleWave();
  $("micHint").textContent = "Recording complete";
  $("audioAttached").classList.remove("hidden");
  state.recorded = true;
  ready();
}

$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => {
  const f = $("file").files[0];
  if (!f) return;
  $("previewImg").src = URL.createObjectURL(f);
  $("previewCap").textContent = `${f.name} · ${(f.size / 1024).toFixed(0)} KB`;
  $("preview").classList.remove("hidden");
  $("drop").textContent = "⟳ Replace photo";
  state.photo = true;
  ready();
});

function ready() {
  $("analyze").disabled = !(state.recorded && state.photo);
}
