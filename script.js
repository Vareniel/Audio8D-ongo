/* ════════════════════════════════════════════════
   SCOPE CANVAS
════════════════════════════════════════════════ */
const scopeCvs = document.getElementById("scope-cvs");
const sCtx = scopeCvs.getContext("2d");
let trail = [], curPan = 0;

function resizeScope() {
  const w = scopeCvs.parentElement.clientWidth * devicePixelRatio;
  scopeCvs.width = scopeCvs.height = w;
}
resizeScope();
window.addEventListener("resize", resizeScope);

function drawScope() {
  const W = scopeCvs.width, cx = W/2, cy = W/2, R = W*0.4;
  sCtx.clearRect(0,0,W,W);
  sCtx.beginPath(); sCtx.arc(cx,cy,R+2,0,Math.PI*2);
  sCtx.fillStyle = "rgba(7,7,15,0.97)"; sCtx.fill();
  [0.25,0.5,0.75,1].forEach(f => {
    sCtx.beginPath(); sCtx.arc(cx,cy,R*f,0,Math.PI*2);
    sCtx.strokeStyle = "rgba(255,255,255,0.05)"; sCtx.lineWidth=1; sCtx.stroke();
  });
  sCtx.strokeStyle="rgba(255,255,255,0.055)"; sCtx.lineWidth=1;
  sCtx.beginPath(); sCtx.moveTo(cx-R,cy); sCtx.lineTo(cx+R,cy); sCtx.stroke();
  sCtx.beginPath(); sCtx.moveTo(cx,cy-R); sCtx.lineTo(cx,cy+R); sCtx.stroke();
  function toXY(p) {
    const a = -Math.PI/2 + p*Math.PI/2;
    return { x: cx+Math.cos(a)*R, y: cy+Math.sin(a)*R };
  }
  if (trail.length > 1) {
    for (let i=1; i<trail.length; i++) {
      const t=i/trail.length, a=toXY(trail[i-1]), b=toXY(trail[i]);
      sCtx.beginPath(); sCtx.moveTo(a.x,a.y); sCtx.lineTo(b.x,b.y);
      sCtx.strokeStyle=`rgba(0,232,176,${t*0.5})`; sCtx.lineWidth=2*t; sCtx.stroke();
    }
  }
  const d=toXY(curPan);
  const g=sCtx.createRadialGradient(d.x,d.y,0,d.x,d.y,20);
  g.addColorStop(0,"rgba(0,232,176,0.3)"); g.addColorStop(1,"transparent");
  sCtx.beginPath(); sCtx.arc(d.x,d.y,20,0,Math.PI*2); sCtx.fillStyle=g; sCtx.fill();
  sCtx.beginPath(); sCtx.arc(d.x,d.y,4.5,0,Math.PI*2);
  sCtx.fillStyle="#00e8b0"; sCtx.shadowColor="#00e8b0"; sCtx.shadowBlur=14; sCtx.fill(); sCtx.shadowBlur=0;
  requestAnimationFrame(drawScope);
}
drawScope();

/* ════════════════════════════════════════════════
   FREQ VISUALIZER
════════════════════════════════════════════════ */
const vizCvs = document.getElementById("viz");
const vCtx = vizCvs.getContext("2d");
let analyser, waveAnalyser;

(function drawViz() {
  if (analyser) {
    const W=vizCvs.offsetWidth*devicePixelRatio, H=vizCvs.offsetHeight*devicePixelRatio;
    vizCvs.width=W; vizCvs.height=H;
    const data=new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    vCtx.clearRect(0,0,W,H);
    const bw=(W/data.length)*2.1; let x=0;
    for (let i=0; i<data.length; i++) {
      const h=(data[i]/255)*H*0.86, t=i/data.length;
      const r=Math.round(t*255), gg=Math.round(232-t*59), b=Math.round(176-t*117);
      vCtx.fillStyle=`rgba(${r},${gg},${b},0.78)`;
      vCtx.fillRect(x,H-h,bw-0.5,h);
      x+=bw+0.5;
    }
  }
  requestAnimationFrame(drawViz);
})();

/* ════════════════════════════════════════════════
   WAVEFORM VISUALIZER
════════════════════════════════════════════════ */
const waveCvs = document.getElementById("waveViz");
const wCtx = waveCvs.getContext("2d");

(function drawWave() {
  if (waveAnalyser) {
    const W=waveCvs.offsetWidth*devicePixelRatio, H=waveCvs.offsetHeight*devicePixelRatio;
    waveCvs.width=W; waveCvs.height=H;
    const data=new Uint8Array(waveAnalyser.fftSize);
    waveAnalyser.getByteTimeDomainData(data);
    wCtx.clearRect(0,0,W,H);
    wCtx.strokeStyle="rgba(255,173,59,0.6)";
    wCtx.lineWidth=1.5; wCtx.beginPath();
    const sw=W/data.length;
    for (let i=0; i<data.length; i++) {
      const x=i*sw, y=(data[i]/255)*H;
      i===0 ? wCtx.moveTo(x,y) : wCtx.lineTo(x,y);
    }
    wCtx.stroke();
  }
  requestAnimationFrame(drawWave);
})();

/* ════════════════════════════════════════════════
   AUDIO ENGINE
════════════════════════════════════════════════ */
let audioCtx, sourceNode, pannerNode, gainNode, dryNode, wetNode;
let compressor, distortion, lpf, hpf, notchFilter;
let bassEq, lowmidEq, midEq, highmidEq, trebleEq;
let chorusDelay, chorusLFO, chorusLFOGain, chorusWet, chorusDry;
let flangerDelay, flangerLFO, flangerLFOGain, flangerFeedback, flangerWet;
let tremoloGain, tremoloLFO;
let haasDelay;
let audioBuffer = null;
let isPlaying = false, loopEnabled = false;
let startCtxTime = 0, startOffset = 0, isSeeking = false;
let scheduleTimer = null;
const SCHEDULE_AHEAD = 0.3, SCHEDULE_TICK = 100;
let schedulePhase = 0, scheduleCtxTime = 0;
let scopeRaf;

