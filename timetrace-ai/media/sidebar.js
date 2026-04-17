(() => {
  const vscode = window.__timetraceApi;

  const demoScenarios = [
    {
      name: "API Timeout",
      rootCause: "Missing timeout and cancellation path in network fetch caused blocking requests.",
      code: {
        before: [
          "async function fetchData(url) {",
          "  const response = await fetch(url);",
          "  return response.json();",
          "}"
        ],
        after: [
          "async function fetchData(url) {",
          "  const c = new AbortController();",
          "  const t = setTimeout(() => c.abort(), 5000);",
          "  const response = await fetch(url, { signal: c.signal });"
        ],
        focusLine: 2
      },
      changedLineRanges: [[2, 4]],
      analysis: {
        summary: "Requests exceeded max response threshold during peak load.",
        rootCause: "No timeout or retry strategy on downstream network operations.",
        impact: "Hung requests saturated worker threads and delayed cache refresh."
      }
    },
    {
      name: "Connection Drift",
      rootCause: "Connection pool leak left stale sockets unreleased under retry loops.",
      code: {
        before: [
          "for (const job of queue) {",
          "  const conn = await pool.getConnection();",
          "  await conn.query(job.sql);",
          "}"
        ],
        after: [
          "for (const job of queue) {",
          "  const conn = await pool.getConnection();",
          "  try { await conn.query(job.sql); }",
          "  finally { conn.release(); }"
        ],
        focusLine: 3
      },
      changedLineRanges: [[2, 4]],
      analysis: {
        summary: "Write latency climbed as available DB connections dropped.",
        rootCause: "Missing release logic in exception paths exhausted pool capacity.",
        impact: "Read operations fell back to stale cache and user-facing updates stalled."
      }
    },
    {
      name: "Cache Poison",
      rootCause: "Invalid payload shape was cached without schema validation.",
      code: {
        before: [
          "const payload = JSON.parse(raw);",
          "cache.set(key, payload);",
          "render(payload.user.name);",
          "return payload;"
        ],
        after: [
          "const payload = validate(JSON.parse(raw));",
          "if (!payload.ok) throw new Error('invalid payload');",
          "cache.set(key, payload.value);",
          "return payload.value;"
        ],
        focusLine: 2
      },
      changedLineRanges: [[1, 4]],
      analysis: {
        summary: "Corrupted serialized data propagated to UI rendering path.",
        rootCause: "No schema guard before cache write allowed malformed objects.",
        impact: "Repeated front-end failures and fallback traffic hit API retries."
      }
    }
  ];

  const replayDurations = {
    slow: 960,
    normal: 680,
    fast: 380
  };

  const elements = {
    scenarioRow: document.getElementById("scenario-row"),
    scenarioSelect: document.getElementById("scenario-select"),
    timelineSource: document.getElementById("timeline-source"),
    timelineCount: document.getElementById("timeline-count"),
    timelineEmpty: document.getElementById("timeline-empty"),
    timelineNodes: document.getElementById("timeline-nodes"),
    timelineProgress: document.getElementById("timeline-progress"),
    scrubber: document.getElementById("scrubber"),
    errorType: document.getElementById("error-type"),
    errorLine: document.getElementById("error-line"),
    errorTime: document.getElementById("error-time"),
    stateBadge: document.getElementById("state-badge"),
    checkpointTimestamp: document.getElementById("checkpoint-timestamp"),
    rootCard: document.getElementById("root-cause-card"),
    rootText: document.getElementById("root-cause-text"),
    codeWindow: document.getElementById("code-window"),
    changedLines: document.getElementById("changed-lines"),
    beforeTab: document.getElementById("before-tab"),
    afterTab: document.getElementById("after-tab"),
    flow: document.getElementById("impact-flow"),
    summary: document.getElementById("analysis-summary"),
    cause: document.getElementById("analysis-cause"),
    impact: document.getElementById("analysis-impact"),
    jumpRoot: document.getElementById("jump-root"),
    replayBtn: document.getElementById("replay"),
    timelineReplay: document.getElementById("timeline-replay"),
    replaySpeed: document.getElementById("replay-speed"),
    previousBtn: document.getElementById("previous"),
    nextBtn: document.getElementById("next"),
    themeToggle: document.getElementById("theme-toggle"),
    fontToggle: document.getElementById("font-toggle"),
    timelineWrap: document.getElementById("timeline-wrap"),
    sparklinePath: document.getElementById("sparkline-path"),
    sparklineDot: document.getElementById("sparkline-dot"),
    latencyValue: document.getElementById("latency-value"),
    panel: document.querySelector(".panel"),
    hero: document.getElementById("timeline-section")
  };

  const appState = {
    mode: "demo",
    demoScenarioIndex: 0,
    demoEntries: [],
    liveEntries: [],
    selectedIndex: 0,
    codeState: "before",
    replayTimer: undefined,
    theme: "auto",
    replaySpeed: "normal",
    typography: "mono",
    sourceLabel: "Demo mode"
  };

  function init() {
    demoScenarios.forEach((scenario, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = scenario.name;
      elements.scenarioSelect.appendChild(option);
    });

    appState.demoEntries = buildDemoTimeline(demoScenarios[0]);
    appState.selectedIndex = appState.demoEntries.length - 1;

    window.addEventListener("message", (event) => {
      handleExtensionMessage(event.data);
    });

    attachListeners();
    setupRevealAnimations();
    applyThemeClasses();
    updateView({ animateText: false });
  }

  function attachListeners() {
    elements.scenarioSelect.addEventListener("change", (event) => {
      setDemoScenario(Number(event.target.value));
    });

    elements.scrubber.addEventListener("input", () => {
      selectCheckpoint(Number(elements.scrubber.value), { stopReplay: true });
    });

    elements.beforeTab.addEventListener("click", () => {
      appState.codeState = "before";
      updateCode(getSelectedEntry());
      setCodeToggle();
    });

    elements.afterTab.addEventListener("click", () => {
      appState.codeState = "after";
      updateCode(getSelectedEntry());
      setCodeToggle();
    });

    elements.jumpRoot.addEventListener("click", () => {
      const selected = getSelectedEntry();
      if (!selected) {
        return;
      }

      if (selected.state !== "ERROR") {
        const lastErrorIndex = getActiveEntries().findIndex((entry) => entry.state === "ERROR");
        if (lastErrorIndex >= 0) {
          selectCheckpoint(lastErrorIndex, { stopReplay: true });
        }
      }

      elements.rootCard.scrollIntoView({ behavior: "smooth", block: "center" });
      vscode.postMessage({ type: "jumpToRootCause" });
    });

    elements.previousBtn.addEventListener("click", () => shiftCheckpoint(-1));
    elements.nextBtn.addEventListener("click", () => shiftCheckpoint(1));
    elements.replayBtn.addEventListener("click", replayTimeline);
    elements.timelineReplay.addEventListener("click", replayTimeline);

    elements.replaySpeed.addEventListener("change", (event) => {
      appState.replaySpeed = event.target.value;
    });

    elements.themeToggle.addEventListener("click", cycleTheme);
    elements.fontToggle.addEventListener("click", cycleTypography);

    document.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        shiftCheckpoint(-1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        shiftCheckpoint(1);
      }

      if (event.code === "Space") {
        event.preventDefault();
        replayTimeline();
      }
    });

    const rectTarget = elements.hero;
    rectTarget.addEventListener("mousemove", (event) => {
      const rect = rectTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const rotateX = (0.5 - y) * 3;
      const rotateY = (x - 0.5) * 4;
      rectTarget.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    rectTarget.addEventListener("mouseleave", () => {
      rectTarget.style.transform = "rotateX(0deg) rotateY(0deg)";
    });
  }

  function handleExtensionMessage(message) {
    if (!message || (message.type !== "analysisResult" && message.type !== "checkpointTimeline" && message.type !== "historyUpdate")) {
      return;
    }

    const payload = message.payload || message;
    const entries = normalizeHistoryEntries(payload);

    if (!entries.length) {
      renderEmptyLiveState(payload.filePath);
      return;
    }

    appState.mode = "live";
    appState.liveEntries = entries;
    appState.selectedIndex = entries.length - 1;
    appState.codeState = "after";
    appState.sourceLabel = buildSourceLabel(payload.filePath, entries.length);
    appState.replayTimer = clearTimer(appState.replayTimer);
    elements.scenarioRow.classList.add("hidden");
    updateView({ animateText: true });
  }

  function normalizeHistoryEntries(payload) {
    const rawEntries = Array.isArray(payload.timelineHistory)
      ? payload.timelineHistory
      : Array.isArray(payload.history)
        ? payload.history
        : Array.isArray(payload.entries)
          ? payload.entries
          : [];

    if (rawEntries.length > 0) {
      return rawEntries.map((entry, index) => normalizeEntry(entry, index, payload.filePath));
    }

    if (payload.timestamp || payload.state) {
      return [normalizeEntry(payload, 0, payload.filePath)];
    }

    return [];
  }

  function normalizeEntry(rawEntry, index, filePath) {
    const reasons = Array.isArray(rawEntry.reasons)
      ? rawEntry.reasons.filter(Boolean)
      : rawEntry.reason
        ? [String(rawEntry.reason)]
        : [];
    const changedLineRanges = Array.isArray(rawEntry.changedLineRanges)
      ? rawEntry.changedLineRanges
          .map((range) => Array.isArray(range) && range.length >= 2 ? [Number(range[0]), Number(range[1])] : null)
          .filter(Boolean)
      : [];
    const codePreview = rawEntry.codePreview || {};
    const score = Number(rawEntry.score);

    return {
      filePath: rawEntry.filePath || filePath || "",
      timestamp: formatTimestamp(rawEntry.timestamp, index),
      state: normalizeState(rawEntry.state),
      score: Number.isFinite(score) ? score : 0,
      checkpoint: Boolean(rawEntry.checkpoint),
      previousState: normalizeState(rawEntry.previousState || rawEntry.previous || "NORMAL"),
      reasons,
      analysis: normalizeAnalysisText(rawEntry.analysis, reasons),
      changedLineRanges,
      features: rawEntry.features || [],
      codePreview: {
        before: ensureLines(codePreview.before),
        after: ensureLines(codePreview.after),
        focusLine: Number.isFinite(Number(codePreview.focusLine)) ? Number(codePreview.focusLine) : 1
      }
    };
  }

  function buildDemoTimeline(scenario) {
    return [
      {
        timestamp: new Date(Date.now() - 180000).toISOString(),
        state: "NORMAL",
        score: 16,
        checkpoint: false,
        previousState: "NORMAL",
        reasons: ["Baseline snapshot captured."],
        analysis: "System is healthy and no anomaly is present yet.",
        changedLineRanges: [],
        features: ["baseline"],
        codePreview: scenario.code
      },
      {
        timestamp: new Date(Date.now() - 120000).toISOString(),
        state: "WARNING",
        score: 42,
        checkpoint: false,
        previousState: "NORMAL",
        reasons: [scenario.rootCause],
        analysis: "Risk signals are starting to accumulate.",
        changedLineRanges: scenario.changedLineRanges,
        features: ["latency", "retry"],
        codePreview: scenario.code
      },
      {
        timestamp: new Date(Date.now() - 60000).toISOString(),
        state: "WARNING",
        score: 67,
        checkpoint: false,
        previousState: "WARNING",
        reasons: [scenario.analysis.rootCause],
        analysis: scenario.analysis.summary,
        changedLineRanges: scenario.changedLineRanges,
        features: ["impact-growth"],
        codePreview: scenario.code
      },
      {
        timestamp: new Date().toISOString(),
        state: "ERROR",
        score: 91,
        checkpoint: true,
        previousState: "WARNING",
        reasons: [scenario.rootCause, scenario.analysis.rootCause],
        analysis: scenario.analysis.impact,
        changedLineRanges: scenario.changedLineRanges,
        features: ["checkpoint"],
        codePreview: scenario.code
      }
    ];
  }

  function normalizeAnalysisText(analysis, reasons) {
    if (typeof analysis === "string") {
      return analysis;
    }

    if (analysis && typeof analysis === "object") {
      const parts = [analysis.summary, analysis.rootCause, analysis.impact].filter(Boolean).map(String);
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }

    if (reasons.length > 0) {
      return reasons.join("; ");
    }

    return "Checkpoint recorded.";
  }

  function ensureLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return ["// no preview available"];
    }

    return lines.map((line) => String(line));
  }

  function formatTimestamp(timestamp, index) {
    if (!timestamp) {
      return `Checkpoint ${index + 1}`;
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return String(timestamp);
    }

    return parsed.toLocaleString();
  }

  function normalizeState(value) {
    const normalized = String(value || "NORMAL").trim().toUpperCase();
    if (normalized === "WARNING" || normalized === "WARN") {
      return "WARNING";
    }

    if (normalized === "ERROR" || normalized === "CRITICAL" || normalized === "FAIL") {
      return "ERROR";
    }

    return "NORMAL";
  }

  function buildSourceLabel(filePath, count) {
    const fileName = filePath ? filePath.split(/[\\/]/).pop() : "Live file";
    return `${fileName} · ${count} checkpoint${count === 1 ? "" : "s"}`;
  }

  function setDemoScenario(index) {
    appState.mode = "demo";
    appState.demoScenarioIndex = index;
    appState.demoEntries = buildDemoTimeline(demoScenarios[index]);
    appState.selectedIndex = appState.demoEntries.length - 1;
    appState.codeState = "after";
    appState.sourceLabel = "Demo mode";
    appState.replayTimer = clearTimer(appState.replayTimer);
    elements.timelineWrap.classList.remove("replaying");
    elements.panel.classList.remove("motion-blur");
    elements.scenarioRow.classList.remove("hidden");
    updateView({ animateText: false });
  }

  function renderEmptyLiveState(filePath) {
    appState.mode = "live";
    appState.liveEntries = [];
    appState.selectedIndex = 0;
    appState.sourceLabel = buildSourceLabel(filePath || "Live file", 0);
    elements.scenarioRow.classList.add("hidden");
    updateView({ animateText: false });
  }

  function getActiveEntries() {
    return appState.mode === "live" ? appState.liveEntries : appState.demoEntries;
  }

  function getSelectedEntry() {
    const entries = getActiveEntries();
    if (!entries.length) {
      return undefined;
    }

    return entries[Math.max(0, Math.min(entries.length - 1, appState.selectedIndex))];
  }

  function selectCheckpoint(index, options = {}) {
    const entries = getActiveEntries();
    if (!entries.length) {
      return;
    }

    appState.selectedIndex = Math.max(0, Math.min(entries.length - 1, index));
    if (options.stopReplay) {
      appState.replayTimer = clearTimer(appState.replayTimer);
      elements.timelineWrap.classList.remove("replaying");
      elements.panel.classList.remove("motion-blur");
    }

    updateView({ animateText: false });
  }

  function shiftCheckpoint(delta) {
    const entries = getActiveEntries();
    if (!entries.length) {
      return;
    }

    selectCheckpoint(appState.selectedIndex + delta, { stopReplay: true });
  }

  function replayTimeline() {
    const entries = getActiveEntries();
    if (!entries.length) {
      return;
    }

    appState.replayTimer = clearTimer(appState.replayTimer);
    elements.panel.classList.add("motion-blur");
    elements.timelineWrap.classList.add("replaying");
    appState.selectedIndex = 0;
    updateView({ animateText: false });

    let index = 0;
    appState.replayTimer = setInterval(() => {
      if (index >= entries.length - 1) {
        appState.replayTimer = clearTimer(appState.replayTimer);
        elements.panel.classList.remove("motion-blur");
        elements.timelineWrap.classList.remove("replaying");
        return;
      }

      index += 1;
      appState.selectedIndex = index;
      updateView({ animateText: false });
    }, replayDurations[appState.replaySpeed]);
  }

  function clearTimer(timerId) {
    if (timerId) {
      clearInterval(timerId);
    }

    return undefined;
  }

  function updateView({ animateText }) {
    const entries = getActiveEntries();
    const selected = getSelectedEntry();

    elements.timelineSource.textContent = appState.sourceLabel;
    elements.timelineCount.textContent = entries.length ? `${entries.length} checkpoint${entries.length === 1 ? "" : "s"}` : "";
    elements.timelineEmpty.classList.toggle("hidden", entries.length > 0);
    elements.timelineWrap.classList.toggle("hidden", entries.length === 0);

    renderTimelineNodes(entries);
    updateTimelineProgress(entries);

    if (!selected) {
      renderEmptyPanels();
      updateSignalChart([], undefined);
      return;
    }

    updateCheckpointDetails(selected);
    updateCodeImpact(selected);
    updateCode(selected);
    setCodeToggle();
    updateImpactFlow(selected);
    updateSignalChart(entries, selected);
    updateAnalysis(selected, animateText);
  }

  function renderEmptyPanels() {
    elements.stateBadge.textContent = "WAITING";
    elements.stateBadge.className = "state-badge";
    elements.checkpointTimestamp.textContent = "No checkpoint history yet.";
    elements.errorType.textContent = "Waiting for live timeline";
    elements.errorLine.textContent = "-";
    elements.errorTime.textContent = "-";
    elements.rootCard.classList.remove("hidden");
    elements.rootText.textContent = "Save the file again or let the backend publish history to populate the timeline.";
    elements.changedLines.innerHTML = '<span class="impact-chip">No changed lines yet</span>';
    elements.codeWindow.innerHTML = '<div class="code-line"><span class="code-line-number">1</span><span>// waiting for checkpoint data</span></div>';
    elements.summary.textContent = "Awaiting checkpoint history from the extension bridge.";
    elements.cause.textContent = "";
    elements.impact.textContent = "";
    elements.flow.innerHTML = "";
    elements.latencyValue.textContent = "0";
  }

  function renderTimelineNodes(entries) {
    elements.timelineNodes.innerHTML = "";
    if (!entries.length) {
      return;
    }

    entries.forEach((entry, index) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = `node ${stateClass(entry.state)} ${index === appState.selectedIndex ? "active" : ""} ${entry.checkpoint ? "checkpoint" : ""}`;
      node.setAttribute("aria-label", `Checkpoint ${index + 1}: ${entry.state} at ${entry.timestamp}`);
      node.title = `${entry.state} · ${entry.timestamp}`;
      node.textContent = String(index + 1);
      node.addEventListener("click", () => {
        selectCheckpoint(index, { stopReplay: true });
      });
      elements.timelineNodes.appendChild(node);
    });
  }

  function updateTimelineProgress(entries) {
    if (!entries.length) {
      elements.timelineProgress.style.width = "0%";
      return;
    }

    const span = Math.max(1, entries.length - 1);
    const progressRatio = Math.min(1, appState.selectedIndex / span);
    elements.timelineProgress.style.width = `${progressRatio * 100}%`;
  }

  function updateCheckpointDetails(entry) {
    elements.stateBadge.textContent = entry.state;
    elements.stateBadge.className = `state-badge ${stateClass(entry.state)}`;
    elements.checkpointTimestamp.textContent = entry.timestamp;
    elements.errorType.textContent = `${entry.previousState} -> ${entry.state}`;
    elements.errorLine.textContent = formatRanges(entry.changedLineRanges);
    elements.errorTime.textContent = entry.timestamp;
    elements.rootCard.classList.remove("hidden");
    elements.rootText.textContent = entry.reasons.length ? entry.reasons.join("; ") : entry.analysis;
  }

  function updateCodeImpact(entry) {
    const chips = [];
    if (entry.checkpoint) {
      chips.push('<span class="impact-chip active">Checkpoint</span>');
    }

    if (entry.changedLineRanges.length > 0) {
      entry.changedLineRanges.forEach((range) => {
        chips.push(`<span class="impact-chip active">L${range[0]}-${range[1]}</span>`);
      });
    } else {
      chips.push('<span class="impact-chip">No changed lines</span>');
    }

    if (Array.isArray(entry.features) && entry.features.length > 0) {
      entry.features.slice(0, 3).forEach((feature) => {
        chips.push(`<span class="impact-chip">${escapeHtml(String(feature))}</span>`);
      });
    }

    elements.changedLines.innerHTML = chips.join("");
  }

  function updateCode(entry) {
    const lines = appState.codeState === "before" ? entry.codePreview.before : entry.codePreview.after;
    const focusLine = Math.max(1, Number(entry.codePreview.focusLine) || 1);

    elements.codeWindow.innerHTML = lines
      .map((line, index) => {
        const lineNumber = index + 1;
        const lineClass = lineNumber === focusLine ? "code-line problem" : "code-line";
        return `<div class="${lineClass}"><span class="code-line-number">${lineNumber}</span><span>${escapeHtml(line)}</span></div>`;
      })
      .join("");
  }

  function setCodeToggle() {
    const beforeActive = appState.codeState === "before";
    elements.beforeTab.classList.toggle("active", beforeActive);
    elements.afterTab.classList.toggle("active", !beforeActive);
  }

  function updateImpactFlow(entry) {
    const flowNodes = ["API", "DB", "Cache"];
    const failingIndex = entry.state === "ERROR" ? 2 : entry.state === "WARNING" ? 1 : 0;

    elements.flow.innerHTML = "";
    flowNodes.forEach((node, index) => {
      const nodeElement = document.createElement("div");
      nodeElement.className = `flow-node ${index === failingIndex ? "failing" : ""}`;
      nodeElement.textContent = node;
      elements.flow.appendChild(nodeElement);

      if (index < flowNodes.length - 1) {
        const link = document.createElement("span");
        link.className = "flow-link";
        elements.flow.appendChild(link);
      }
    });
  }

  function updateSignalChart(entries, selectedEntry) {
    const values = entries.length > 0 ? entries.map((entry) => entry.score) : [0];
    const width = 180;
    const height = 54;
    const padding = 6;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);

    const coords = values.map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(1, values.length - 1);
      const y = height - padding - ((value - min) * (height - padding * 2)) / span;
      return [x, y];
    });

    const path = coords
      .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");

    const selectedPoint = Math.max(0, Math.min(coords.length - 1, appState.selectedIndex));
    const [dotX, dotY] = coords[selectedPoint];

    elements.sparklinePath.setAttribute("d", path);
    elements.sparklineDot.setAttribute("cx", dotX.toFixed(2));
    elements.sparklineDot.setAttribute("cy", dotY.toFixed(2));
    elements.latencyValue.textContent = selectedEntry ? `${selectedEntry.score}` : "0";
  }

  function updateAnalysis(entry, animateText) {
    const summary = entry.analysis;
    const cause = entry.reasons.length ? entry.reasons.join("; ") : "No reasons recorded.";
    const impact = `${entry.checkpoint ? "Checkpoint saved." : "Checkpoint not persisted yet."} Previous state: ${entry.previousState}. Changed lines: ${formatRanges(entry.changedLineRanges)}.`;

    if (!animateText) {
      elements.summary.textContent = summary;
      elements.cause.textContent = cause;
      elements.impact.textContent = impact;
      return;
    }

    typeText(elements.summary, summary, 0);
    typeText(elements.cause, cause, 120);
    typeText(elements.impact, impact, 240);
  }

  function typeText(element, text, delay) {
    element.textContent = "";
    const words = text.split(" ");
    words.forEach((word, index) => {
      setTimeout(() => {
        element.textContent += `${word}${index < words.length - 1 ? " " : ""}`;
      }, delay + index * 22);
    });
  }

  function stateClass(state) {
    const normalized = normalizeState(state);
    return normalized === "WARNING" ? "warning" : normalized === "ERROR" ? "error" : "normal";
  }

  function formatRanges(ranges) {
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return "-";
    }

    return ranges
      .map((range) => {
        if (!Array.isArray(range) || range.length < 2) {
          return "-";
        }

        return `L${range[0]}-${range[1]}`;
      })
      .filter((value) => value !== "-")
      .join(", ");
  }

  function cycleTheme() {
    const sequence = ["auto", "dark", "light"];
    const currentIndex = sequence.indexOf(appState.theme);
    appState.theme = sequence[(currentIndex + 1) % sequence.length];
    applyThemeClasses();
    elements.themeToggle.textContent = appState.theme[0].toUpperCase() + appState.theme.slice(1);
  }

  function applyThemeClasses() {
    document.body.classList.remove("theme-auto", "theme-dark", "theme-light");
    document.body.classList.add(`theme-${appState.theme}`);

    if (appState.theme === "dark") {
      document.body.classList.remove("vscode-light");
      document.body.classList.add("vscode-dark");
    } else if (appState.theme === "light") {
      document.body.classList.remove("vscode-dark");
      document.body.classList.add("vscode-light");
    }
  }

  function cycleTypography() {
    appState.typography = appState.typography === "mono" ? "elegant" : "mono";
    document.body.classList.toggle("typography-elegant", appState.typography === "elegant");
    elements.fontToggle.textContent = appState.typography === "mono" ? "Mono" : "Elegant";
  }

  function setupRevealAnimations() {
    const revealElements = Array.from(document.querySelectorAll(".reveal"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
          }
        });
      },
      {
        root: null,
        threshold: 0.15
      }
    );

    revealElements.forEach((element) => observer.observe(element));
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  init();
})();
