const STORAGE_KEY = "benchmark-graph-builder-state";
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

const defaultState = {
  transparent: false,
  background: "#080808",
  durationSeconds: 12,
  animateFade: true,
  backgroundImage: null,     // base64 data URL  
  panel: "#111111",
  grid: "rgba(255,255,255,0.09)",
  models: [
    {id: "gpt55", name: "GPT-5.5 in Codex", color: "#efefef"},
    {id: "gpt54", name: "GPT-5.4 baseline", color: "#777777"},
  ],
  benchmarks: [
    {
      id: "terminal",
      label: "Terminal-Bench 2.0",
      detail: "Complex command-line workflows",
      scores: {gpt55: 82.7, gpt54: 75.1},
    },
    {
      id: "expert",
      label: "Expert-SWE",
      detail: "Long-horizon coding tasks",
      scores: {gpt55: 73.1, gpt54: 68.5},
    },
    {
      id: "swe",
      label: "SWE-Bench Pro",
      detail: "Public GitHub issue resolution",
      scores: {gpt55: 58.6, gpt54: 57.7},
    },
    {
      id: "osworld",
      label: "OSWorld-Verified",
      detail: "Computer use tasks",
      scores: {gpt55: 78.7, gpt54: 75.0},
    },
    {
      id: "toolathlon",
      label: "Toolathlon",
      detail: "Tool and workflow orchestration",
      scores: {gpt55: 55.6, gpt54: 54.6},
    },
  ],
};

let state = loadState();
let bgImageObj = null; // cached Image object for background

const $ = (selector) => document.querySelector(selector);
const modelsEditor = $("#models-editor");
const benchmarksEditor = $("#benchmarks-editor");
const previewCanvas = $("#preview-canvas");
const backgroundColorInput = $("#background-color");
const durationInput = $("#duration-seconds");
const transparentInput = $("#transparent-background");
const animateFadeInput = $("#animate-fade");
let animationFrameId = null;
let currentProgress = 1;
let isPlaying = false;
let playStartTime = null;
let playStartProgress = null;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // migrate: ensure new fields exist
      if (parsed.animateFade === undefined) parsed.animateFade = true;
      if (parsed.backgroundImage === undefined) parsed.backgroundImage = null;
      return parsed;
    }
    return structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function updateState(mutator) {
  mutator(state);
  saveState();
  renderApp();
}

function updateStateChartOnly(mutator) {
  mutator(state);
  saveState();
  renderChart();
}

/* Allow any positive value — bar caps at 100% width, but label shows real value */
function normalizeScore(value) {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);
}

function roundedRect(context, x, y, width, height, radius) {
  if (width <= 0 || height <= 0) return;
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawFittedText(context, text, x, y, maxWidth, fontSize, weight, color) {
  let size = fontSize;
  context.fillStyle = color;
  while (size > 10) {
    context.font = `${weight} ${size}px Inter, Segoe UI, Arial, sans-serif`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  context.fillText(text, x, y);
}

/* ─── Hex color helpers ─── */
function isValidHex(hex) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex);
}

function normalizeHex(hex) {
  let h = hex.trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (isValidHex(h)) return h;
  return null;
}

/* ─── Background image loading ─── */
function loadBackgroundImage() {
  if (state.backgroundImage) {
    const img = new Image();
    img.onload = () => {
      bgImageObj = img;
      renderChart();
    };
    img.src = state.backgroundImage;
  } else {
    bgImageObj = null;
  }
}

/* ─── Data operations ─── */
function addModel() {
  const id = uid("series");
  updateState((draft) => {
    draft.models.push({id, name: `Series ${draft.models.length + 1}`, color: "#bdbdbd"});
    for (const benchmark of draft.benchmarks) {
      benchmark.scores[id] = 50;
    }
  });
}

function removeModel(modelId) {
  updateState((draft) => {
    if (draft.models.length <= 1) return;
    draft.models = draft.models.filter((m) => m.id !== modelId);
    for (const benchmark of draft.benchmarks) {
      delete benchmark.scores[modelId];
    }
  });
}

function addBenchmark() {
  updateState((draft) => {
    const scores = {};
    for (const m of draft.models) scores[m.id] = 50;
    draft.benchmarks.push({
      id: uid("cat"),
      label: `Category ${draft.benchmarks.length + 1}`,
      detail: "Description",
      scores,
    });
  });
}