const qs = id => document.getElementById(id);
const fileInput=qs("fileInput"), uploadZone=qs("uploadZone"), chip=qs("chip"),
  chipName=qs("chipName"), chipSz=qs("chipSz"), playBtn=qs("playBtn"),
  playIco=qs("playIco"), playLbl=qs("playLbl"), loopBtn=qs("loopBtn"),
  dlBtn=qs("dlBtn"), prog=qs("prog"), progFill=qs("progFill"),
  progTxt=qs("progTxt"), progPct=qs("progPct"), dot=qs("dot"),
  dotLbl=qs("dotLbl"), panOut=qs("panOut"), seekCtrl=qs("seekCtrl"),
  seekCur=qs("seekCur"), seekDur=qs("seekDur"),
  speedCtrl=qs("speedCtrl"), depthCtrl=qs("depthCtrl"),
  reverbCtrl=qs("reverbCtrl"), volCtrl=qs("volCtrl"),
  decayCtrl=qs("decayCtrl"), haasCtrl=qs("haasCtrl"),
  pitchCtrl=qs("pitchCtrl"), compThreshCtrl=qs("compThreshCtrl"),
  compRatioCtrl=qs("compRatioCtrl"), compKneeCtrl=qs("compKneeCtrl"),
  distCtrl=qs("distCtrl"), compToggle=qs("compToggle"),
  bassCtrl=qs("bassCtrl"), lowmidCtrl=qs("lowmidCtrl"), midCtrl=qs("midCtrl"),
  highmidCtrl=qs("highmidCtrl"), trebleCtrl=qs("trebleCtrl"),
  chorusMixCtrl=qs("chorusMixCtrl"), chorusRateCtrl=qs("chorusRateCtrl"),
  chorusDepthCtrl=qs("chorusDepthCtrl"),
  flangerMixCtrl=qs("flangerMixCtrl"), flangerRateCtrl=qs("flangerRateCtrl"),
  tremoloRateCtrl=qs("tremoloRateCtrl"), tremoloDepthCtrl=qs("tremoloDepthCtrl"),
  lpfCtrl=qs("lpfCtrl"), lpfQCtrl=qs("lpfQCtrl"),
  hpfCtrl=qs("hpfCtrl"), hpfQCtrl=qs("hpfQCtrl"),
  notchCtrl=qs("notchCtrl"), notchDepthCtrl=qs("notchDepthCtrl");

/* helpers */
function setStatus(on,txt) { dot.classList.toggle("on",on); dotLbl.classList.toggle("on",on); dotLbl.textContent=txt; }
function fmtTime(s) { if(!isFinite(s))return"0:00"; const m=Math.floor(s/60),sec=Math.floor(s%60); return`${m}:${sec.toString().padStart(2,"0")}`; }
function fmtBytes(b) { return b<1024?b+"B":b<1048576?(b/1024).toFixed(1)+"KB":(b/1048576).toFixed(1)+"MB"; }
function fmtFreq(f) { return f>=1000?(f/1000).toFixed(1)+"k Hz":f+" Hz"; }

/* ── make distortion curve ── */
function makeDistCurve(amount) {
  const n=256, curve=new Float32Array(n);
  const k = amount===0 ? 0.001 : amount*400;
  for (let i=0; i<n; i++) {
    const x=(i*2/n)-1;
    curve[i] = (3+k)*x*20*Math.PI/180 / (Math.PI+k*Math.abs(x));
  }
  return curve;
}

/* ── make IR for reverb ── */
function makeIR(ctx, dur=2.5, decay=2) {
  const buf=ctx.createBuffer(2,ctx.sampleRate*dur,ctx.sampleRate);
  for (let c=0;c<2;c++) {
    const d=buf.getChannelData(c);
    for (let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,decay);
  }
  return buf;
}

/* ── syncLabels ── */
function syncLabels() {
  qs("speedVal").textContent=parseFloat(speedCtrl.value).toFixed(2)+" Hz";
  qs("depthVal").textContent=parseFloat(depthCtrl.value).toFixed(2);
  qs("reverbVal").textContent=reverbCtrl.value+"%";
  qs("volVal").textContent=volCtrl.value+"%";
  qs("decayVal").textContent=parseFloat(decayCtrl.value).toFixed(1)+"s";
  qs("haasVal").textContent=haasCtrl.value+" ms";
  qs("pitchVal").textContent=parseFloat(pitchCtrl.value).toFixed(2)+"×";
  qs("compThreshVal").textContent=compThreshCtrl.value+" dB";
  qs("compRatioVal").textContent=compRatioCtrl.value+":1";
  qs("compKneeVal").textContent=compKneeCtrl.value+" dB";
  qs("distVal").textContent=distCtrl.value+"%";
  qs("bassVal").textContent=(bassCtrl.value>=0?"+":"")+bassCtrl.value+" dB";
  qs("lowmidVal").textContent=(lowmidCtrl.value>=0?"+":"")+lowmidCtrl.value+" dB";
  qs("midVal").textContent=(midCtrl.value>=0?"+":"")+midCtrl.value+" dB";
  qs("highmidVal").textContent=(highmidCtrl.value>=0?"+":"")+highmidCtrl.value+" dB";
  qs("trebleVal").textContent=(trebleCtrl.value>=0?"+":"")+trebleCtrl.value+" dB";
  qs("chorusMixVal").textContent=chorusMixCtrl.value+"%";
  qs("chorusRateVal").textContent=parseFloat(chorusRateCtrl.value).toFixed(1)+" Hz";
  qs("chorusDepthVal").textContent=parseFloat(chorusDepthCtrl.value).toFixed(1)+" ms";
  qs("flangerMixVal").textContent=flangerMixCtrl.value+"%";
  qs("flangerRateVal").textContent=parseFloat(flangerRateCtrl.value).toFixed(2)+" Hz";
  qs("tremoloRateVal").textContent=tremoloRateCtrl.value+" Hz";
  qs("tremoloDepthVal").textContent=tremoloDepthCtrl.value+"%";
  qs("lpfVal").textContent=fmtFreq(parseInt(lpfCtrl.value));
  qs("lpfQVal").textContent=parseFloat(lpfQCtrl.value).toFixed(1);
  qs("hpfVal").textContent=fmtFreq(parseInt(hpfCtrl.value));
  qs("hpfQVal").textContent=parseFloat(hpfQCtrl.value).toFixed(1);
  qs("notchVal").textContent=fmtFreq(parseInt(notchCtrl.value));
  qs("notchDepthVal").textContent=notchDepthCtrl.value+"%";
  qs("mSpeed").textContent=parseFloat(speedCtrl.value).toFixed(2);
  qs("mRange").textContent=parseFloat(depthCtrl.value).toFixed(2);
  qs("mReverb").textContent=reverbCtrl.value+"%";
  qs("mPitch").textContent=parseFloat(pitchCtrl.value).toFixed(2)+"×";
  // apply live to nodes
  if (gainNode) gainNode.gain.value=volCtrl.value/100;
  if (dryNode && wetNode) { const m=reverbCtrl.value/100; dryNode.gain.value=1-m*0.6; wetNode.gain.value=m*0.6; }
  if (sourceNode) sourceNode.playbackRate.value=parseFloat(pitchCtrl.value);
  if (compressor) {
    compressor.threshold.value=parseFloat(compThreshCtrl.value);
    compressor.ratio.value=parseFloat(compRatioCtrl.value);
    compressor.knee.value=parseFloat(compKneeCtrl.value);
  }
  if (distortion) distortion.curve=makeDistCurve(distCtrl.value/100);
  if (bassEq) bassEq.gain.value=parseFloat(bassCtrl.value);
  if (lowmidEq) lowmidEq.gain.value=parseFloat(lowmidCtrl.value);
  if (midEq) midEq.gain.value=parseFloat(midCtrl.value);
  if (highmidEq) highmidEq.gain.value=parseFloat(highmidCtrl.value);
  if (trebleEq) trebleEq.gain.value=parseFloat(trebleCtrl.value);
  if (lpf) { lpf.frequency.value=parseFloat(lpfCtrl.value); lpf.Q.value=parseFloat(lpfQCtrl.value); }
  if (hpf) { hpf.frequency.value=parseFloat(hpfCtrl.value); hpf.Q.value=parseFloat(hpfQCtrl.value); }
  if (notchFilter) { notchFilter.frequency.value=parseFloat(notchCtrl.value); notchFilter.gain.value=-(notchDepthCtrl.value/100)*30; }
  if (chorusWet && chorusDry) { const cm=chorusMixCtrl.value/100; chorusWet.gain.value=cm; chorusDry.gain.value=1-cm*0.5; }
  if (chorusLFO) chorusLFO.frequency.value=parseFloat(chorusRateCtrl.value);
  if (chorusLFOGain) chorusLFOGain.gain.value=parseFloat(chorusDepthCtrl.value)/1000;
  if (flangerLFO) flangerLFO.frequency.value=parseFloat(flangerRateCtrl.value);
  if (flangerWet) flangerWet.gain.value=flangerMixCtrl.value/100*0.7;
  if (tremoloLFO) tremoloLFO.frequency.value=parseFloat(tremoloRateCtrl.value);
  if (tremoloGain) { const td=tremoloDepthCtrl.value/100; tremoloGain.gain.setTargetAtTime(1-td*0.7, audioCtx.currentTime, 0.01); }
  if (haasDelay) haasDelay.delayTime.value=parseFloat(haasCtrl.value)/1000;
  if (isPlaying) reanchorPhase();
}

