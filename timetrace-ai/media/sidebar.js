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
    timelineStamps: document.getElementById("timeline-stamps"),
    headerStatePill: document.getElementById("header-state-pill"),
    headerFile: document.getElementById("header-file"),
    headerCheckpoint: document.getElementById("header-checkpoint"),
    headerScore: document.getElementById("header-score"),
    timelineNodes: document.getElementById("timeline-nodes"),
    timelineProgress: document.getElementById("timeline-progress"),
    timelineInner: document.getElementById("timeline-inner"),
    timelinePlayPause: document.getElementById("timeline-play-pause"),
    timelinePlayPauseIcon: document.getElementById("timeline-play-pause-icon"),
    checkpointState: document.getElementById("checkpoint-state"),
    checkpointScore: document.getElementById("checkpoint-score"),
    checkpointTransition: document.getElementById("checkpoint-transition"),
    checkpointMarker: document.getElementById("checkpoint-marker"),
    checkpointSummary: document.getElementById("checkpoint-summary"),
    checkpointTimestamp: document.getElementById("checkpoint-timestamp"),
    rootCard: document.getElementById("root-cause-card"),
    rootCauseList: document.getElementById("root-cause-list"),
    codeWindow: document.getElementById("code-window"),
    changedLines: document.getElementById("changed-lines"),
    beforeTab: document.getElementById("before-tab"),
    afterTab: document.getElementById("after-tab"),
    findingsList: document.getElementById("findings-list"),
    incidentList: document.getElementById("incident-list"),
    relatedFilesList: document.getElementById("related-files-list"),
    impactedFilesList: document.getElementById("impacted-files-list"),
    summary: document.getElementById("analysis-summary"),
    jumpRoot: document.getElementById("jump-root"),
    replayBtn: document.getElementById("replay"),
    timelineReplay: document.getElementById("timeline-replay"),
    timelineRewind: document.getElementById("timeline-rewind"),
    replaySpeed: document.getElementById("replay-speed"),
    previousBtn: document.getElementById("previous"),
    nextBtn: document.getElementById("next"),
    themeToggle: document.getElementById("theme-toggle"),
    fontToggle: document.getElementById("font-toggle"),
    timelineWrap: document.getElementById("timeline-wrap"),
    sparklinePath: document.getElementById("sparkline-path"),
    sparklineDot: document.getElementById("sparkline-dot"),
    latencyValue: document.getElementById("latency-value"),
    paneButtons: Array.from(document.querySelectorAll(".pane-btn")),
    paneSections: Array.from(document.querySelectorAll("[data-pane]")),
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
    isReplaying: false,
    theme: "auto",
    replaySpeed: "normal",
    typography: "mono",
    sourceLabel: "Demo mode",
    activePane: "overview"
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
    elements.timelinePlayPause.addEventListener("click", toggleReplay);
    elements.timelineRewind.addEventListener("click", () => shiftCheckpoint(-1));

    elements.replaySpeed.addEventListener("change", (event) => {
      appState.replaySpeed = event.target.value;
    });

    elements.timelineWrap.addEventListener("scroll", () => {
      elements.timelineStamps.scrollLeft = elements.timelineWrap.scrollLeft;
    });

    elements.timelineStamps.addEventListener("scroll", () => {
      elements.timelineWrap.scrollLeft = elements.timelineStamps.scrollLeft;
    });

    elements.themeToggle.addEventListener("click", cycleTheme);
    elements.fontToggle.addEventListener("click", cycleTypography);

    elements.paneButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const pane = button.getAttribute("data-pane-target");
        if (!pane) {
          return;
        }
        appState.activePane = pane;
        applyPaneVisibility();
      });
    });

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

    // Intentionally no parallax: production mode favors stable layout.
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
    appState.activePane = "overview";
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
    const findings = Array.isArray(rawEntry.findings)
      ? rawEntry.findings.map((item, findingIndex) => normalizeFinding(item, findingIndex, changedLineRanges, reasons))
      : buildFallbackFindings(reasons, changedLineRanges, rawEntry.analysis);
    const probableRootCauses = Array.isArray(rawEntry.probableRootCauses)
      ? rawEntry.probableRootCauses.map((item, causeIndex) => normalizeRootCause(item, causeIndex, filePath, findings))
      : buildFallbackRootCauses(filePath, reasons, findings);
    const relatedFiles = Array.isArray(rawEntry.relatedFiles)
      ? rawEntry.relatedFiles.map(normalizeFileContext).filter(Boolean)
      : [];
    const impactedFiles = Array.isArray(rawEntry.impactedFiles)
      ? rawEntry.impactedFiles.map(normalizeFileContext).filter(Boolean)
      : [];
    const incidents = Array.isArray(rawEntry.incidents)
      ? rawEntry.incidents.map((item, incidentIndex) => normalizeIncident(item, incidentIndex, filePath, findings, probableRootCauses, score, rawEntry.previousState, rawEntry.state, rawEntry.timestamp, rawEntry.checkpoint))
      : buildFallbackIncidents(filePath, reasons, findings, probableRootCauses, score, rawEntry.previousState, rawEntry.state, rawEntry.timestamp, rawEntry.checkpoint, rawEntry.analysis);

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
      findings,
      probableRootCauses,
      relatedFiles,
      impactedFiles,
      incidents,
      codePreview: {
        before: ensureLines(codePreview.before),
        after: ensureLines(codePreview.after),
        focusLine: Number.isFinite(Number(codePreview.focusLine)) ? Number(codePreview.focusLine) : 1
      }
    };
  }

  function normalizeFinding(rawFinding, index, changedLineRanges, reasons) {
    if (!rawFinding || typeof rawFinding !== "object") {
      return {
        id: `finding-${index + 1}`,
        message: reasons[index] || "Structured finding",
        severity: "WARNING",
        confidence: Math.max(0.42, 0.9 - index * 0.1),
        lineRanges: changedLineRanges.length > 0 ? changedLineRanges : [[1, 1]]
      };
    }

    return {
      id: String(rawFinding.id || `finding-${index + 1}`),
      message: String(rawFinding.message || rawFinding.summary || reasons[index] || "Structured finding"),
      severity: normalizeFindingSeverity(rawFinding.severity),
      confidence: clampConfidence(rawFinding.confidence, 0.86 - index * 0.08),
      lineRanges: normalizeLineRanges(rawFinding.lineRanges, changedLineRanges),
      symbol: rawFinding.symbol ? String(rawFinding.symbol) : undefined
    };
  }

  function buildFallbackFindings(reasons, changedLineRanges, analysis) {
    const source = reasons.length > 0 ? reasons : [normalizeAnalysisText(analysis, reasons)];
    return source.filter(Boolean).map((reason, index) => ({
      id: `finding-${index + 1}`,
      message: reason,
      severity: index === 0 ? "ERROR" : "WARNING",
      confidence: Math.max(0.42, 0.88 - index * 0.08),
      lineRanges: changedLineRanges.length > 0 ? changedLineRanges : [[1, 1]]
    }));
  }

  function normalizeRootCause(rawCause, index, fallbackFilePath, findings) {
    if (!rawCause || typeof rawCause !== "object") {
      return {
        id: `root-cause-${index + 1}`,
        filePath: fallbackFilePath || "",
        reason: "Probable cause",
        confidence: Math.max(0.38, 0.84 - index * 0.1),
        linkedEvidence: findings.slice(0, 2).map((finding) => finding.id)
      };
    }

    return {
      id: String(rawCause.id || `root-cause-${index + 1}`),
      filePath: String(rawCause.filePath || fallbackFilePath || ""),
      reason: String(rawCause.reason || rawCause.message || "Probable cause"),
      confidence: clampConfidence(rawCause.confidence, 0.82 - index * 0.08),
      linkedEvidence: Array.isArray(rawCause.linkedEvidence) ? rawCause.linkedEvidence.map(String) : findings.slice(0, 2).map((finding) => finding.id)
    };
  }

  function buildFallbackRootCauses(filePath, reasons, findings) {
    const source = reasons.length > 0 ? reasons : ["Probable root cause remains under review."];
    return source.slice(0, 4).map((reason, index) => ({
      id: `root-cause-${index + 1}`,
      filePath: filePath || "",
      reason,
      confidence: Math.max(0.36, 0.9 - index * 0.12),
      linkedEvidence: findings.slice(0, Math.max(1, findings.length - index)).map((finding) => finding.id)
    }));
  }

  function normalizeFileContext(rawItem) {
    if (typeof rawItem === "string") {
      const filePathValue = rawItem.trim();
      if (!filePathValue) {
        return undefined;
      }

      return {
        filePath: filePathValue,
        reason: "Contextual file"
      };
    }

    if (!rawItem || typeof rawItem !== "object") {
      return undefined;
    }

    const filePathValue = String(rawItem.filePath || rawItem.path || rawItem.label || "");
    if (!filePathValue) {
      return undefined;
    }

    return {
      filePath: filePathValue,
      reason: String(rawItem.reason || rawItem.summary || "Contextual file")
    };
  }

  function normalizeIncident(rawIncident, index, filePath, findings, probableRootCauses, score, previousState, state, timestamp, checkpoint) {
    if (!rawIncident || typeof rawIncident !== "object") {
      return {
        id: `incident-${index + 1}`,
        summary: "Incident detail",
        status: state === "ERROR" ? "OPEN" : state === "WARNING" ? "WATCHING" : "RESOLVED",
        timelineTrail: buildTrail(timestamp, previousState, state, score, checkpoint),
        surfacedFile: filePath || "",
        linkedFindings: findings.map((finding) => finding.id),
        probableCauses: probableRootCauses.map((cause) => cause.id)
      };
    }

    return {
      id: String(rawIncident.id || `incident-${index + 1}`),
      summary: String(rawIncident.summary || rawIncident.message || "Incident detail"),
      status: normalizeIncidentStatus(rawIncident.status, state),
      timelineTrail: Array.isArray(rawIncident.timelineTrail) && rawIncident.timelineTrail.length > 0
        ? rawIncident.timelineTrail.map(normalizeTimelinePoint).filter(Boolean)
        : buildTrail(timestamp, previousState, state, score, checkpoint),
      surfacedFile: String(rawIncident.surfacedFile || rawIncident.filePath || filePath || ""),
      linkedFindings: Array.isArray(rawIncident.linkedFindings) ? rawIncident.linkedFindings.map(String) : findings.map((finding) => finding.id),
      probableCauses: Array.isArray(rawIncident.probableCauses) ? rawIncident.probableCauses.map(String) : probableRootCauses.map((cause) => cause.id)
    };
  }

  function buildFallbackIncidents(filePath, reasons, findings, probableRootCauses, score, previousState, state, timestamp, checkpoint, analysis) {
    const status = state === "ERROR" ? "OPEN" : state === "WARNING" ? "WATCHING" : "RESOLVED";
    return [
      {
        id: `incident-${filePath || "file"}-${timestamp}`,
        summary: normalizeAnalysisText(analysis, reasons),
        status,
        timelineTrail: buildTrail(timestamp, previousState, state, score, checkpoint),
        surfacedFile: filePath || "",
        linkedFindings: findings.map((finding) => finding.id),
        probableCauses: probableRootCauses.map((cause) => cause.id)
      }
    ];
  }

  function normalizeTimelinePoint(point) {
    if (!point || typeof point !== "object") {
      return undefined;
    }

    const timestampValue = String(point.timestamp || point.time || "");
    const stateValue = normalizeState(point.state || "NORMAL");
    if (!timestampValue) {
      return undefined;
    }

    return {
      timestamp: timestampValue,
      state: stateValue,
      checkpoint: Boolean(point.checkpoint),
      score: Number.isFinite(Number(point.score)) ? Number(point.score) : 0,
      label: String(point.label || `${stateValue} state`)
    };
  }

  function buildTrail(timestamp, previousState, state, score, checkpoint) {
    return [
      { timestamp, state: normalizeState(previousState || "NORMAL"), checkpoint: false, score: Math.max(0, Number(score) - 1), label: `Previous state ${normalizeState(previousState || "NORMAL")}` },
      { timestamp, state: normalizeState(state), checkpoint: Boolean(checkpoint), score: Number(score) || 0, label: `Current state ${normalizeState(state)}` }
    ];
  }

  function normalizeFindingSeverity(severity) {
    const normalized = String(severity || "WARNING").toUpperCase();
    if (normalized === "ERROR" || normalized === "WARNING" || normalized === "INFO") {
      return normalized;
    }

    return "WARNING";
  }

  function normalizeIncidentStatus(status, fallbackState) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "OPEN" || normalized === "WATCHING" || normalized === "RESOLVED") {
      return normalized;
    }

    return fallbackState === "ERROR" ? "OPEN" : fallbackState === "WARNING" ? "WATCHING" : "RESOLVED";
  }

  function normalizeLineRanges(lineRanges, fallbackRanges) {
    if (!Array.isArray(lineRanges) || lineRanges.length === 0) {
      return fallbackRanges.length > 0 ? fallbackRanges : [[1, 1]];
    }

    const ranges = lineRanges
      .map((range) => Array.isArray(range) && range.length >= 2 ? [Number(range[0]), Number(range[1])] : null)
      .filter(Boolean)
      .filter((range) => Number.isFinite(range[0]) && Number.isFinite(range[1]));

    return ranges.length > 0 ? ranges : (fallbackRanges.length > 0 ? fallbackRanges : [[1, 1]]);
  }

  function clampConfidence(value, fallback) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.min(0.99, Number(numeric.toFixed(2))));
    }

    return Math.max(0, Math.min(0.99, Number(fallback.toFixed(2))));
  }

  function buildDemoTimeline(scenario) {
    const relatedFiles = buildDemoRelatedFiles(scenario.name);
    const impactedFiles = buildDemoImpactedFiles(scenario.name);
    const findings = buildDemoFindings(scenario);
    const probableRootCauses = buildDemoRootCauses(scenario, findings);
    const incidents = buildDemoIncidents(scenario, findings, probableRootCauses);

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
        codePreview: scenario.code,
        findings: [],
        probableRootCauses: [],
        relatedFiles,
        impactedFiles,
        incidents: buildDemoIncidents(
          scenario,
          [{ id: "finding-baseline", message: "Baseline snapshot captured.", severity: "INFO", confidence: 0.91, lineRanges: [[1, 1]] }],
          [{ id: "root-cause-baseline", filePath: scenario.name, reason: "No regression detected yet.", confidence: 0.95, linkedEvidence: ["finding-baseline"] }]
        )
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
        codePreview: scenario.code,
        findings: findings.slice(0, 1),
        probableRootCauses: probableRootCauses.slice(0, 1),
        relatedFiles,
        impactedFiles,
        incidents: incidents.slice(0, 1)
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
        codePreview: scenario.code,
        findings: findings.slice(0, 2),
        probableRootCauses: probableRootCauses.slice(0, 2),
        relatedFiles,
        impactedFiles,
        incidents
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
        codePreview: scenario.code,
        findings,
        probableRootCauses,
        relatedFiles,
        impactedFiles,
        incidents
      }
    ];
  }

  function buildDemoFindings(scenario) {
    return [
      {
        id: "finding-1",
        message: scenario.rootCause,
        severity: "ERROR",
        confidence: 0.94,
        lineRanges: scenario.changedLineRanges,
        symbol: "fetchData"
      },
      {
        id: "finding-2",
        message: scenario.analysis.summary,
        severity: "WARNING",
        confidence: 0.78,
        lineRanges: scenario.changedLineRanges,
        symbol: "state"
      }
    ];
  }

  function buildDemoRootCauses(scenario, findings) {
    return [
      {
        id: "root-cause-1",
        filePath: `src/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.ts`,
        reason: scenario.rootCause,
        confidence: 0.92,
        linkedEvidence: findings.map((finding) => finding.id)
      },
      {
        id: "root-cause-2",
        filePath: `src/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.test.ts`,
        reason: scenario.analysis.rootCause,
        confidence: 0.81,
        linkedEvidence: [findings[0].id]
      }
    ];
  }

  function buildDemoRelatedFiles(name) {
    if (name === "API Timeout") {
      return [
        { filePath: "src/network/client.ts", reason: "Primary fetch path is coupled to the failing request" },
        { filePath: "src/services/cache.ts", reason: "Cache refresh depends on the same request lifecycle" }
      ];
    }

    if (name === "Connection Drift") {
      return [
        { filePath: "src/db/pool.ts", reason: "Connection pool management is part of the incident path" },
        { filePath: "src/jobs/queue.ts", reason: "Queued work keeps the leaking connection path hot" }
      ];
    }

    return [
      { filePath: "src/cache/index.ts", reason: "Cache writes mirror the invalid payload path" },
      { filePath: "src/render/user.tsx", reason: "UI rendering consumes the cached object shape" }
    ];
  }

  function buildDemoImpactedFiles(name) {
    if (name === "API Timeout") {
      return [
        { filePath: "src/ui/request-status.tsx", reason: "Timeouts surface in the request status experience" },
        { filePath: "src/routes/api.ts", reason: "API route behavior depends on the fetch timeout contract" }
      ];
    }

    if (name === "Connection Drift") {
      return [
        { filePath: "src/reports/activity.ts", reason: "Stale sockets can delay reporting consumers" },
        { filePath: "src/app/bootstrap.ts", reason: "Bootstrap paths may inherit exhausted connection pools" }
      ];
    }

    return [
      { filePath: "src/ui/profile-card.tsx", reason: "Malformed cache values can break the profile card" },
      { filePath: "src/api/user.ts", reason: "Corrupted payloads can leak back into the user API" }
    ];
  }

  function buildDemoIncidents(scenario, findings, probableRootCauses) {
    return [
      {
        id: `incident-${scenario.name.toLowerCase().replace(/\s+/g, "-")}`,
        summary: scenario.analysis.summary,
        status: "OPEN",
        timelineTrail: [
          { timestamp: new Date(Date.now() - 150000).toISOString(), state: "NORMAL", checkpoint: false, score: 16, label: "Baseline" },
          { timestamp: new Date(Date.now() - 70000).toISOString(), state: "WARNING", checkpoint: false, score: 42, label: "Risk surfaced" },
          { timestamp: new Date().toISOString(), state: "ERROR", checkpoint: true, score: 91, label: "Checkpoint" }
        ],
        surfacedFile: `src/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.ts`,
        linkedFindings: findings.map((finding) => finding.id),
        probableCauses: probableRootCauses.map((cause) => cause.id)
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
    appState.activePane = "overview";
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
      appState.isReplaying = false;
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
    appState.isReplaying = true;
    updateTransportControls();
    elements.panel.classList.add("motion-blur");
    elements.timelineWrap.classList.add("replaying");
    appState.selectedIndex = 0;
    updateView({ animateText: false });
    focusSelectedCheckpoint("center");

    let index = 0;
    appState.replayTimer = setInterval(() => {
      if (index >= entries.length - 1) {
        appState.replayTimer = clearTimer(appState.replayTimer);
        elements.panel.classList.remove("motion-blur");
        elements.timelineWrap.classList.remove("replaying");
        appState.isReplaying = false;
        updateTransportControls();
        return;
      }

      index += 1;
      appState.selectedIndex = index;
      updateView({ animateText: false });
      focusSelectedCheckpoint("center");
    }, replayDurations[appState.replaySpeed]);
  }

  function toggleReplay() {
    if (appState.isReplaying) {
      pauseReplay();
      return;
    }

    replayTimeline();
  }

  function pauseReplay() {
    appState.replayTimer = clearTimer(appState.replayTimer);
    appState.isReplaying = false;
    elements.panel.classList.remove("motion-blur");
    elements.timelineWrap.classList.remove("replaying");
    updateTransportControls();
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
    applyPaneVisibility();

    renderTimelineNodes(entries);
    renderTimelineStamps(entries);
    updateTimelineProgress(entries);
    updateHeader(selected, entries.length);
    updateTransportControls();

    if (!selected) {
      renderEmptyPanels();
      updateSignalChart([], undefined);
      return;
    }

    updateCheckpointDetails(selected);
    renderFindings(selected.findings);
    renderRootCauseCandidates(selected.probableRootCauses);
    renderIncidentList(selected.incidents, selected);
    renderFileContext(selected.relatedFiles, selected.impactedFiles);
    updateCode(selected);
    setCodeToggle();
    updateSignalChart(entries, selected);
    updateAnalysis(selected, animateText);
  }

  function renderEmptyPanels() {
    elements.checkpointState.textContent = "WAITING";
    elements.checkpointScore.textContent = "0";
    elements.checkpointTransition.textContent = "Awaiting checkpoint";
    elements.checkpointMarker.textContent = "No";
    elements.checkpointSummary.textContent = "Save the file again or let the backend publish history to populate the structured debugger panels.";
    elements.checkpointTimestamp.textContent = "No checkpoint history yet.";
    elements.rootCard.classList.remove("hidden");
    elements.rootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
    elements.findingsList.innerHTML = '<div class="empty-state">No findings yet.</div>';
    elements.incidentList.innerHTML = '<div class="empty-state">No incidents yet.</div>';
    elements.relatedFilesList.innerHTML = '<div class="empty-state">No related files yet.</div>';
    elements.impactedFilesList.innerHTML = '<div class="empty-state">No impacted files yet.</div>';
    elements.changedLines.innerHTML = '<span class="impact-chip">No changed lines yet</span>';
    elements.codeWindow.innerHTML = '<div class="code-line"><span class="code-line-number">1</span><span>// waiting for checkpoint data</span></div>';
    elements.summary.textContent = "Awaiting checkpoint history from the extension bridge.";
    elements.latencyValue.textContent = "0";
  }

  function updateHeader(selected, entryCount) {
    const state = selected ? selected.state : "NORMAL";
    const fileName = appState.sourceLabel.includes(" · ")
      ? appState.sourceLabel.split(" · ")[0]
      : appState.sourceLabel;

    elements.headerFile.textContent = fileName || "Demo mode";
    elements.headerCheckpoint.textContent = selected ? `${selected.previousState} → ${selected.state} · ${selected.checkpoint ? "checkpoint" : "save"}` : "-";
    elements.headerScore.textContent = selected ? String(selected.score) : "-";
    elements.headerStatePill.textContent = state;
    elements.headerStatePill.className = `header-pill ${stateClass(state)}`;
  }

  function renderTimelineNodes(entries) {
    elements.timelineNodes.innerHTML = "";
    if (!entries.length) {
      return;
    }

    updateTimelineGeometry(entries.length);

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

    focusSelectedCheckpoint("nearest");
  }

  function updateTimelineGeometry(entryCount) {
    const step = 56;
    const minWidth = Math.max(260, elements.timelineWrap.clientWidth - 2);
    const calculatedWidth = Math.max(minWidth, 40 + Math.max(0, entryCount - 1) * step + 24);
    elements.timelineInner.style.width = `${calculatedWidth}px`;
    elements.timelineStamps.style.setProperty("--stamp-width", `${step}px`);
  }

  function renderTimelineStamps(entries) {
    elements.timelineStamps.innerHTML = "";
    if (!entries.length) {
      return;
    }

    entries.forEach((entry, index) => {
      const stamp = document.createElement("button");
      stamp.type = "button";
      stamp.className = `stamp ${index === appState.selectedIndex ? "active" : ""}`;
      stamp.textContent = compactTime(entry.timestamp);
      stamp.title = entry.timestamp;
      stamp.addEventListener("click", () => {
        selectCheckpoint(index, { stopReplay: true });
      });
      elements.timelineStamps.appendChild(stamp);
    });

    focusSelectedCheckpoint("nearest");
  }

  function focusSelectedCheckpoint(behavior) {
    const selectedNode = elements.timelineNodes.querySelector(".node.active");
    const selectedStamp = elements.timelineStamps.querySelector(".stamp.active");

    if (selectedNode && typeof selectedNode.scrollIntoView === "function") {
      selectedNode.scrollIntoView({ inline: "center", block: "nearest", behavior });
    }

    if (selectedStamp && typeof selectedStamp.scrollIntoView === "function") {
      selectedStamp.scrollIntoView({ inline: "center", block: "nearest", behavior });
    }
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
    elements.checkpointState.textContent = entry.state;
    elements.checkpointScore.textContent = `${entry.score}`;
    elements.checkpointTransition.textContent = `${entry.previousState} → ${entry.state}`;
    elements.checkpointMarker.textContent = entry.checkpoint ? "Yes" : "No";
    elements.checkpointSummary.textContent = entry.analysis;
    elements.checkpointTimestamp.textContent = entry.timestamp;
    elements.rootCard.classList.remove("hidden");
    renderCompatibilitySummary(entry);
  }

  function updateTransportControls() {
    if (!elements.timelinePlayPause || !elements.timelinePlayPauseIcon) {
      return;
    }

    elements.timelinePlayPauseIcon.innerHTML = appState.isReplaying ? "&#10074;&#10074;" : "&#9654;";
    elements.timelinePlayPause.setAttribute("aria-label", appState.isReplaying ? "Pause timeline" : "Play timeline");
    elements.timelinePlayPause.title = appState.isReplaying ? "Pause" : "Play";
  }

  function renderFindings(findings) {
    if (!Array.isArray(findings) || findings.length === 0) {
      elements.findingsList.innerHTML = '<div class="empty-state">No findings detected.</div>';
      return;
    }

    elements.findingsList.innerHTML = findings
      .map((finding) => {
        const lineRanges = Array.isArray(finding.lineRanges) && finding.lineRanges.length > 0
          ? finding.lineRanges.map((range) => `L${range[0]}-${range[1]}`).join(", ")
          : "-";
        const symbol = finding.symbol ? `<span class="mini-pill">${escapeHtml(String(finding.symbol))}</span>` : "";
        return `
          <article class="finding-item finding-${String(finding.severity || "WARNING").toLowerCase()}">
            <div class="finding-topline">
              <span class="mini-pill">${escapeHtml(String(finding.severity || "WARNING"))}</span>
              <strong>${escapeHtml(String((Number(finding.confidence) * 100).toFixed(0)))}%</strong>
            </div>
            <p>${escapeHtml(String(finding.message || "Finding"))}</p>
            <div class="finding-meta">
              <span>${escapeHtml(lineRanges)}</span>
              ${symbol}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderRootCauseCandidates(probableRootCauses) {
    if (!Array.isArray(probableRootCauses) || probableRootCauses.length === 0) {
      elements.rootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
      return;
    }

    elements.rootCauseList.innerHTML = probableRootCauses
      .map((candidate, index) => `
        <article class="root-cause-item">
          <div class="ranking-index">${index + 1}</div>
          <div class="root-cause-body">
            <div class="finding-topline">
              <strong>${escapeHtml(String(candidate.filePath || ""))}</strong>
              <span class="mini-pill">${escapeHtml(String((Number(candidate.confidence) * 100).toFixed(0)))}%</span>
            </div>
            <p>${escapeHtml(String(candidate.reason || "Probable root cause"))}</p>
            <div class="finding-meta">
              <span>${escapeHtml((candidate.linkedEvidence || []).join(", ") || "No linked evidence")}</span>
            </div>
          </div>
        </article>
      `)
      .join("");
  }

  function renderIncidentList(incidents, selected) {
    if (!Array.isArray(incidents) || incidents.length === 0) {
      elements.incidentList.innerHTML = '<div class="empty-state">No incidents yet.</div>';
      return;
    }

    elements.incidentList.innerHTML = incidents
      .map((incident, index) => {
        const trail = Array.isArray(incident.timelineTrail)
          ? incident.timelineTrail.map((point) => `<span class="trail-chip ${stateClass(point.state)}">${escapeHtml(String(point.label || point.state))}</span>`).join("")
          : "";
        const linkedFindings = Array.isArray(incident.linkedFindings) ? incident.linkedFindings.join(", ") : "";
        const linkedCauses = Array.isArray(incident.probableCauses) ? incident.probableCauses.join(", ") : "";
        const statusClass = String(incident.status || "WATCHING").toLowerCase();
        const isSelected = selected && selected.incidents && selected.incidents[0] && selected.incidents[0].id === incident.id;
        return `
          <button class="incident-item ${isSelected ? "selected" : ""}" type="button" data-incident-index="${index}">
            <div class="finding-topline">
              <strong>${escapeHtml(String(incident.summary || "Incident"))}</strong>
              <span class="mini-pill incident-${statusClass}">${escapeHtml(String(incident.status || "WATCHING"))}</span>
            </div>
            <p>${escapeHtml(String(incident.surfacedFile || ""))}</p>
            <div class="trail-row">${trail}</div>
            <div class="finding-meta">
              <span>Findings: ${escapeHtml(linkedFindings || "none")}</span>
              <span>Causes: ${escapeHtml(linkedCauses || "none")}</span>
            </div>
          </button>
        `;
      })
      .join("");

    elements.incidentList.querySelectorAll("[data-incident-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.getAttribute("data-incident-index"));
        const incident = incidents[index];
        if (!incident) {
          return;
        }

        const checkpointIndex = getActiveEntries().findIndex((entry) => Array.isArray(entry.incidents) && entry.incidents.some((item) => item.id === incident.id));
        if (checkpointIndex >= 0) {
          selectCheckpoint(checkpointIndex, { stopReplay: true });
        }
      });
    });
  }

  function renderFileContext(relatedFiles, impactedFiles) {
    elements.relatedFilesList.innerHTML = renderFileContextList(relatedFiles, "No related files detected.");
    elements.impactedFilesList.innerHTML = renderFileContextList(impactedFiles, "No impacted files detected.");
  }

  function renderFileContextList(items, emptyMessage) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    }

    return items
      .map((item) => `
        <article class="context-item">
          <strong>${escapeHtml(String(typeof item === "string" ? item : item.filePath || ""))}</strong>
          <p>${escapeHtml(String(typeof item === "string" ? "Contextual file" : item.reason || "Contextual file"))}</p>
        </article>
      `)
      .join("");
  }

  function renderCompatibilitySummary(entry) {
    const summary = entry.analysis;
    elements.summary.textContent = summary;
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
    elements.summary.textContent = entry.analysis;
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

  function compactTime(timestamp) {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return String(timestamp).slice(-8);
    }

    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

  function applyPaneVisibility() {
    elements.paneButtons.forEach((button) => {
      const pane = button.getAttribute("data-pane-target");
      button.classList.toggle("active", pane === appState.activePane);
    });

    elements.paneSections.forEach((section) => {
      const pane = section.getAttribute("data-pane");
      section.classList.toggle("pane-hidden", pane !== appState.activePane);
    });
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
