/* 花椒写作 · 欢快短片播放器 + 明亮合成 BGM */
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
  const dotsHost = document.getElementById("dots");

  // 彩色漂浮点点
  const colors = ["#ff6b3d", "#ffc53d", "#3ecf8e", "#4da3ff", "#9b5de5", "#ff8fab"];
  for (let i = 0; i < 18; i += 1) {
    const el = document.createElement("i");
    const size = 8 + Math.random() * 18;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${Math.random() * 100}%`;
    el.style.top = `${Math.random() * 100}%`;
    el.style.background = colors[i % colors.length];
    el.style.animationDelay = `${Math.random() * 6}s`;
    el.style.animationDuration = `${7 + Math.random() * 6}s`;
    dotsHost.appendChild(el);
  }

  let index = 0;
  let playing = false;
  let muted = false;
  let elapsed = 0;
  let lastTs = 0;
  let raf = 0;

  const totalDuration = () => scenes.reduce((sum, s) => sum + Number(s.dataset.duration || 5200), 0);
  const sceneDuration = (i) => Number(scenes[i]?.dataset.duration || 5200);
  const pad = (n) => String(n).padStart(2, "0");

  function setScene(i, { resetElapsed = true } = {}) {
    index = (i + scenes.length) % scenes.length;
    scenes.forEach((s, j) => s.classList.toggle("active", j === index));
    if (resetElapsed) elapsed = 0;
    meta.textContent = `${pad(index + 1)} / ${pad(scenes.length)}`;
    updateProgress();
  }

  function updateProgress() {
    const before = scenes.slice(0, index).reduce((sum, s) => sum + Number(s.dataset.duration || 5200), 0);
    const pct = ((before + elapsed) / totalDuration()) * 100;
    progress.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    elapsed += ts - lastTs;
    lastTs = ts;
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
    if (!muted) AudioEngine.setMaster(0.2);
  }

  function pause() {
    playing = false;
    playBtn.textContent = "▶";
    cancelAnimationFrame(raf);
    AudioEngine.setMaster(0.06);
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
    const target = ((e.clientX - rect.left) / rect.width) * totalDuration();
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
    soundBtn.textContent = muted ? "🔇" : "♫";
    soundLabel.textContent = muted ? "BGM 关" : "BGM 开";
    AudioEngine.setMaster(muted ? 0 : playing ? 0.2 : 0.06);
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

  /* 明亮大调氛围 BGM（Web Audio 合成，无外链） */
  const AudioEngine = (() => {
    let ctx = null;
    let master = null;
    let filter = null;
    let timer = 0;

    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2400;
      filter.Q.value = 0.5;
      filter.connect(master);
      master.connect(ctx.destination);

      // 轻快垫底：C3 / E3 / G3 / C4
      [130.81, 164.81, 196, 261.63].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        osc.type = i % 2 ? "triangle" : "sine";
        osc.frequency.value = f;
        g.gain.value = 0.028 / (i + 1);
        lfo.frequency.value = 0.12 + i * 0.05;
        lfoGain.gain.value = 0.01 / (i + 1);
        lfo.connect(lfoGain);
        lfoGain.connect(g.gain);
        osc.connect(g);
        g.connect(filter);
        osc.start();
        lfo.start();
      });

      // 轻气泡噪声
      const size = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, size, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < size; i += 1) data[i] = (Math.random() * 2 - 1) * 0.12;
      const noise = ctx.createBufferSource();
      const ng = ctx.createGain();
      const nf = ctx.createBiquadFilter();
      nf.type = "highpass";
      nf.frequency.value = 1200;
      ng.gain.value = 0.02;
      noise.buffer = buf;
      noise.loop = true;
      noise.connect(nf);
      nf.connect(ng);
      ng.connect(filter);
      noise.start();

      scheduleLoop();
    }

    function resume() {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }

    function setMaster(v) {
      if (!master || !ctx) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.35);
    }

    // C 大调五声/琶音，欢快
    const scale = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];
    let step = 0;

    function pluck(time, freq, dur, gain, type = "triangle") {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(g);
      g.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }

    function scheduleLoop() {
      if (!ctx) return;
      const beat = 0.38; // 更轻快
      for (let i = 0; i < 16; i += 1) {
        const t = ctx.currentTime + i * beat;
        const n = scale[(step + i * 2) % scale.length];
        if (i % 2 === 0) pluck(t, n, 0.55, 0.04);
        if (i % 4 === 0) pluck(t, scale[(step + i) % scale.length] / 2, 0.7, 0.035, "sine");
        if (i % 8 === 6) pluck(t, n * 1.5, 0.35, 0.028, "square");
      }
      step = (step + 2) % scale.length;
      timer = window.setTimeout(scheduleLoop, 16 * beat * 1000);
    }

    return { ensure, resume, setMaster };
  })();

  setScene(0);
})();