const allCtrls = [
  speedCtrl,depthCtrl,reverbCtrl,volCtrl,decayCtrl,haasCtrl,pitchCtrl,
  compThreshCtrl,compRatioCtrl,compKneeCtrl,distCtrl,
  bassCtrl,lowmidCtrl,midCtrl,highmidCtrl,trebleCtrl,
  chorusMixCtrl,chorusRateCtrl,chorusDepthCtrl,
  flangerMixCtrl,flangerRateCtrl,
  tremoloRateCtrl,tremoloDepthCtrl,
  lpfCtrl,lpfQCtrl,hpfCtrl,hpfQCtrl,notchCtrl,notchDepthCtrl
];
allCtrls.forEach(s => s.addEventListener("input", syncLabels));
compToggle.addEventListener("change", () => {
  if (compressor) compressor.threshold.value = compToggle.checked ? parseFloat(compThreshCtrl.value) : 0;
});
syncLabels();

/* ── Tabs ── */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    qs("tab-"+btn.dataset.tab).classList.add("active");
  });
});

/* ── Presets ── */
const PRESETS = {
  "8d":        { speed:0.15, depth:0.95, reverb:25, decay:1.5, haas:0,  pitch:1,    bass:0,  treble:0,  lpf:20000, hpf:10,   chorusMix:0,  flangerMix:0,  tremoloDepth:0,  dist:0,  compThresh:-24 },
  "concert":   { speed:0.10, depth:0.75, reverb:80, decay:4.5, haas:15, pitch:1,    bass:2,  treble:1,  lpf:18000, hpf:30,   chorusMix:20, flangerMix:0,  tremoloDepth:0,  dist:0,  compThresh:-30 },
  "cave":      { speed:0.08, depth:0.6,  reverb:90, decay:5.5, haas:30, pitch:0.97, bass:5,  treble:-3, lpf:12000, hpf:60,   chorusMix:10, flangerMix:0,  tremoloDepth:0,  dist:0,  compThresh:-20 },
  "telephone": { speed:0.05, depth:0.3,  reverb:15, decay:0.8, haas:0,  pitch:1,    bass:-8, treble:-5, lpf:3400,  hpf:300,  chorusMix:0,  flangerMix:0,  tremoloDepth:0,  dist:15, compThresh:-18 },
  "underwater":{ speed:0.12, depth:0.5,  reverb:70, decay:3.0, haas:5,  pitch:0.93, bass:8,  treble:-8, lpf:800,   hpf:10,   chorusMix:30, flangerMix:10, tremoloDepth:15, dist:0,  compThresh:-24 },
  "lofi":      { speed:0.08, depth:0.4,  reverb:30, decay:1.2, haas:0,  pitch:0.98, bass:3,  treble:-6, lpf:6000,  hpf:200,  chorusMix:10, flangerMix:0,  tremoloDepth:5,  dist:20, compThresh:-20 },
  "bass":      { speed:0.15, depth:0.7,  reverb:35, decay:2.0, haas:0,  pitch:1,    bass:12, treble:2,  lpf:20000, hpf:10,   chorusMix:0,  flangerMix:0,  tremoloDepth:0,  dist:5,  compThresh:-28 },
  "night":     { speed:0.2,  depth:0.85, reverb:60, decay:3.5, haas:10, pitch:1,    bass:6,  treble:4,  lpf:16000, hpf:50,   chorusMix:25, flangerMix:15, tremoloDepth:10, dist:0,  compThresh:-22 },
};
document.querySelectorAll(".btn-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const p = PRESETS[btn.dataset.preset];
    if (!p) return;
    speedCtrl.value=p.speed; depthCtrl.value=p.depth; reverbCtrl.value=p.reverb;
    decayCtrl.value=p.decay; haasCtrl.value=p.haas; pitchCtrl.value=p.pitch;
    bassCtrl.value=p.bass; trebleCtrl.value=p.treble;
    lpfCtrl.value=p.lpf; hpfCtrl.value=p.hpf;
    chorusMixCtrl.value=p.chorusMix; flangerMixCtrl.value=p.flangerMix;
    tremoloDepthCtrl.value=p.tremoloDepth; distCtrl.value=p.dist;
    compThreshCtrl.value=p.compThresh;
    syncLabels();
    showToast("✓ Preset: "+btn.textContent);
  });
});

/* ── File loading ── */
let handleFile = function(file) {
  if (!file||(!file.type.startsWith("audio/")&&!file.name.match(/\.(mp3|wav|ogg|flac|m4a)$/i))) {
    showToast("⚠ Pilih file audio (MP3, WAV, OGG)"); return;
  }
  chipName.textContent=file.name; chipSz.textContent=fmtBytes(file.size); chip.classList.add("on");
  setStatus(false,"loading…");
  const reader=new FileReader();
  reader.onload=async e=>{
    const tmp=new (window.AudioContext||window.webkitAudioContext)();
    try {
      audioBuffer=await tmp.decodeAudioData(e.target.result);
      await tmp.close();
      playBtn.disabled=false; dlBtn.disabled=false; loopBtn.disabled=false;
      seekCtrl.max=audioBuffer.duration; seekCtrl.disabled=false;
      seekDur.textContent=fmtTime(audioBuffer.duration);
      setStatus(false,"ready"); showToast("✓ File dimuat — siap diputar");
    } catch { setStatus(false,"error"); showToast("✗ Format tidak didukung"); }
  };
  reader.readAsArrayBuffer(file);
};
fileInput.addEventListener("change", e=>handleFile(e.target.files[0]));
uploadZone.addEventListener("dragover", e=>{e.preventDefault();uploadZone.classList.add("drag");});
uploadZone.addEventListener("dragleave", ()=>uploadZone.classList.remove("drag"));
uploadZone.addEventListener("drop", e=>{e.preventDefault();uploadZone.classList.remove("drag");handleFile(e.dataTransfer.files[0]);});