function removeBenchmark(benchmarkId) {
  updateState((draft) => {
    if (draft.benchmarks.length <= 1) return;
    draft.benchmarks = draft.benchmarks.filter((b) => b.id !== benchmarkId);
  });
}

/* ─── Editor rendering ─── */
function renderModelEditors() {
  modelsEditor.innerHTML = state.models
    .map(
      (model) => `
        <article class="editor-card">
          <div class="row-actions">
            <strong>${escapeHtml(model.name)}</strong>
            <button class="remove-button" data-remove-model="${model.id}" type="button">Remove</button>
          </div>
          <div class="field-grid">
            <label>
              Name
              <input data-model-name="${model.id}" value="${escapeHtml(model.name)}" />
            </label>
            <label>
              Color
              <div class="hex-color-input">
                <span class="color-swatch" data-swatch-for="${model.id}" style="background:${model.color}"></span>
                <input type="color" class="hidden-color-picker" data-color-picker="${model.id}" value="${model.color}" />
                <input data-model-color="${model.id}" value="${escapeHtml(model.color)}" placeholder="#efefef" maxlength="7" />
              </div>
            </label>
          </div>
        </article>
      `,
    )
    .join("");
  const badge = $("#series-count");
  if (badge) badge.textContent = state.models.length;
}

function renderBenchmarkEditors() {
  benchmarksEditor.innerHTML = state.benchmarks
    .map(
      (benchmark) => `
        <article class="editor-card">
          <div class="row-actions">
            <strong>${escapeHtml(benchmark.label)}</strong>
            <button class="remove-button" data-remove-benchmark="${benchmark.id}" type="button">Remove</button>
          </div>
          <div class="field-grid full">
            <label>
              Name
              <input data-benchmark-label="${benchmark.id}" value="${escapeHtml(benchmark.label)}" />
            </label>
            <label>
              Description
              <textarea data-benchmark-detail="${benchmark.id}">${escapeHtml(benchmark.detail)}</textarea>
            </label>
          </div>
          <div class="score-grid">
            ${state.models
              .map(
                (model) => `
                  <label class="score-row">
                    <span>${escapeHtml(model.name)}</span>
                    <input
                      data-score-benchmark="${benchmark.id}"
                      data-score-model="${model.id}"
                      type="number"
                      min="0"
                      max="10000"
                      step="0.1"
                      value="${benchmark.scores[model.id] ?? 0}"
                    />
                  </label>
                `,
              )
              .join("")}
          </div>
        </article>
      `,
    )
    .join("");
  const badge = $("#categories-count");
  if (badge) badge.textContent = state.benchmarks.length;
}

/* ─── Layout ─── */
function getLayout() {
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const rowCount = Math.max(1, state.benchmarks.length);
  const modelCount = Math.max(1, state.models.length);
  const panelX = 150;
  const panelY = 145;
  const panelWidth = width - panelX * 2;
  const panelHeight = height - panelY * 2;
  const paddingX = 80;
  const paddingY = rowCount > 8 ? 48 : 64;
  const labelColumn = 390;
  const valueColumn = 88;
  const columnGap = 34;
  const barColumnWidth = panelWidth - paddingX * 2 - labelColumn - valueColumn - columnGap * 2;
  const legendRows = Math.max(1, Math.ceil(state.models.length / 3));
  const legendHeight = legendRows * 38;
  const legendGap = 28;
  const xAxisHeight = 30;

  const availableHeight = panelHeight - paddingY * 2 - legendHeight - legendGap - xAxisHeight;
  const maxRowGap = rowCount <= 2 ? 60 : rowCount <= 4 ? 44 : 34;
  const targetGap = rowCount > 1 ? (availableHeight - rowCount * 60) / (rowCount - 1) : 0;
  const rowGap = rowCount > 1 ? Math.max(10, Math.min(maxRowGap, targetGap)) : 0;
  const rowHeight = (availableHeight - rowGap * Math.max(0, rowCount - 1)) / rowCount;
  const scale = Math.max(0.5, Math.min(1.3, rowHeight / 88));
  const barGap = Math.max(4, Math.min(12, 8 * scale));
  const textZone = 30 * scale;
  const maxBarHeight = rowCount <= 2 ? 44 : rowCount <= 4 ? 34 : 24;
  const barHeight = Math.max(8, Math.min(maxBarHeight,
    (rowHeight - textZone - barGap * (modelCount - 1)) / modelCount));

  return {
    width, height, panelX, panelY, panelWidth, panelHeight,
    paddingX, paddingY, labelColumn, valueColumn, columnGap,
    barColumnWidth, legendHeight, legendGap, xAxisHeight,
    rowGap, rowHeight, scale, barGap, barHeight,
    labelFont: Math.round(Math.min(36, 30 * scale)),
    detailFont: Math.round(Math.min(24, 18 * scale)),
    valueFont: Math.round(Math.min(24, 18 * scale)),
  };
}

