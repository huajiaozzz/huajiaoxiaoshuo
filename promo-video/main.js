/* 花椒写作产品短片 · 场景播放器 + Web Audio 合成配乐 */
(() => {
  const scenes = [...document.querySelectorAll(".scene")];
  const progress = document.getElementById("progress");
  const meta = document.getElementById("meta");
  const playBtn = document.getElementById("playBtn");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const soundBtn = document.getElementById("soundBtn");
  const soundLabel = document.getElementById("soundLabel");
  const timeline = document.getElementById("timeline");
  const boot = document.getElementById("boot");
  const startBtn = document.getElementById("startBtn");

  let index = 0;
  let playing = false;
  let muted = false;
  let elapsed = 0;
  let lastTs = 0;
  let raf = 0;

  const totalDuration = () => scenes.reduce((sum, s) => sum + Number(s.dataset.duration || 6000), 0);
  const sceneDuration = (i) => Number(scenes[i]?.dataset.duration || 6000);

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function setScene(i, { resetElapsed = true } = {}) {
    index = (i + scenes.length) % scenes.length;
    scenes.forEach((s, j) => s.classList.toggle("active", j === index));
    if (resetElapsed) elapsed = 0;
    meta.textContent = `${pad(index + 1)} / ${pad(scenes.length)}`;
    updateProgress();
  }

  function updateProgress() {
    const before = scenes.slice(0, index).reduce((sum, s) => sum + Number(s.dataset.duration || 6000), 0);
    const pct = ((before + elapsed) / totalDuration()) * 100;
    progress.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    elapsed += dt;
    const d = sceneDuration(index);
    if (elapsed >= d) {
      if (index === scenes.length - 1) {
        playing = false;
        playBtn.textContent = "▶";
        elapsed = d;
        updateProgress();
        return;
      }
      setScene(index + 1);
    } else {
      updateProgress();
    }
    raf = requestAnimationFrame(tick);
  }

  function play() {
    playing = true;
    playBtn.textContent = "❚❚";
    lastTs = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
    AudioEngine.ensure();
    AudioEngine.resume();
    if (!muted) AudioEngine.setMaster(0.22);
  }

  function pause() {
    playing = false;
    playBtn.textContent = "▶";
    cancelAnimationFrame(raf);
    AudioEngine.setMaster(0.08);
  }

  playBtn.addEventListener("click", () => {
    if (playing) pause();
    else {
      if (index === scenes.length - 1 && elapsed >= sceneDuration(index)) setScene(0);
      play();
    }
  });
  prevBtn.addEventListener("click", () => setScene(index - 1));
  nextBtn.addEventListener("click", () => {
    if (index === scenes.length - 1) {
      setScene(0);
      if (playing) play();
      return;
    }
    setScene(index + 1);
  });

  timeline.addEventListener("click", (e) => {
    const rect = timeline.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const target = ratio * totalDuration();
    let acc = 0;
    for (let i = 0; i < scenes.length; i += 1) {
      const d = sceneDuration(i);
      if (acc + d >= target || i === scenes.length - 1) {
        setScene(i, { resetElapsed: false });
        elapsed = Math.max(0, Math.min(d - 1, target - acc));
        updateProgress();
        return;
      }
      acc += d;
    }
  });

  soundBtn.addEventListener("click", () => {
    muted = !muted;
    soundBtn.textContent = muted ? "♪̸" : "♫";
    soundLabel.textContent = muted ? "BGM 关" : "BGM 开";
    AudioEngine.setMaster(muted ? 0 : playing ? 0.22 : 0.08);
  });

  startBtn.addEventListener("click", () => {
    boot.classList.add("hide");
    AudioEngine.ensure();
    AudioEngine.resume();
    play();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      playBtn.click();
    } else if (e.code === "ArrowRight") nextBtn.click();
    else if (e.code === "ArrowLeft") prevBtn.click();
    else if (e.code === "KeyM") soundBtn.click();
  });

  /* ── Ambient BGM (Web Audio, no external files) ── */
  const AudioEngine = (() => {
    let ctx = null;
    let master = null;
    let filter = null;
    let started = false;
    let loopTimer = 0;

    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.6;
      filter.connect(master);
      master.connect(ctx.destination);
      pad();
      scheduleLoop();
      started = true;
    }

    function resume() {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }

    function setMaster(v) {
      if (!master || !ctx) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.4);
    }

    function pad() {
      if (!ctx) return;
      const freqs = [110, 164.81, 220, 329.63]; // A2 E3 A3 E4
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        osc.type = i % 2 === 0 ? "sine" : "triangle";
        osc.frequency.value = f;
        g.gain.value = 0.03 / (i + 1);
        lfo.frequency.value = 0.05 + i * 0.017;
        lfoGain.gain.value = 0.012 / (i + 1);
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        osc.connect(g);
        g.connect(filter);
        osc.start();
        lfo.start();
      });

      // soft noise bed
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) data[i] = (Math.random() * 2 - 1) * 0.15;
      const noise = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = 420;
      noiseFilter.Q.value = 0.7;
      noiseGain.gain.value = 0.035;
      noise.buffer = noiseBuffer;
      noise.loop = true;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(filter);
      noise.start();
    }

    const scale = [220, 246.94, 277.18, 329.63, 369.99, 440, 493.88, 554.37]; // A minor-ish
    let step = 0;

    function pluck(time, freq, dur, gainVal) {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gainVal, time + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(g);
      g.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }

    function scheduleLoop() {
      if (!ctx) return;
      const beat = 0.72;
      for (let i = 0; i < 16; i += 1) {
        const t = ctx.currentTime + i * beat;
        if (i % 2 === 0) {
          const n = scale[(step + (i / 2) * 3) % scale.length];
          pluck(t, n, 1.6, 0.045);
        }
        if (i % 4 === 0) {
          pluck(t, scale[(step * 2) % scale.length] / 2, 2.4, 0.03);
        }
      }
      step = (step + 3) % scale.length;
      loopTimer = window.setTimeout(scheduleLoop, 16 * beat * 1000);
    }

    return {
      ensure,
      resume,
      setMaster,
      get started() {
        return started;
      },
    };
  })();

  setScene(0);
})();