/* ── YouTube ── */
const ytInput=qs("ytInput"), ytBtn=qs("ytBtn"), ytStatus=qs("ytStatus");
function ytSetStatus(type,msg,spinner=false) {
  ytStatus.className="yt-status"+(type?" "+type:"");
  ytStatus.innerHTML=(spinner?'<span class="yt-spinner"></span>':"")+msg;
}
function extractYtId(url) {
  try {
    const u=new URL(url.trim());
    if(u.hostname==="youtu.be")return u.pathname.slice(1).split("?")[0];
    return u.searchParams.get("v")||null;
  } catch { return null; }
}

ytBtn.addEventListener("click", loadYoutube);
ytInput.addEventListener("keydown", e=>{if(e.key==="Enter")loadYoutube();});
ytInput.addEventListener("paste", ()=>setTimeout(()=>{
  const v=ytInput.value.trim();
  if(v.includes("youtube.com")||v.includes("youtu.be")) ytSetStatus("","URL terdeteksi · tekan Enter atau klik Ambil");
},50));

/* ════════════════════════════════════════════════
   BUILD AUDIO GRAPH — all effects chain
   src → hpf → lpf → notch → bass/mid/treble eq
       → panner → dist → compressor
       → chorus (parallel) → flanger (parallel)
       → tremolo → haas → dry+reverb → master gain
       → analyser → destination
════════════════════════════════════════════════ */
async function buildGraph() {
  if (audioCtx) audioCtx.close();
  audioCtx = new (window.AudioContext||window.webkitAudioContext)();

  /* — Source — */
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.loop = loopEnabled;
  sourceNode.playbackRate.value = parseFloat(pitchCtrl.value);

  /* — High Pass Filter — */
  hpf = audioCtx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = parseFloat(hpfCtrl.value);
  hpf.Q.value = parseFloat(hpfQCtrl.value);

  /* — Low Pass Filter — */
  lpf = audioCtx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = parseFloat(lpfCtrl.value);
  lpf.Q.value = parseFloat(lpfQCtrl.value);

  /* — Notch Filter — */
  notchFilter = audioCtx.createBiquadFilter();
  notchFilter.type = "peaking";
  notchFilter.frequency.value = parseFloat(notchCtrl.value);
  notchFilter.Q.value = 5;
  notchFilter.gain.value = -(notchDepthCtrl.value/100)*30;

  /* — 5-band EQ — */
  bassEq = audioCtx.createBiquadFilter();
  bassEq.type = "lowshelf"; bassEq.frequency.value = 100;
  bassEq.gain.value = parseFloat(bassCtrl.value);

  lowmidEq = audioCtx.createBiquadFilter();
  lowmidEq.type = "peaking"; lowmidEq.frequency.value = 400; lowmidEq.Q.value = 1;
  lowmidEq.gain.value = parseFloat(lowmidCtrl.value);

  midEq = audioCtx.createBiquadFilter();
  midEq.type = "peaking"; midEq.frequency.value = 1500; midEq.Q.value = 1;
  midEq.gain.value = parseFloat(midCtrl.value);

  highmidEq = audioCtx.createBiquadFilter();
  highmidEq.type = "peaking"; highmidEq.frequency.value = 4000; highmidEq.Q.value = 1;
  highmidEq.gain.value = parseFloat(highmidCtrl.value);

  trebleEq = audioCtx.createBiquadFilter();
  trebleEq.type = "highshelf"; trebleEq.frequency.value = 8000;
  trebleEq.gain.value = parseFloat(trebleCtrl.value);

  /* — Panner (8D) — */
  pannerNode = audioCtx.createStereoPanner();

  /* — Distortion — */
  distortion = audioCtx.createWaveShaper();
  distortion.curve = makeDistCurve(distCtrl.value/100);
  distortion.oversample = "4x";

  /* — Compressor — */
  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = parseFloat(compThreshCtrl.value);
  compressor.ratio.value = parseFloat(compRatioCtrl.value);
  compressor.knee.value = parseFloat(compKneeCtrl.value);
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  /* — Chorus — */
  chorusDelay = audioCtx.createDelay(0.05);
  chorusDelay.delayTime.value = 0.025;
  chorusLFO = audioCtx.createOscillator();
  chorusLFO.type = "sine";
  chorusLFO.frequency.value = parseFloat(chorusRateCtrl.value);
  chorusLFOGain = audioCtx.createGain();
  chorusLFOGain.gain.value = parseFloat(chorusDepthCtrl.value)/1000;
  chorusLFO.connect(chorusLFOGain);
  chorusLFOGain.connect(chorusDelay.delayTime);
  chorusLFO.start();
  chorusWet = audioCtx.createGain();
  chorusWet.gain.value = chorusMixCtrl.value/100;
  chorusDry = audioCtx.createGain();
  chorusDry.gain.value = 1-(chorusMixCtrl.value/100)*0.5;

  /* — Flanger — */
  flangerDelay = audioCtx.createDelay(0.02);
  flangerDelay.delayTime.value = 0.005;
  flangerLFO = audioCtx.createOscillator();
  flangerLFO.type = "sine";
  flangerLFO.frequency.value = parseFloat(flangerRateCtrl.value);
  flangerLFOGain = audioCtx.createGain();
  flangerLFOGain.gain.value = 0.003;
  flangerLFO.connect(flangerLFOGain);
  flangerLFOGain.connect(flangerDelay.delayTime);
  flangerLFO.start();
  flangerFeedback = audioCtx.createGain();
  flangerFeedback.gain.value = 0.5;
  flangerWet = audioCtx.createGain();
  flangerWet.gain.value = flangerMixCtrl.value/100*0.7;

  /* — Tremolo — */
  tremoloLFO = audioCtx.createOscillator();
  tremoloLFO.type = "sine";
  tremoloLFO.frequency.value = parseFloat(tremoloRateCtrl.value);
  tremoloGain = audioCtx.createGain();
  const td = tremoloDepthCtrl.value/100;
  tremoloGain.gain.value = 1 - td*0.7;
  const tremoloLFOGain = audioCtx.createGain();
  tremoloLFOGain.gain.value = td*0.7;
  tremoloLFO.connect(tremoloLFOGain);
  tremoloLFOGain.connect(tremoloGain.gain);
  tremoloLFO.start();

  /* — Haas Delay — */
  haasDelay = audioCtx.createDelay(0.04);
  haasDelay.delayTime.value = parseFloat(haasCtrl.value)/1000;
  const haasGain = audioCtx.createGain();
  haasGain.gain.value = 0.7;
  const haasChannelMerger = audioCtx.createChannelMerger(2);
  const haasChannelSplitter = audioCtx.createChannelSplitter(2);

  /* — Reverb — */
  const conv = audioCtx.createConvolver();
  const dec = parseFloat(decayCtrl.value);
  conv.buffer = makeIR(audioCtx, Math.min(dec, 6), dec/2);
  dryNode = audioCtx.createGain();
  wetNode = audioCtx.createGain();
  const m = reverbCtrl.value/100;
  dryNode.gain.value = 1-m*0.6;
  wetNode.gain.value = m*0.6;

  /* — Master gain + analysers — */
  gainNode = audioCtx.createGain();
  gainNode.gain.value = volCtrl.value/100;
  analyser = audioCtx.createAnalyser(); analyser.fftSize=512;
  waveAnalyser = audioCtx.createAnalyser(); waveAnalyser.fftSize=1024;

  /* ── WIRE UP ── */
  // src → filters → EQ chain → panner → distortion → compressor
  sourceNode.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(notchFilter);
  notchFilter.connect(bassEq);
  bassEq.connect(lowmidEq);
  lowmidEq.connect(midEq);
  midEq.connect(highmidEq);
  highmidEq.connect(trebleEq);
  trebleEq.connect(pannerNode);
  pannerNode.connect(distortion);
  distortion.connect(compressor);

  // compressor → chorus (parallel dry/wet)
  compressor.connect(chorusDry);
  compressor.connect(chorusDelay);
  chorusDelay.connect(chorusWet);

  // chorus out → flanger (parallel)
  const chorusMix = audioCtx.createGain(); chorusMix.gain.value=1;
  chorusDry.connect(chorusMix);
  chorusWet.connect(chorusMix);
  chorusMix.connect(flangerDelay);
  flangerDelay.connect(flangerFeedback);
  flangerFeedback.connect(flangerDelay);
  const flangerDry = audioCtx.createGain(); flangerDry.gain.value=1;
  chorusMix.connect(flangerDry);
  flangerDelay.connect(flangerWet);

  // flanger out → tremolo
  const flangerMix = audioCtx.createGain(); flangerMix.gain.value=1;
  flangerDry.connect(flangerMix);
  flangerWet.connect(flangerMix);
  flangerMix.connect(tremoloGain);

  // tremolo → reverb (dry/wet) → master → analysers → out
  tremoloGain.connect(dryNode);
  tremoloGain.connect(conv);
  conv.connect(wetNode);
  dryNode.connect(gainNode);
  wetNode.connect(gainNode);
  gainNode.connect(analyser);
  gainNode.connect(waveAnalyser);
  analyser.connect(audioCtx.destination);
}