/* ─── Drawing ─── */
function drawChartFrame(canvas, progress = 1) {
  const context = canvas.getContext("2d");
  const layout = getLayout();
  const barX = layout.panelX + layout.paddingX + layout.labelColumn + layout.columnGap;
  const valueX = barX + layout.barColumnWidth + layout.columnGap;
  const contentTop = layout.panelY + layout.paddingY + layout.legendHeight + layout.legendGap;
  const gridHeight = layout.panelHeight - layout.paddingY * 2 - layout.legendHeight - layout.legendGap - layout.xAxisHeight;
  const fade = state.animateFade;

  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  /* ── Background ── */
  if (!state.transparent) {
    context.fillStyle = state.background;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    /* Background image */
    if (bgImageObj) {
      context.save();
      const imgAspect = bgImageObj.width / bgImageObj.height;
      const canvasAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
      let dx = 0, dy = 0, dw = CANVAS_WIDTH, dh = CANVAS_HEIGHT;
      if (imgAspect > canvasAspect) {
        dw = CANVAS_HEIGHT * imgAspect;
        dx = (CANVAS_WIDTH - dw) / 2;
      } else {
        dh = CANVAS_WIDTH / imgAspect;
        dy = (CANVAS_HEIGHT - dh) / 2;
      }
      context.drawImage(bgImageObj, dx, dy, dw, dh);
      context.restore();
    }

    /* Grid overlay */
    context.save();
    context.globalAlpha = 0.22;
    context.strokeStyle = "rgba(255,255,255,0.07)";
    context.lineWidth = 1;
    for (let x = 0; x <= CANVAS_WIDTH; x += 96) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, CANVAS_HEIGHT); context.stroke();
    }
    for (let y = 0; y <= CANVAS_HEIGHT; y += 96) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(CANVAS_WIDTH, y); context.stroke();
    }
    context.restore();
  }

  /* ── Fade factors ── */
  const panelIn = fade ? easeOutCubic(progress / 0.16) : 1;
  const panelYOffset = fade ? (1 - panelIn) * 42 : 0;

  /* ── Panel ── */
  context.save();
  if (fade) {
    context.globalAlpha = panelIn;
    context.translate(0, panelYOffset);
  }
  context.shadowColor = "rgba(0,0,0,0.45)";
  context.shadowBlur = 70;
  context.shadowOffsetY = 28;
  roundedRect(context, layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight, 8);
  context.fillStyle = state.panel;
  context.fill();
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.strokeStyle = "rgba(255,255,255,0.14)";
  roundedRect(context, layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight, 8);
  context.stroke();

  /* ── Grid lines ── */
  context.strokeStyle = state.grid;
  context.lineWidth = 1;
  for (const tick of [0, 25, 50, 75, 100]) {
    const x = barX + layout.barColumnWidth * (tick / 100);
    context.beginPath(); context.moveTo(x, contentTop); context.lineTo(x, contentTop + gridHeight); context.stroke();
  }

  /* ── X-axis numbers ── */
  context.font = `600 16px Inter, Segoe UI, Arial, sans-serif`;
  context.fillStyle = "#777";
  context.textAlign = "center";
  const xAxisY = contentTop + gridHeight + 22;
  for (const tick of [0, 25, 50, 75, 100]) {
    const x = barX + layout.barColumnWidth * (tick / 100);
    context.fillText(`${tick}`, x, xAxisY);
  }
  context.textAlign = "start";

  /* ── Legend ── */
  state.models.forEach((model, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = barX + col * 260;
    const y = layout.panelY + layout.paddingY + row * 38;
    roundedRect(context, x, y + 4, 24, 14, 2);
    context.fillStyle = model.color;
    context.fill();
    drawFittedText(context, model.name, x + 36, y + 18, 210, 18, "700", "#b7b7b7");
  });

  /* ── Rows ── */
  state.benchmarks.forEach((benchmark, rowIndex) => {
    const rowProgress = Math.max(0, Math.min(1, easeOutCubic((progress - 0.06 - rowIndex * 0.05) / 0.25)));
    const rowY = contentTop + rowIndex * (layout.rowHeight + layout.rowGap);
    const labelY = rowY + layout.rowHeight * 0.34;
    const barsTop = rowY + layout.rowHeight * 0.18;

    /* Labels */
    if (fade) {
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, rowProgress * 1.5));
    }
    drawFittedText(context, benchmark.label, layout.panelX + layout.paddingX, labelY, layout.labelColumn - 20, layout.labelFont, "780", "#f3f3f3");
    drawFittedText(context, benchmark.detail, layout.panelX + layout.paddingX, labelY + layout.detailFont + 10, layout.labelColumn - 20, layout.detailFont, "400", "#a2a2a2");
    if (fade) context.restore();

    /* Find the highest score in this category */
    let highestValue = 0;
    for (const m of state.models) {
      const v = benchmark.scores[m.id] ?? 0;
      if (v > highestValue) highestValue = v;
    }

    state.models.forEach((model, modelIndex) => {
      const rawValue = benchmark.scores[model.id] ?? 0;
      const barPercent = Math.min(100, rawValue);
      const y = barsTop + modelIndex * (layout.barHeight + layout.barGap);
      const fullBarWidth = layout.barColumnWidth * (barPercent / 100);
      const animatedWidth = fullBarWidth * rowProgress;

      /* Empty bar track */
      if (fade) {
        context.save();
        context.globalAlpha = Math.max(0, Math.min(1, rowProgress * 1.5));
      }
      roundedRect(context, barX, y, layout.barColumnWidth, layout.barHeight, 4);
      context.fillStyle = "rgba(255,255,255,0.055)";
      context.fill();
      if (fade) context.restore();

      /* Filled bar */
      if (animatedWidth > 0) {
        roundedRect(context, barX, y, animatedWidth, layout.barHeight, 4);
        context.fillStyle = model.color;
        context.fill();
      }

      /* Value label for each bar */
      if (rowProgress > 0.05) {
        const displayValue = (rawValue * rowProgress).toFixed(1);
        const isHighest = rawValue === highestValue;
        context.save();
        context.globalAlpha = Math.min(1, rowProgress * 2);
        drawFittedText(
          context,
          `${displayValue}%`,
          valueX,
          y + layout.barHeight * 0.75,
          layout.valueColumn,
          isHighest ? layout.valueFont + 2 : layout.valueFont,
          isHighest ? "780" : "500",
          isHighest ? "#f1f1f1" : "#6b7280",
        );
        context.restore();
      }
    });
  });

  context.restore();
}

