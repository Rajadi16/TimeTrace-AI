(() => {
  const vscode = window.__timetraceApi;

  const scenarios = [
    {
      name: "API Timeout",
      nodes: ["normal", "warning", "error"],
      error: { type: "TimeoutException", line: "142", time: "14:32:45" },
      latencyTrace: [86, 90, 92, 98, 108, 142, 186, 254, 298],
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
        problemLine: 2
      },
      impactFlow: ["API", "DB", "Cache"],
      failingNode: "API",
      analysis: {
        summary: "Requests exceeded max response threshold during peak load.",
        rootCause: "No timeout or retry strategy on downstream network operations.",
        impact: "Hung requests saturated worker threads and delayed cache refresh."
      }
    },
    {
      name: "Connection Drift",
      nodes: ["normal", "warning", "error"],
      error: { type: "DBConnectionError", line: "88", time: "09:11:09" },
      latencyTrace: [68, 70, 74, 88, 107, 129, 171, 205, 236],
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
        problemLine: 3
      },
      impactFlow: ["API", "DB", "Cache"],
      failingNode: "DB",
      analysis: {
        summary: "Write latency climbed as available DB connections dropped.",
        rootCause: "Missing release logic in exception paths exhausted pool capacity.",
        impact: "Read operations fell back to stale cache and user-facing updates stalled."
      }
    },
    {
      name: "Cache Poison",
      nodes: ["normal", "warning", "error"],
      error: { type: "SerializationFault", line: "57", time: "21:07:12" },
      latencyTrace: [52, 55, 62, 71, 93, 116, 149, 212, 248],
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
        problemLine: 2
      },
      impactFlow: ["API", "DB", "Cache"],
      failingNode: "Cache",
      analysis: {
        summary: "Corrupted serialized data propagated to UI rendering path.",
        rootCause: "No schema guard before cache write allowed malformed objects.",
        impact: "Repeated front-end failures and fallback traffic hit API retries."
      }
    }
  ];

  const elements = {
    scenarioSelect: document.getElementById("scenario-select"),
    timelineNodes: document.getElementById("timeline-nodes"),
    timelineProgress: document.getElementById("timeline-progress"),
    scrubber: document.getElementById("scrubber"),
    errorType: document.getElementById("error-type"),
    errorLine: document.getElementById("error-line"),
    errorTime: document.getElementById("error-time"),
    rootCard: document.getElementById("root-cause-card"),
    rootText: document.getElementById("root-cause-text"),
    codeWindow: document.getElementById("code-window"),
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

  const state = {
    scenarioIndex: 0,
    stage: 0,
    codeState: "before",
    replayTimer: undefined,
    theme: "auto",
    replaySpeed: "normal",
    typography: "mono"
  };

  const replayDurations = {
    slow: 960,
    normal: 680,
    fast: 380
  };

  function init() {
    scenarios.forEach((scenario, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = scenario.name;
      elements.scenarioSelect.appendChild(option);
    });

    attachListeners();
    setupRevealAnimations();
    updateUI(true);
  }

  function attachListeners() {
    elements.scenarioSelect.addEventListener("change", (event) => {
      state.scenarioIndex = Number(event.target.value);
      state.stage = 0;
      state.codeState = "before";
      updateUI(true);
    });

    elements.scrubber.addEventListener("input", () => {
      state.stage = Number(elements.scrubber.value);
      updateUI(false);
    });

    elements.beforeTab.addEventListener("click", () => {
      state.codeState = "before";
      updateCode();
      setCodeToggle();
    });

    elements.afterTab.addEventListener("click", () => {
      state.codeState = "after";
      updateCode();
      setCodeToggle();
    });

    elements.jumpRoot.addEventListener("click", () => {
      const isError = state.stage === 2;
      if (!isError) {
        state.stage = 2;
        updateUI(false);
      }
      elements.rootCard.scrollIntoView({ behavior: "smooth", block: "center" });
      vscode.postMessage({ type: "jumpToRootCause" });
    });

    elements.previousBtn.addEventListener("click", () => shiftStage(-1));
    elements.nextBtn.addEventListener("click", () => shiftStage(1));
    elements.replayBtn.addEventListener("click", replayTimeline);
    elements.timelineReplay.addEventListener("click", replayTimeline);
    elements.replaySpeed.addEventListener("change", (event) => {
      state.replaySpeed = event.target.value;
    });

    elements.themeToggle.addEventListener("click", cycleTheme);
    elements.fontToggle.addEventListener("click", cycleTypography);

    document.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        shiftStage(-1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        shiftStage(1);
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

  function shiftStage(delta) {
    state.stage = Math.max(0, Math.min(2, state.stage + delta));
    updateUI(false);
  }

  function replayTimeline() {
    clearInterval(state.replayTimer);
    elements.panel.classList.add("motion-blur");
    elements.timelineWrap.classList.add("replaying");
    state.stage = 0;
    updateUI(false);

    state.replayTimer = setInterval(() => {
      if (state.stage >= 2) {
        clearInterval(state.replayTimer);
        elements.panel.classList.remove("motion-blur");
        elements.timelineWrap.classList.remove("replaying");
        return;
      }
      state.stage += 1;
      updateUI(false);
    }, replayDurations[state.replaySpeed]);
  }

  function updateUI(skipTypingAnimation) {
    const scenario = scenarios[state.scenarioIndex];
    elements.scrubber.value = String(state.stage);
    renderTimelineNodes(scenario.nodes);
    updateTimelineProgress();
    updateErrorDetails(scenario);
    updateRootCause(scenario);
    updateCode();
    setCodeToggle();
    updateImpactFlow(scenario);
    updateLatencyChart(scenario);
    updateAnalysis(scenario, skipTypingAnimation);
  }

  function renderTimelineNodes(nodeTypes) {
    elements.timelineNodes.innerHTML = "";
    nodeTypes.forEach((type, index) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = `node ${type} ${index === state.stage ? "active" : ""}`;
      node.setAttribute("aria-label", `Timeline node ${index + 1}: ${type}`);
      node.addEventListener("click", () => {
        state.stage = index;
        updateUI(false);
      });
      elements.timelineNodes.appendChild(node);
    });
  }

  function updateTimelineProgress() {
    const progressRatio = state.stage / 2;
    elements.timelineProgress.style.width = `${progressRatio * 100}%`;
  }

  function updateErrorDetails(scenario) {
    const states = [
      {
        type: "NominalState",
        line: "-",
        time: scenario.error.time
      },
      {
        type: "EarlyWarning",
        line: scenario.error.line,
        time: scenario.error.time
      },
      scenario.error
    ];
    const details = states[state.stage];
    elements.errorType.textContent = details.type;
    elements.errorLine.textContent = details.line;
    elements.errorTime.textContent = details.time;
  }

  function updateRootCause(scenario) {
    const isErrorState = state.stage === 2;
    if (isErrorState) {
      elements.rootCard.classList.remove("hidden");
      elements.rootText.textContent = scenario.rootCause;
      requestAnimationFrame(() => {
        elements.rootCard.animate(
          [
            { opacity: 0, transform: "translateY(8px) scale(0.98)" },
            { opacity: 1, transform: "translateY(0) scale(1)" }
          ],
          { duration: 320, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" }
        );
      });
    } else {
      elements.rootCard.classList.add("hidden");
    }
  }

  function updateCode() {
    const { code } = scenarios[state.scenarioIndex];
    const lines = code[state.codeState];
    const escaped = lines
      .map((line, index) => {
        const lineClass = index + 1 === code.problemLine ? "code-line problem" : "code-line";
        return `<div class="${lineClass}"><span class="code-line-number">${index + 1}</span><span>${escapeHtml(line)}</span></div>`;
      })
      .join("");

    elements.codeWindow.innerHTML = escaped;
  }

  function setCodeToggle() {
    const beforeActive = state.codeState === "before";
    elements.beforeTab.classList.toggle("active", beforeActive);
    elements.afterTab.classList.toggle("active", !beforeActive);
  }

  function updateImpactFlow(scenario) {
    elements.flow.innerHTML = "";
    scenario.impactFlow.forEach((node, index) => {
      const nodeElement = document.createElement("div");
      nodeElement.className = `flow-node ${node === scenario.failingNode && state.stage === 2 ? "failing" : ""}`;
      nodeElement.textContent = node;
      elements.flow.appendChild(nodeElement);

      if (index < scenario.impactFlow.length - 1) {
        const link = document.createElement("span");
        link.className = "flow-link";
        elements.flow.appendChild(link);
      }
    });
  }

  function updateAnalysis(scenario, skipTypingAnimation) {
    const entries = [
      [elements.summary, scenario.analysis.summary],
      [elements.cause, scenario.analysis.rootCause],
      [elements.impact, scenario.analysis.impact]
    ];

    if (skipTypingAnimation) {
      entries.forEach(([element, text]) => {
        element.textContent = text;
      });
      return;
    }

    entries.forEach(([element, text], index) => {
      element.textContent = "";
      const words = text.split(" ");
      words.forEach((word, wordIndex) => {
        setTimeout(() => {
          element.textContent += `${word}${wordIndex < words.length - 1 ? " " : ""}`;
        }, index * 120 + wordIndex * 22);
      });
    });
  }

  function updateLatencyChart(scenario) {
    const points = scenario.latencyTrace;
    const width = 180;
    const height = 54;
    const padding = 6;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = Math.max(1, max - min);

    const coords = points.map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / (points.length - 1);
      const y = height - padding - ((value - min) * (height - padding * 2)) / span;
      return [x, y];
    });

    const path = coords
      .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");

    const stageIndex = state.stage * 4;
    const safeIndex = Math.max(0, Math.min(points.length - 1, stageIndex));
    const [dotX, dotY] = coords[safeIndex];

    elements.sparklinePath.setAttribute("d", path);
    elements.sparklineDot.setAttribute("cx", dotX.toFixed(2));
    elements.sparklineDot.setAttribute("cy", dotY.toFixed(2));
    elements.latencyValue.textContent = `${points[safeIndex]} ms`;
  }

  function cycleTheme() {
    const sequence = ["auto", "dark", "light"];
    const currentIndex = sequence.indexOf(state.theme);
    state.theme = sequence[(currentIndex + 1) % sequence.length];

    document.body.classList.remove("theme-auto", "theme-dark", "theme-light");
    document.body.classList.add(`theme-${state.theme}`);

    if (state.theme === "dark") {
      document.body.classList.remove("vscode-light");
      document.body.classList.add("vscode-dark");
    } else if (state.theme === "light") {
      document.body.classList.remove("vscode-dark");
      document.body.classList.add("vscode-light");
    }

    elements.themeToggle.textContent = state.theme[0].toUpperCase() + state.theme.slice(1);
  }

  function cycleTypography() {
    state.typography = state.typography === "mono" ? "elegant" : "mono";
    document.body.classList.toggle("typography-elegant", state.typography === "elegant");
    elements.fontToggle.textContent = state.typography === "mono" ? "Mono" : "Elegant";
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
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  init();
})();