/* ═══ PAN SCHEDULING ═══ */
function reanchorPhase() {
  if (!audioCtx||!isPlaying) return;
  const elapsed=audioCtx.currentTime-startCtxTime+startOffset;
  schedulePhase=2*Math.PI*parseFloat(speedCtrl.value)*elapsed;
  scheduleCtxTime=audioCtx.currentTime;
  pannerNode.pan.cancelScheduledValues(audioCtx.currentTime);
  scheduleMore();
}
function scheduleMore() {
  if (!audioCtx||!pannerNode) return;
  const now=audioCtx.currentTime, until=now+SCHEDULE_AHEAD;
  const speed=parseFloat(speedCtrl.value), depth=parseFloat(depthCtrl.value);
  const dt=now-scheduleCtxTime, step=0.02;
  schedulePhase+=2*Math.PI*speed*dt; scheduleCtxTime=now;
  let t=now, ph=schedulePhase;
  while (t<until) { pannerNode.pan.setValueAtTime(Math.sin(ph)*depth,t); ph+=2*Math.PI*speed*step; t+=step; }
}
function startScheduler() {
  schedulePhase=0; scheduleCtxTime=audioCtx.currentTime;
  scheduleMore(); scheduleTimer=setInterval(scheduleMore,SCHEDULE_TICK);
}
function stopScheduler() { clearInterval(scheduleTimer); scheduleTimer=null; }

/* ── Scope update ── */
function startScopeUpdate() {
  function tick() {
    if (!isPlaying||!audioCtx) return;
    const elapsed=audioCtx.currentTime-startCtxTime+startOffset;
    const speed=parseFloat(speedCtrl.value), depth=parseFloat(depthCtrl.value);
    const ph=2*Math.PI*speed*elapsed;
    const pan=Math.sin(ph)*depth;
    curPan=pan; trail.push(pan);
    if (trail.length>90) trail.shift();
    panOut.textContent=`PAN  ${pan>=0?"+":""}${pan.toFixed(2)}`;
    panOut.classList.toggle("on",Math.abs(pan)>0.04);
    if (!isSeeking) {
      const dur=audioBuffer.duration;
      const dispTime=loopEnabled?elapsed%dur:Math.min(elapsed,dur);
      seekCtrl.value=dispTime; seekCur.textContent=fmtTime(dispTime);
    }
    scopeRaf=requestAnimationFrame(tick);
  }
  scopeRaf=requestAnimationFrame(tick);
}
function stopScopeUpdate() { cancelAnimationFrame(scopeRaf); }

/* ── Play/Stop ── */
playBtn.addEventListener("click", async()=>{
  if (!audioBuffer) return;
  if (isPlaying) { stopPB(); return; }
  await play(startOffset);
});

let play = async function(offset) {
  await buildGraph();
  startOffset=Math.max(0,Math.min(offset,audioBuffer.duration));
  startCtxTime=audioCtx.currentTime;
  sourceNode.start(0,startOffset);
  isPlaying=true;
  sourceNode.onended=()=>{ if(isPlaying&&!loopEnabled)stopPB(); };
  startScheduler(); startScopeUpdate();
  playBtn.classList.add("stop"); playIco.textContent="⏹"; playLbl.textContent="Stop";
  setStatus(true,"playing");
};

function stopPB() {
  stopScheduler(); stopScopeUpdate();
  if (sourceNode) { try{sourceNode.stop();}catch(e){} }
  isPlaying=false; trail=[]; curPan=0;
  panOut.textContent="PAN  0.00"; panOut.classList.remove("on");
  playBtn.classList.remove("stop"); playIco.textContent="▶"; playLbl.textContent="Play 8D";
  setStatus(false,"ready");
}

/* ── Loop ── */
loopBtn.addEventListener("click",()=>{
  loopEnabled=!loopEnabled; loopBtn.classList.toggle("on",loopEnabled);
  if(sourceNode) sourceNode.loop=loopEnabled;
  showToast(loopEnabled?"↻ Loop aktif":"Loop nonaktif");
});