/* ─── SVG export ─── */
function chartSvg() {
  const layout = getLayout();
  const barX = layout.panelX + layout.paddingX + layout.labelColumn + layout.columnGap;
  const contentTop = layout.panelY + layout.paddingY + layout.legendHeight + layout.legendGap;
  const gridHeight = layout.panelHeight - layout.paddingY * 2 - layout.legendHeight - layout.legendGap - layout.xAxisHeight;
  const background = state.transparent ? "" :
    `<rect width="${layout.width}" height="${layout.height}" fill="${state.background}" />
     <g opacity="0.28"><path d="M0 0H1920V1080H0Z" fill="url(#bgGrid)" /></g>`;

  const legend = state.models.map((model, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = barX + col * 260, y = layout.panelY + layout.paddingY + row * 38;
    return `<g transform="translate(${x} ${y})"><rect x="0" y="4" width="24" height="14" rx="2" fill="${model.color}" /><text x="36" y="17" fill="#b7b7b7" font-size="18" font-weight="700">${escapeHtml(model.name)}</text></g>`;
  }).join("");

  const grid = [0, 25, 50, 75, 100].map((t) => {
    const x = barX + layout.barColumnWidth * (t / 100);
    return `<line x1="${x}" x2="${x}" y1="${contentTop}" y2="${contentTop + gridHeight}" stroke="${state.grid}" />`;
  }).join("");

  const xAxisY = contentTop + gridHeight + 22;
  const xAxisLabels = [0, 25, 50, 75, 100].map((t) => {
    const x = barX + layout.barColumnWidth * (t / 100);
    return `<text x="${x}" y="${xAxisY}" fill="#777" font-size="16" font-weight="600" text-anchor="middle">${t}</text>`;
  }).join("");

  const rows = state.benchmarks.map((benchmark, ri) => {
    const rowY = contentTop + ri * (layout.rowHeight + layout.rowGap);
    const labelY = rowY + layout.rowHeight * 0.34;
    const barsTop = rowY + layout.rowHeight * 0.18;

    let highestValue = 0;
    for (const m of state.models) {
      const v = benchmark.scores[m.id] ?? 0;
      if (v > highestValue) highestValue = v;
    }

    const bars = state.models.map((model, mi) => {
      const rawValue = benchmark.scores[model.id] ?? 0;
      const barPercent = Math.min(100, rawValue);
      const y = barsTop + mi * (layout.barHeight + layout.barGap);
      const width = layout.barColumnWidth * (barPercent / 100);
      const isHighest = rawValue === highestValue;
      const vx = barX + layout.barColumnWidth + layout.columnGap;
      return `
        <rect x="${barX}" y="${y}" width="${layout.barColumnWidth}" height="${layout.barHeight}" rx="4" fill="rgba(255,255,255,0.055)" />
        <rect x="${barX}" y="${y}" width="${width}" height="${layout.barHeight}" rx="4" fill="${model.color}" />
        <text x="${vx}" y="${y + layout.barHeight * 0.75}" fill="${isHighest ? '#f1f1f1' : '#6b7280'}" font-size="${isHighest ? layout.valueFont + 2 : layout.valueFont}" font-weight="${isHighest ? '780' : '500'}">${rawValue.toFixed(1)}%</text>`;
    }).join("");

    return `<g>
      <text x="${layout.panelX + layout.paddingX}" y="${labelY}" fill="#f3f3f3" font-size="${layout.labelFont}" font-weight="780">${escapeHtml(benchmark.label)}</text>
      <text x="${layout.panelX + layout.paddingX}" y="${labelY + layout.detailFont + 10}" fill="#a2a2a2" font-size="${layout.detailFont}">${escapeHtml(benchmark.detail)}</text>
      ${bars}
    </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">
    <defs><pattern id="bgGrid" width="96" height="96" patternUnits="userSpaceOnUse"><path d="M96 0H0V96" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1" /></pattern></defs>
    ${background}
    <rect x="${layout.panelX}" y="${layout.panelY}" width="${layout.panelWidth}" height="${layout.panelHeight}" rx="8" fill="${state.panel}" stroke="rgba(255,255,255,0.14)" />
    ${grid} ${xAxisLabels} ${legend} ${rows}
  </svg>`;
}

/* ─── Render ─── */
function renderChart() { drawChartFrame(previewCanvas, currentProgress); }

function renderApp() {
  backgroundColorInput.value = state.background;
  durationInput.value = state.durationSeconds;
  transparentInput.checked = state.transparent;
  animateFadeInput.checked = state.animateFade;
  renderModelEditors();
  renderBenchmarkEditors();
  renderChart();
}

/* ─── Transport ─── */
let isRendering = false;  // true during video export

function updateTimeline() {
  const slider = $("#timeline-slider");
  const timeDisplay = $("#time-display");
  if (slider) slider.value = currentProgress;
  if (timeDisplay) {
    const secs = (currentProgress * state.durationSeconds).toFixed(1);
    timeDisplay.textContent = `${secs}s / ${state.durationSeconds}s`;
  }
}

function setButtonIcon(iconType) {
  const btn = $("#play-animation");
  if (!btn) return;
  const icons = {
    play: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>`,
    loading: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon"><path d="M12 2a10 10 0 0 1 10 10"/></svg>`,
  };
  btn.innerHTML = icons[iconType] || icons.play;
}

function forceStopAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  isPlaying = false;
  playStartTime = null;
  playStartProgress = null;
}

function stopPlayback() {
  forceStopAnimation();
  setButtonIcon('play');
}

function startPlayback() {
  /* Always force-cancel anything running first */
  forceStopAnimation();

  /* If at or near the end, restart from beginning */
  if (currentProgress >= 0.98) {
    currentProgress = 0;
  }

  isPlaying = true;
  playStartTime = performance.now();
  playStartProgress = currentProgress;
  setButtonIcon('pause');

  /* Render the first frame immediately so button click is instantly visible */
  drawChartFrame(previewCanvas, currentProgress);
  updateTimeline();

  const duration = state.durationSeconds * 1000;

  const tick = (time) => {
    if (!isPlaying) return;
    const elapsed = time - playStartTime;
    currentProgress = Math.min(1, playStartProgress + elapsed / duration);
    drawChartFrame(previewCanvas, currentProgress);
    updateTimeline();
    if (currentProgress < 1) {
      animationFrameId = requestAnimationFrame(tick);
    } else {
      /* Animation finished naturally */
      currentProgress = 1;
      isPlaying = false;
      animationFrameId = null;
      playStartTime = null;
      playStartProgress = null;
      setButtonIcon('play');
      updateTimeline();
    }
  };

  animationFrameId = requestAnimationFrame(tick);
}

function togglePlayback() {
  if (isRendering) return; // don't interfere during video export
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function skipForward() {
  stopPlayback();
  currentProgress = Math.min(1, currentProgress + 1 / state.durationSeconds);
  renderChart(); updateTimeline();
}

function skipBackward() {
  stopPlayback();
  currentProgress = Math.max(0, currentProgress - 1 / state.durationSeconds);
  renderChart(); updateTimeline();
}

function scrubTo(value) {
  stopPlayback();
  currentProgress = Math.max(0, Math.min(1, value));
  renderChart(); updateTimeline();
}

/* ─── Export ─── */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

function exportSvg() { downloadBlob(new Blob([chartSvg()], {type: "image/svg+xml"}), "chart.svg"); }

function exportPng() {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH; canvas.height = CANVAS_HEIGHT;
  drawChartFrame(canvas, 1);
  canvas.toBlob((blob) => { if (blob) downloadBlob(blob, "chart-1920x1080.png"); }, "image/png");
}

function exportVideo() {
  forceStopAnimation();
  isRendering = true;
  setButtonIcon('loading');

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH; canvas.height = CANVAS_HEIGHT;
  const durationMs = state.durationSeconds * 1000;
  const stream = canvas.captureStream(60);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    isRendering = false;
    setButtonIcon('play');
    downloadBlob(new Blob(chunks, {type: mimeType}), "chart-1920x1080.webm");
  };
  recorder.start();
  const start = performance.now();
  const tick = (time) => {
    const p = Math.min(1, (time - start) / durationMs);
    drawChartFrame(canvas, p); drawChartFrame(previewCanvas, p);
    currentProgress = p; updateTimeline();
    if (p < 1) requestAnimationFrame(tick);
    else setTimeout(() => recorder.stop(), 250);
  };
  requestAnimationFrame(tick);
}

/* ═══════════════════════════════════════════
   Events
   ═══════════════════════════════════════════ */
document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.id === "background-color") {
    updateState((d) => { d.background = target.value; });
    return;
  }
  if (target.id === "duration-seconds") {
    updateState((d) => { d.durationSeconds = Math.max(3, Math.min(30, Number.parseInt(target.value, 10) || 12)); });
    return;
  }
  if (target.id === "transparent-background") {
    updateState((d) => { d.transparent = target.checked; });
    return;
  }
  if (target.id === "animate-fade") {
    state.animateFade = target.checked;
    saveState();
    renderChart();
    return;
  }
  if (target.id === "timeline-slider") {
    scrubTo(parseFloat(target.value));
    return;
  }

  /* Series name */
  const modelName = target.dataset.modelName;
  if (modelName) {
    const m = state.models.find((i) => i.id === modelName);
    if (m) {
      m.name = target.value;
      /* Update card header in Series section */
      const card = target.closest(".editor-card");
      if (card) card.querySelector(".row-actions strong").textContent = target.value;
      /* Update score labels in ALL category cards that reference this model */
      document.querySelectorAll(`[data-score-model="${modelName}"]`).forEach((input) => {
        const row = input.closest(".score-row");
        if (row) {
          const span = row.querySelector("span");
          if (span) span.textContent = target.value;
        }
      });
      saveState(); renderChart();
    }
    return;
  }

  /* Series color (hex) */
  const modelColor = target.dataset.modelColor;
  if (modelColor) {
    const normalized = normalizeHex(target.value);
    if (normalized) {
      const m = state.models.find((i) => i.id === modelColor);
      if (m) {
        m.color = normalized;
        const container = target.closest(".hex-color-input");
        const swatch = container?.querySelector(".color-swatch");
        const picker = container?.querySelector(".hidden-color-picker");
        if (swatch) swatch.style.background = normalized;
        if (picker) picker.value = normalized;
        saveState(); renderChart();
      }
    }
    return;
  }

  /* Hidden color picker */
  const colorPicker = target.dataset.colorPicker;
  if (colorPicker) {
    const m = state.models.find((i) => i.id === colorPicker);
    if (m) {
      m.color = target.value;
      const container = target.closest(".hex-color-input");
      const swatch = container?.querySelector(".color-swatch");
      const hexInput = container?.querySelector("[data-model-color]");
      if (swatch) swatch.style.background = target.value;
      if (hexInput) hexInput.value = target.value;
      saveState(); renderChart();
    }
    return;
  }

  /* Category label */
  const benchmarkLabel = target.dataset.benchmarkLabel;
  if (benchmarkLabel) {
    const b = state.benchmarks.find((i) => i.id === benchmarkLabel);
    if (b) {
      b.label = target.value;
      const card = target.closest(".editor-card");
      if (card) card.querySelector(".row-actions strong").textContent = target.value;
      saveState(); renderChart();
    }
    return;
  }

  /* Category detail */
  const benchmarkDetail = target.dataset.benchmarkDetail;
  if (benchmarkDetail) {
    const b = state.benchmarks.find((i) => i.id === benchmarkDetail);
    if (b) { b.detail = target.value; saveState(); renderChart(); }
    return;
  }

  /* Scores */
  const scoreBenchmark = target.dataset.scoreBenchmark;
  const scoreModel = target.dataset.scoreModel;
  if (scoreBenchmark && scoreModel) {
    const b = state.benchmarks.find((i) => i.id === scoreBenchmark);
    if (b) { b.scores[scoreModel] = normalizeScore(target.value); saveState(); renderChart(); }
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest("button");

  if (target.id === "add-model" || btn?.id === "add-model") { addModel(); return; }
  if (target.id === "add-benchmark" || btn?.id === "add-benchmark") { addBenchmark(); return; }
  if (target.id === "reset-data" || btn?.id === "reset-data") {
    updateState((d) => { Object.assign(d, structuredClone(defaultState)); });
    loadBackgroundImage();
    return;
  }
  if (target.id === "export-png" || btn?.id === "export-png") { exportPng(); return; }
  if (target.id === "play-animation" || btn?.id === "play-animation") { togglePlayback(); return; }
  if (target.id === "skip-forward" || btn?.id === "skip-forward") { skipForward(); return; }
  if (target.id === "skip-backward" || btn?.id === "skip-backward") { skipBackward(); return; }
  if (target.id === "export-video" || btn?.id === "export-video") { exportVideo(); return; }
  if (target.id === "export-svg" || btn?.id === "export-svg") { exportSvg(); return; }
  if (target.id === "bg-image-clear" || btn?.id === "bg-image-clear") {
    state.backgroundImage = null;
    bgImageObj = null;
    const fileInput = $("#bg-image-upload");
    if (fileInput) fileInput.value = "";
    saveState(); renderChart();
    return;
  }

  const removeEl = target.closest("[data-remove-model]");
  if (removeEl) { removeModel(removeEl.dataset.removeModel); return; }

  const removeBenchEl = target.closest("[data-remove-benchmark]");
  if (removeBenchEl) { removeBenchmark(removeBenchEl.dataset.removeBenchmark); return; }

  const swatch = target.closest(".color-swatch");
  if (swatch) {
    const modelId = swatch.dataset.swatchFor;
    if (modelId) {
      const picker = swatch.closest(".hex-color-input")?.querySelector(".hidden-color-picker");
      if (picker) picker.click();
    }
    return;
  }
});

/* Background image upload */
document.addEventListener("change", (event) => {
  if (event.target.id === "bg-image-upload") {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.backgroundImage = reader.result;
      saveState();
      loadBackgroundImage();
    };
    reader.readAsDataURL(file);
  }
});

/* ─── Init ─── */
renderApp();
updateTimeline();
loadBackgroundImage();