/* ── Seek ── */
seekCtrl.addEventListener("mousedown",()=>{isSeeking=true;});
seekCtrl.addEventListener("touchstart",()=>{isSeeking=true;},{passive:true});
seekCtrl.addEventListener("input",()=>{seekCur.textContent=fmtTime(parseFloat(seekCtrl.value));});
async function commitSeek() {
  isSeeking=false;
  const newOffset=parseFloat(seekCtrl.value);
  startOffset=newOffset;
  if (isPlaying) {
    stopScheduler(); stopScopeUpdate();
    if(sourceNode){try{sourceNode.onended=null;sourceNode.stop();}catch(e){}}
    await buildGraph();
    startCtxTime=audioCtx.currentTime; startOffset=newOffset;
    sourceNode.start(0,startOffset); sourceNode.loop=loopEnabled;
    sourceNode.onended=()=>{if(isPlaying&&!loopEnabled)stopPB();};
    startScheduler(); startScopeUpdate();
  }
}
seekCtrl.addEventListener("mouseup",commitSeek);
seekCtrl.addEventListener("touchend",commitSeek);
seekCtrl.addEventListener("change",()=>{if(isSeeking)return;commitSeek();});

/* ── Export WAV ── */
dlBtn.addEventListener("click", async()=>{
  if (!audioBuffer) return;
  dlBtn.disabled=true; prog.classList.add("on"); progFill.style.width="0%"; progPct.textContent="0%"; progTxt.textContent="scheduling…";
  try {
    const dur=audioBuffer.duration, sr=audioBuffer.sampleRate;
    const off=new OfflineAudioContext(2,Math.ceil(dur*sr),sr);
    const src=off.createBufferSource(); src.buffer=audioBuffer;
    src.playbackRate.value=parseFloat(pitchCtrl.value);

    // HPF & LPF
    const ohpf=off.createBiquadFilter(); ohpf.type="highpass"; ohpf.frequency.value=parseFloat(hpfCtrl.value); ohpf.Q.value=parseFloat(hpfQCtrl.value);
    const olpf=off.createBiquadFilter(); olpf.type="lowpass"; olpf.frequency.value=parseFloat(lpfCtrl.value); olpf.Q.value=parseFloat(lpfQCtrl.value);
    const onotch=off.createBiquadFilter(); onotch.type="peaking"; onotch.frequency.value=parseFloat(notchCtrl.value); onotch.Q.value=5; onotch.gain.value=-(notchDepthCtrl.value/100)*30;
    // EQ
    const ob=off.createBiquadFilter(); ob.type="lowshelf"; ob.frequency.value=100; ob.gain.value=parseFloat(bassCtrl.value);
    const olm=off.createBiquadFilter(); olm.type="peaking"; olm.frequency.value=400; olm.Q.value=1; olm.gain.value=parseFloat(lowmidCtrl.value);
    const om=off.createBiquadFilter(); om.type="peaking"; om.frequency.value=1500; om.Q.value=1; om.gain.value=parseFloat(midCtrl.value);
    const ohm=off.createBiquadFilter(); ohm.type="peaking"; ohm.frequency.value=4000; ohm.Q.value=1; ohm.gain.value=parseFloat(highmidCtrl.value);
    const otr=off.createBiquadFilter(); otr.type="highshelf"; otr.frequency.value=8000; otr.gain.value=parseFloat(trebleCtrl.value);
    // Panner, dist, comp
    const opan=off.createStereoPanner();
    const odist=off.createWaveShaper(); odist.curve=makeDistCurve(distCtrl.value/100); odist.oversample="4x";
    const ocomp=off.createDynamicsCompressor(); ocomp.threshold.value=parseFloat(compThreshCtrl.value); ocomp.ratio.value=parseFloat(compRatioCtrl.value); ocomp.knee.value=parseFloat(compKneeCtrl.value);
    // Reverb
    const oconv=off.createConvolver(); oconv.buffer=makeIR(off,Math.min(parseFloat(decayCtrl.value),6),parseFloat(decayCtrl.value)/2);
    const odry=off.createGain(), owet=off.createGain(), omaster=off.createGain();
    const rm=reverbCtrl.value/100; odry.gain.value=1-rm*0.6; owet.gain.value=rm*0.6; omaster.gain.value=volCtrl.value/100;
    // wire
    src.connect(ohpf); ohpf.connect(olpf); olpf.connect(onotch); onotch.connect(ob);
    ob.connect(olm); olm.connect(om); om.connect(ohm); ohm.connect(otr); otr.connect(opan);
    opan.connect(odist); odist.connect(ocomp); ocomp.connect(odry); ocomp.connect(oconv);
    oconv.connect(owet); odry.connect(omaster); owet.connect(omaster); omaster.connect(off.destination);
    // schedule pan
    const spd=parseFloat(speedCtrl.value), dep=parseFloat(depthCtrl.value);
    const steps=Math.ceil(dur*300);
    for (let i=0;i<=steps;i++) opan.pan.setValueAtTime(Math.sin(2*Math.PI*spd*(i/steps)*dur)*dep,(i/steps)*dur);
    src.start(0);
    progTxt.textContent="rendering…";
    let p=0; const iv=setInterval(()=>{p=Math.min(p+2,80);progFill.style.width=p+"%";progPct.textContent=p+"%";},100);
    const rendered=await off.startRendering();
    clearInterval(iv); progFill.style.width="95%"; progPct.textContent="95%"; progTxt.textContent="encoding…";
    const wav=toWav(rendered), url=URL.createObjectURL(wav);
    const a=document.createElement("a"); a.href=url;
    a.download=(chipName.textContent.replace(/\.[^.]+$/,"")||"audio")+"_8D_Pro.wav";
    a.click(); URL.revokeObjectURL(url);
    progFill.style.width="100%"; progPct.textContent="100%"; progTxt.textContent="selesai ✓";
    showToast("✓ File 8D Pro berhasil diekspor!");
    setTimeout(()=>prog.classList.remove("on"),2600);
  } catch(e) { progTxt.textContent="gagal: "+e.message; showToast("✗ Render gagal"); }
  dlBtn.disabled=false;
});

function toWav(buf) {
  const nc=buf.numberOfChannels, sr=buf.sampleRate, len=buf.length;
  const ab=new ArrayBuffer(44+len*nc*2), v=new DataView(ab);
  const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  ws(0,"RIFF"); v.setUint32(4,36+len*nc*2,true); ws(8,"WAVE"); ws(12,"fmt ");
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,nc,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*nc*2,true); v.setUint16(32,nc*2,true);
  v.setUint16(34,16,true); ws(36,"data"); v.setUint32(40,len*nc*2,true);
  const ch=[]; for(let c=0;c<nc;c++)ch.push(buf.getChannelData(c));
  let off=44;
  for(let i=0;i<len;i++) for(let c=0;c<nc;c++) { v.setInt16(off,Math.max(-32768,Math.min(32767,ch[c][i]*0x7fff)),true); off+=2; }
  return new Blob([ab],{type:"audio/wav"});
}

let toastT;
function showToast(msg) {
  const t=qs("toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),3000);
}

/* ════════════════════════════════════════════════
   PLAYLIST SYSTEM
════════════════════════════════════════════════ */
let playlist = [];          // [{name, size, duration, buffer, src}]
let playlistIdx = -1;       // current track index
let historyList = [];       // played tracks
let shuffleOn = false;
let repeatOn  = false;
let qpActiveTab = "queue";

const queueFab   = qs("queue-fab");
const queuePanel = qs("queue-panel");
const fabBadge   = qs("fabBadge");
const qpList     = qs("qpList");
const qpEmpty    = qs("qpEmpty");
const qpCount    = qs("qpCount");
const qpNowName  = qs("qpNowName");
const qpNowSub   = qs("qpNowSub");
const qpNowDur   = qs("qpNowDur");
const qpNowDot   = qs("qpNowDot");
const qpShuffle  = qs("qpShuffle");
const qpRepeat   = qs("qpRepeat");
const qpPrev     = qs("qpPrev");
const qpNext     = qs("qpNext");

/* Toggle panel */
queueFab.addEventListener("click", () => {
  queuePanel.classList.toggle("open");
});
document.addEventListener("click", e => {
  if (!queuePanel.contains(e.target) && e.target !== queueFab && !queueFab.contains(e.target)) {
    queuePanel.classList.remove("open");
  }
});

/* Tabs */
document.querySelectorAll(".qp-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".qp-tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    qpActiveTab = btn.dataset.qptab;
    renderQpList();
  });
});

/* Shuffle / Repeat */
qpShuffle.addEventListener("click", () => { shuffleOn=!shuffleOn; qpShuffle.classList.toggle("on",shuffleOn); showToast(shuffleOn?"⇄ Shuffle aktif":"Shuffle nonaktif"); });
qpRepeat.addEventListener("click",  () => { repeatOn=!repeatOn;   qpRepeat.classList.toggle("on",repeatOn);   showToast(repeatOn?"↻ Repeat aktif":"Repeat nonaktif"); });

/* Prev / Next */
qpPrev.addEventListener("click", () => playAtIdx(playlistIdx - 1));
qpNext.addEventListener("click", () => {
  if (shuffleOn && playlist.length > 1) {
    let r; do { r = Math.floor(Math.random()*playlist.length); } while (r===playlistIdx);
    playAtIdx(r);
  } else {
    playAtIdx(playlistIdx + 1);
  }
});

/* ── Render list ── */
function renderQpList() {
  qpList.querySelectorAll(".qp-track").forEach(e=>e.remove());

  const items = qpActiveTab === "queue" ? playlist : historyList;
  qpEmpty.style.display = items.length === 0 ? "block" : "none";

  items.forEach((track, i) => {
    const div = document.createElement("div");
    div.className = "qp-track" + (qpActiveTab==="queue" && i===playlistIdx ? " active":"");
    div.innerHTML = `
      <div class="qp-track-num">${qpActiveTab==="queue" && i===playlistIdx
        ? `<div class="eq-bars${isPlaying?" playing":""}"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>`
        : i+1}</div>
      <div class="qp-track-ico">${track.src==="yt" ? "▶" : "♪"}</div>
      <div class="qp-track-info">
        <div class="qp-track-name" title="${track.name}">${track.name}</div>
        <div class="qp-track-meta">${track.src==="yt"?"YouTube":"File"} · ${track.size||""}</div>
      </div>
      <div class="qp-track-dur">${track.duration||"—"}</div>
      ${qpActiveTab==="queue"?`<button class="qp-track-del" title="Hapus">✕</button>`:""}
    `;
    if (qpActiveTab==="queue") {
      div.addEventListener("click", e => {
        if (e.target.closest(".qp-track-del")) { removeFromPlaylist(i); return; }
        playAtIdx(i);
      });
    }
    qpList.appendChild(div);
  });

  const cnt = playlist.length;
  qpCount.textContent = cnt + " lagu";
  fabBadge.textContent = cnt;
  fabBadge.classList.toggle("on", cnt > 0);
  qpPrev.disabled = playlist.length < 2;
  qpNext.disabled = playlist.length < 2;
}

/* ── Update "Now Playing" strip ── */
function updateNowPlaying() {
  if (playlistIdx < 0 || playlistIdx >= playlist.length) {
    qpNowName.textContent = "Tidak ada lagu dipilih";
    qpNowSub.textContent  = "Tambah lagu ke playlist";
    qpNowDur.textContent  = "—";
    qpNowDot.classList.add("idle");
    return;
  }
  const t = playlist[playlistIdx];
  qpNowName.textContent = t.name;
  qpNowSub.textContent  = (t.src==="yt"?"YouTube":"File") + " · " + (playlistIdx+1)+"/"+playlist.length;
  qpNowDur.textContent  = t.duration || "—";
  qpNowDot.classList.toggle("idle", !isPlaying);
}

/* ── Add track to playlist ── */
function addToPlaylist(entry) {
  // avoid exact duplicates by name
  if (playlist.some(p=>p.name===entry.name)) return;
  playlist.push(entry);
  if (playlistIdx < 0) playlistIdx = 0;
  renderQpList();
  updateNowPlaying();
}

/* ── Remove from playlist ── */
function removeFromPlaylist(i) {
  if (i === playlistIdx && isPlaying) stopPB();
  playlist.splice(i,1);
  if (playlistIdx >= playlist.length) playlistIdx = playlist.length-1;
  renderQpList(); updateNowPlaying();
  showToast("✗ Lagu dihapus dari playlist");
}

/* ── Play track at index ── */
async function playAtIdx(i) {
  if (playlist.length === 0) return;
  i = ((i % playlist.length) + playlist.length) % playlist.length;
  playlistIdx = i;
  const track = playlist[i];

  if (isPlaying) { stopPB(); }

  // Load buffer
  audioBuffer = track.buffer;
  chipName.textContent = track.name;
  chipSz.textContent   = track.size || "";
  chip.classList.add("on");
  playBtn.disabled=false; dlBtn.disabled=false; loopBtn.disabled=false;
  seekCtrl.max=audioBuffer.duration; seekCtrl.disabled=false;
  seekCtrl.value=0; seekCur.textContent="0:00";
  seekDur.textContent=fmtTime(audioBuffer.duration);
  startOffset=0;

  // Add to history
  if (!historyList.some(h=>h.name===track.name)) historyList.unshift(track);
  if (historyList.length > 50) historyList.pop();

  setStatus(false,"ready");
  renderQpList(); updateNowPlaying();
  await play(0);
  showToast("▶ " + track.name);
}

/* ── Auto-advance when song ends ── */
const _origSourceOnEnded_wrap = () => {
  if (repeatOn) {
    play(0);
    return;
  }
  if (playlist.length > 1) {
    if (shuffleOn) {
      let r; do { r=Math.floor(Math.random()*playlist.length); } while(r===playlistIdx);
      playAtIdx(r);
    } else {
      if (playlistIdx < playlist.length-1) {
        playAtIdx(playlistIdx+1);
      } else {
        stopPB();
        updateNowPlaying();
      }
    }
  } else {
    stopPB();
    updateNowPlaying();
  }
};

/* Patch play() to attach auto-advance */
const _origPlay = play;
play = async function(offset) {
  await buildGraph();
  startOffset=Math.max(0,Math.min(offset,audioBuffer.duration));
  startCtxTime=audioCtx.currentTime;
  sourceNode.start(0,startOffset);
  isPlaying=true;
  sourceNode.onended=()=>{
    if(isPlaying&&!loopEnabled) {
      isPlaying=false; trail=[]; curPan=0;
      panOut.textContent="PAN  0.00"; panOut.classList.remove("on");
      playBtn.classList.remove("stop"); playIco.textContent="▶"; playLbl.textContent="Play 8D";
      setStatus(false,"ready");
      stopScheduler(); stopScopeUpdate();
      qpNowDot.classList.add("idle");
      _origSourceOnEnded_wrap();
    }
  };
  startScheduler(); startScopeUpdate();
  playBtn.classList.add("stop"); playIco.textContent="⏹"; playLbl.textContent="Stop";
  setStatus(true,"playing");
  qpNowDot.classList.remove("idle");
  renderQpList(); updateNowPlaying();
};

/* ── Intercept file loading to add to playlist ── */
handleFile = function(file) {
  if (!file||(!file.type.startsWith("audio/")&&!file.name.match(/\.(mp3|wav|ogg|flac|m4a)$/i))) {
    showToast("⚠ Pilih file audio (MP3, WAV, OGG)"); return;
  }
  chipName.textContent=file.name; chipSz.textContent=fmtBytes(file.size); chip.classList.add("on");
  setStatus(false,"loading…");
  const reader=new FileReader();
  reader.onload=async e=>{
    const tmp=new (window.AudioContext||window.webkitAudioContext)();
    try {
      const buf=await tmp.decodeAudioData(e.target.result);
      await tmp.close();

      const entry = {
        name: file.name.replace(/\.[^.]+$/,""),
        size: fmtBytes(file.size),
        duration: fmtTime(buf.duration),
        buffer: buf,
        src: "file"
      };
      addToPlaylist(entry);

      // Set as current
      const idx = playlist.findIndex(p=>p.name===entry.name);
      if (idx>=0) playlistIdx=idx;
      audioBuffer=buf;

      playBtn.disabled=false; dlBtn.disabled=false; loopBtn.disabled=false;
      seekCtrl.max=buf.duration; seekCtrl.disabled=false;
      seekDur.textContent=fmtTime(buf.duration);
      setStatus(false,"ready"); showToast("✓ "+entry.name+" — ditambah ke playlist");
      renderQpList(); updateNowPlaying();
    } catch { setStatus(false,"error"); showToast("✗ Format tidak didukung"); }
  };
  reader.readAsArrayBuffer(file);
};

/* ── Override existing event listeners for file ── */
fileInput.removeEventListener("change", e=>handleFile(e.target.files[0]));
fileInput.addEventListener("change", e=>handleFile(e.target.files[0]));
uploadZone.addEventListener("drop", e=>{e.preventDefault();uploadZone.classList.remove("drag");handleFile(e.dataTransfer.files[0]);});

/* Allow multi-file drop on queue panel too */
queuePanel.addEventListener("dragover", e=>{ e.preventDefault(); e.stopPropagation(); });
queuePanel.addEventListener("drop", e=>{
  e.preventDefault(); e.stopPropagation();
  Array.from(e.dataTransfer.files).forEach(f=>handleFile(f));
});

/* ── Intercept YouTube load to add to playlist ── */
async function loadYoutube() {
  const raw = ytInput.value.trim();
  if (!raw) {
    ytSetStatus("err", "⚠ Masukkan URL YouTube");
    return;
  }
  const vid = extractYtId(raw);
  if (!vid) {
    ytSetStatus("err", "⚠ URL tidak valid");
    return;
  }

  ytBtn.disabled = true;
  const YTDROP = "https://layer-spaces-decor-derek.trycloudflare.com";

  /* ── Step 1: ambil info video (judul, format list) ── */
  ytSetStatus("loading", "Mengambil info video...", true);
  let info;
  try {
    const infoRes = await fetch(
      `${YTDROP}/info?url=${encodeURIComponent(raw)}`,
    );
    if (!infoRes.ok) {
      const err = await infoRes.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${infoRes.status}`);
    }
    info = await infoRes.json();
  } catch (e) {
    ytSetStatus(
      "err",
      `✗ Info gagal: ${e.message} — pastikan server YTDrop aktif (node server.js)`,
    );
    ytBtn.disabled = false;
    return;
  }

  /* ── Step 2: pilih format audio terbaik ── */
  const bestAudio = (info.formats || [])
    .filter((f) => f.type === "audio")
    .sort((a, b) => {
      // prefer "Best" first, then by kbps desc
      if (a.format_id === "bestaudio/best") return -1;
      if (b.format_id === "bestaudio/best") return 1;
      const kbpA = parseInt(a.quality) || 0;
      const kbpB = parseInt(b.quality) || 0;
      return kbpB - kbpA;
    })[0];

  if (!bestAudio) {
    ytSetStatus("err", "✗ Tidak ada format audio ditemukan");
    ytBtn.disabled = false;
    return;
  }

  /* ── Step 3: download audio ── */
  const title = info.title || `YouTube-${vid}`;
  const dur = info.duration ? fmtTime(info.duration) : "?:??";
  ytSetStatus("loading", `Mengunduh: ${title.slice(0, 30)}...`, true);

  try {
    const params = new URLSearchParams({
      url: raw,
      format_id: bestAudio.format_id,
      type: "audio",
    });
    const dlRes = await fetch(`${YTDROP}/download?${params}`);
    if (!dlRes.ok) {
      const err = await dlRes.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${dlRes.status}`);
    }

    ytSetStatus("loading", "Mendekode audio...", true);
    const arrayBuf = await dlRes.arrayBuffer();

    /* ── Step 4: decode ke AudioBuffer ── */
    const tmp = new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = await tmp.decodeAudioData(arrayBuf);
    await tmp.close();

    /* ── Step 5: update UI ── */
    chipName.textContent = title;
    chipSz.textContent = `${dur} · YouTube`;
    chip.classList.add("on");
    playBtn.disabled = false;
    dlBtn.disabled = false;
    loopBtn.disabled = false;
    seekCtrl.max = audioBuffer.duration;
    seekCtrl.disabled = false;
    seekDur.textContent = fmtTime(audioBuffer.duration);
    setStatus(false, "ready");
    ytSetStatus("ok", `✓ Dimuat: ${title.slice(0, 35)}`);
    showToast("✓ Audio YouTube berhasil dimuat!");
  } catch (e) {
    ytSetStatus("err", "✗ Download gagal: " + e.message);
  }

  ytBtn.disabled = false;
}
/* re-bind YouTube button */
ytBtn.removeEventListener("click", loadYoutube);
ytBtn.addEventListener("click", loadYoutube);
ytInput.removeEventListener("keydown", e=>{if(e.key==="Enter")loadYoutube();});
ytInput.addEventListener("keydown", e=>{if(e.key==="Enter")loadYoutube();});

/* initial render */
renderQpList();
updateNowPlaying();

setStatus(false,"standby");