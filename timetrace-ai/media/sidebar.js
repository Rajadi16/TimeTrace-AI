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

  const replayDuration = 680;
  const timelineStep = 56;

  const elements = {
    scenarioRow: document.getElementById("scenario-row"),
    scenarioSelect: document.getElementById("scenario-select"),
    timelineEmpty: document.getElementById("timeline-empty"),
    timelineStamps: document.getElementById("timeline-stamps"),
    headerStatePill: document.getElementById("header-state-pill"),
    headerFile: document.getElementById("header-file"),
    headerCheckpoint: document.getElementById("header-checkpoint"),
    headerScore: document.getElementById("header-score"),
    timelineNodes: document.getElementById("timeline-nodes"),
    timelineProgress: document.getElementById("timeline-progress"),
    timelineInner: document.getElementById("timeline-inner"),
    timelineStream: document.getElementById("timeline-stream"),
    timelinePlayPause: document.getElementById("timeline-play-pause"),
    timelinePlayPauseIcon: document.getElementById("timeline-play-pause-icon"),
    checkpointState: document.getElementById("checkpoint-state"),
    checkpointScore: document.getElementById("checkpoint-score"),
    checkpointTransition: document.getElementById("checkpoint-transition"),
    checkpointSummary: document.getElementById("checkpoint-summary"),
    checkpointTimestamp: document.getElementById("checkpoint-timestamp"),
    overviewRootCauseSummary: document.getElementById("overview-root-cause-summary"),
    overviewRootCauseList: document.getElementById("overview-root-cause-list"),
    rootCard: document.getElementById("root-cause-card"),
    rootCauseList: document.getElementById("root-cause-list"),
    beforeCodeWindow: document.getElementById("before-code-window"),
    afterCodeWindow: document.getElementById("after-code-window"),
    beforeFocusLine: document.getElementById("before-focus-line"),
    afterFocusLine: document.getElementById("after-focus-line"),
    codeNavActions: document.getElementById("code-nav-actions"),
    codeGoLineInput: document.getElementById("code-go-line-input"),
    codeGoLineBtn: document.getElementById("code-go-line-btn"),
    codeFlowSummary: document.getElementById("code-flow-summary"),
    codeFlowNodes: document.getElementById("code-flow-nodes"),
    changedLines: document.getElementById("changed-lines"),
    findingsList: document.getElementById("findings-list"),
    runtimeEventsList: document.getElementById("runtime-events-list"),
    runtimeDetailType: document.getElementById("runtime-detail-type"),
    runtimeDetailStatus: document.getElementById("runtime-detail-status"),
    runtimeDetailMessage: document.getElementById("runtime-detail-message"),
    runtimeDetailTime: document.getElementById("runtime-detail-time"),
    runtimeDetailFile: document.getElementById("runtime-detail-file"),
    runtimeDetailLine: document.getElementById("runtime-detail-line"),
    runtimeDetailCheckpoint: document.getElementById("runtime-detail-checkpoint"),
    runtimeDetailStack: document.getElementById("runtime-detail-stack"),
    incidentList: document.getElementById("incident-list"),
    incidentDetailSummary: document.getElementById("incident-detail-summary"),
    incidentDetailStatus: document.getElementById("incident-detail-status"),
    incidentDetailRuntimeConfirmation: document.getElementById("incident-detail-runtime-confirmation"),
    incidentDetailSeverity: document.getElementById("incident-detail-severity"),
    incidentDetailFile: document.getElementById("incident-detail-file"),
    incidentDetailCheckpoint: document.getElementById("incident-detail-checkpoint"),
    incidentDetailRuntimeCount: document.getElementById("incident-detail-runtime-count"),
    incidentDetailLastRuntime: document.getElementById("incident-detail-last-runtime"),
    incidentDetailReason: document.getElementById("incident-detail-reason"),
    incidentDetailFindings: document.getElementById("incident-detail-findings"),
    incidentDetailCauses: document.getElementById("incident-detail-causes"),
    incidentDetailRuntimeEvents: document.getElementById("incident-detail-runtime-events"),
    relatedFilesList: document.getElementById("related-files-list"),
    impactedFilesList: document.getElementById("impacted-files-list"),
    summary: document.getElementById("analysis-summary"),
    timelineRewind: document.getElementById("timeline-rewind"),
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
    replayTimer: undefined,
    isReplaying: false,
    theme: "auto",
    typography: "mono",
    sourceLabel: "Demo mode",
    activePane: "overview",
    codePane: undefined,
    timelineItems: [],
    selectedIncidentId: undefined,
    selectedRuntimeEventId: undefined,
    selectedFindingId: undefined,
    selectedRootCauseFile: undefined
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
    appState.codePane = buildFallbackCodePaneFromEntry(appState.demoEntries[appState.selectedIndex]);
    appState.timelineItems = buildTimelineItemsFromEntries(appState.demoEntries);

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

    if (elements.codeGoLineBtn) {
      elements.codeGoLineBtn.addEventListener("click", () => {
        submitManualGoToLine();
      });
    }

    if (elements.codeGoLineInput) {
      elements.codeGoLineInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitManualGoToLine();
        }
      });
    }

    if (elements.timelinePlayPause) {
      elements.timelinePlayPause.addEventListener("click", toggleReplay);
    }
    if (elements.timelineRewind) {
      elements.timelineRewind.addEventListener("click", () => shiftCheckpoint(-1));
    }

    elements.timelineWrap.addEventListener("scroll", () => {
      elements.timelineStamps.scrollLeft = elements.timelineWrap.scrollLeft;
    });

    elements.timelineStamps.addEventListener("scroll", () => {
      elements.timelineWrap.scrollLeft = elements.timelineStamps.scrollLeft;
    });

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
        toggleReplay();
      }

    });

    // Intentionally no parallax: production mode favors stable layout.
  }

  function handleExtensionMessage(message) {
    if (!message || (message.type !== "analysisResult" && message.type !== "checkpointTimeline" && message.type !== "historyUpdate")) {
      return;
    }

    const payload = message.payload || message;
    const canonicalTimelineItems = normalizeTimelineItems(payload.timelineItems);

    // Preserve timeline history: analysisResult payloads usually contain only
    // the latest analysis shape (no timelineHistory array). If we normalize
    // that as a fresh history source, it collapses the timeline to one entry.
    const hasHistoryArray =
      Array.isArray(payload.timelineHistory) ||
      Array.isArray(payload.history) ||
      Array.isArray(payload.entries);

    if (message.type === "analysisResult" && !hasHistoryArray && appState.liveEntries.length > 0) {
      const latestIndex = appState.liveEntries.length - 1;
      const latestEntry = appState.liveEntries[latestIndex];

      appState.mode = "live";
      appState.liveEntries[latestIndex] = {
        ...latestEntry,
        state: payload.state || latestEntry.state,
        score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : latestEntry.score,
        previousState: payload.previousState || latestEntry.previousState,
        reasons: Array.isArray(payload.reasons) ? payload.reasons : latestEntry.reasons,
        analysis: payload.analysis || latestEntry.analysis,
        changedLineRanges: Array.isArray(payload.changedLineRanges) ? payload.changedLineRanges : latestEntry.changedLineRanges,
        findings: Array.isArray(payload.findings) ? payload.findings.map((item, findingIndex) => normalizeFinding(item, findingIndex, latestEntry.changedLineRanges || [], latestEntry.reasons || [])) : latestEntry.findings,
        probableRootCauses: Array.isArray(payload.probableRootCauses) ? payload.probableRootCauses.map((item, causeIndex) => normalizeRootCause(item, causeIndex, latestEntry.filePath, latestEntry.findings || [])) : latestEntry.probableRootCauses,
        incidents: Array.isArray(payload.incidents) ? payload.incidents.map((item, incidentIndex) => normalizeIncident(item, incidentIndex, latestEntry.filePath, latestEntry.findings || [], latestEntry.probableRootCauses || [], latestEntry.runtimeEvents || [], latestEntry.score, latestEntry.previousState, latestEntry.state, latestEntry.timestamp, latestEntry.checkpoint, latestEntry.checkpointId)) : latestEntry.incidents,
        runtimeEvents: Array.isArray(payload.runtimeEvents) ? payload.runtimeEvents.map((item, eventIndex) => normalizeRuntimeEvent(item, eventIndex, latestEntry.filePath || "", latestEntry.checkpointId, latestEntry.timestamp, latestEntry.state, latestEntry.checkpoint, latestEntry.findings || [], latestEntry.probableRootCauses || [])) : latestEntry.runtimeEvents,
        relatedFiles: Array.isArray(payload.relatedFiles) ? payload.relatedFiles.map(normalizeFileContext).filter(Boolean) : latestEntry.relatedFiles,
        impactedFiles: Array.isArray(payload.impactedFiles) ? payload.impactedFiles.map(normalizeFileContext).filter(Boolean) : latestEntry.impactedFiles
      };

      appState.codePane = normalizeCodePane(payload.codePane, appState.liveEntries[latestIndex]);
      appState.timelineItems = canonicalTimelineItems.length > 0 ? canonicalTimelineItems : appState.timelineItems;

      appState.selectedIndex = latestIndex;
      appState.sourceLabel = buildSourceLabel(payload.filePath || latestEntry.filePath, appState.liveEntries.length);
      appState.replayTimer = clearTimer(appState.replayTimer);
      elements.scenarioRow.classList.add("hidden");
      updateView({ animateText: true });
      return;
    }

    const entries = normalizeHistoryEntries(payload);

    if (!entries.length) {
      renderEmptyLiveState(payload.filePath);
      return;
    }

    appState.mode = "live";
    appState.liveEntries = entries;
    appState.selectedIndex = entries.length - 1;
    appState.codePane = normalizeCodePane(payload.codePane, entries[entries.length - 1]);
    appState.timelineItems = canonicalTimelineItems.length > 0
      ? canonicalTimelineItems
      : buildTimelineItemsFromEntries(entries);
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

  function normalizeTimelineItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return [];
    }

    return rawItems
      .map((rawItem, index) => {
        if (!rawItem || typeof rawItem !== "object") {
          return undefined;
        }

        const kind = String(rawItem.kind || "").trim();
        const timestampValue = String(rawItem.timestamp || "");
        if (!kind || !timestampValue) {
          return undefined;
        }

        if (kind === "checkpoint") {
          return {
            kind: "checkpoint",
            checkpointId: String(rawItem.checkpointId || `checkpoint-${index + 1}`),
            timestamp: timestampValue,
            filePath: rawItem.filePath ? String(rawItem.filePath) : undefined,
            state: normalizeState(rawItem.state || "NORMAL")
          };
        }

        if (kind === "runtimeEvent") {
          const runtimeType = normalizeRuntimeEventType(rawItem.eventType || rawItem.type);
          return {
            kind: "runtimeEvent",
            runtimeEventId: String(rawItem.runtimeEventId || rawItem.id || `runtime-${index + 1}`),
            timestamp: timestampValue,
            filePath: rawItem.filePath ? String(rawItem.filePath) : undefined,
            eventType: runtimeType,
            message: String(rawItem.message || "Runtime event"),
            severity: normalizeRuntimeSeverity(rawItem.severity),
            relatedCheckpointId: rawItem.relatedCheckpointId ? String(rawItem.relatedCheckpointId) : undefined,
            relatedIncidentId: rawItem.relatedIncidentId ? String(rawItem.relatedIncidentId) : undefined
          };
        }

        if (kind === "incidentUpdate") {
          return {
            kind: "incidentUpdate",
            incidentId: String(rawItem.incidentId || rawItem.id || `incident-${index + 1}`),
            timestamp: timestampValue,
            status: normalizeIncidentTimelineStatus(rawItem.status),
            summary: String(rawItem.summary || "Incident updated"),
            runtimeConfirmed: Boolean(rawItem.runtimeConfirmed)
          };
        }

        return undefined;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  function buildTimelineItemsFromEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }

    return entries
      .map((entry) => ({
        kind: "checkpoint",
        checkpointId: entry.checkpointId || buildCheckpointId(entry.filePath || "", entry.timestamp || ""),
        timestamp: entry.timestamp,
        filePath: entry.filePath,
        state: normalizeState(entry.state)
      }))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  function normalizeRuntimeSeverity(value) {
    const normalized = String(value || "warning").toLowerCase();
    return normalized === "error" ? "error" : "warning";
  }

  function normalizeIncidentTimelineStatus(status) {
    const normalized = String(status || "open").toLowerCase();
    if (normalized === "mitigated" || normalized === "resolved") {
      return normalized;
    }
    return "open";
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
    const checkpointId = String(rawEntry.checkpointId || buildCheckpointId(rawEntry.filePath || filePath || "", rawEntry.timestamp || String(index)));
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
    const runtimeEvents = Array.isArray(rawEntry.runtimeEvents)
      ? rawEntry.runtimeEvents.map((item, eventIndex) => normalizeRuntimeEvent(item, eventIndex, rawEntry.filePath || filePath || "", checkpointId, rawEntry.timestamp, rawEntry.state, rawEntry.checkpoint, findings, probableRootCauses))
      : buildFallbackRuntimeEvents(rawEntry.filePath || filePath || "", checkpointId, rawEntry.timestamp, rawEntry.state, rawEntry.checkpoint, findings, probableRootCauses, rawEntry.analysis);
    const incidents = Array.isArray(rawEntry.incidents)
      ? rawEntry.incidents.map((item, incidentIndex) => normalizeIncident(item, incidentIndex, filePath, findings, probableRootCauses, runtimeEvents, score, rawEntry.previousState, rawEntry.state, rawEntry.timestamp, rawEntry.checkpoint, checkpointId))
      : buildFallbackIncidents(filePath, reasons, findings, probableRootCauses, runtimeEvents, score, rawEntry.previousState, rawEntry.state, rawEntry.timestamp, rawEntry.checkpoint, rawEntry.analysis, checkpointId);

    return {
      filePath: rawEntry.filePath || filePath || "",
      timestamp: formatTimestamp(rawEntry.timestamp, index),
      state: normalizeState(rawEntry.state),
      score: Number.isFinite(score) ? score : 0,
      checkpoint: Boolean(rawEntry.checkpoint),
      checkpointId,
      previousState: normalizeState(rawEntry.previousState || rawEntry.previous || "NORMAL"),
      reasons,
      analysis: normalizeAnalysisText(rawEntry.analysis, reasons),
      changedLineRanges,
      features: rawEntry.features || [],
      findings,
      probableRootCauses,
      relatedFiles,
      impactedFiles,
      runtimeEvents,
      incidents,
      codePreview: {
        before: ensureLines(codePreview.before),
        after: ensureLines(codePreview.after),
        focusLine: Number.isFinite(Number(codePreview.focusLine)) ? Number(codePreview.focusLine) : 1,
        startLine: Number.isFinite(Number(codePreview.startLine)) ? Number(codePreview.startLine) : 1,
        endLine: Number.isFinite(Number(codePreview.endLine)) ? Number(codePreview.endLine) : undefined
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

  function normalizeIncident(rawIncident, index, filePath, findings, probableRootCauses, runtimeEvents, score, previousState, state, timestamp, checkpoint, checkpointId) {
    if (!rawIncident || typeof rawIncident !== "object") {
      return {
        id: `incident-${index + 1}`,
        summary: "Incident detail",
        status: state === "ERROR" ? "OPEN" : state === "WARNING" ? "MITIGATED" : "RESOLVED",
        runtimeConfirmationState: state === "ERROR" ? "RUNTIME_CONFIRMED" : state === "WARNING" ? "SUSPECTED" : "RESOLVED",
        runtimeConfirmed: state === "ERROR",
        statusReason: state === "ERROR"
          ? "Runtime evidence confirms the incident is active."
          : state === "WARNING"
            ? "The issue is still active but severity is reduced."
            : "Incident resolved.",
        timelineTrail: buildTrail(timestamp, previousState, state, score, checkpoint),
        surfacedFile: filePath || "",
        linkedCheckpointId: checkpointId,
        linkedFindings: findings.map((finding) => finding.id),
        probableCauses: probableRootCauses.map((cause) => cause.id),
        linkedRuntimeEvents: runtimeEvents.map((event) => event.id),
        lastRuntimeEventAt: runtimeEvents[0]?.timestamp,
        evidenceCount: findings.length + runtimeEvents.length
      };
    }

    const incidentStatus = normalizeIncidentStatus(rawIncident.status, state);
    const runtimeConfirmationState = normalizeRuntimeConfirmationState(rawIncident.runtimeConfirmationState, state, Boolean(rawIncident.runtimeConfirmed));

    return {
      id: String(rawIncident.id || `incident-${index + 1}`),
      summary: String(rawIncident.summary || rawIncident.message || "Incident detail"),
      status: incidentStatus,
      runtimeConfirmationState,
      runtimeConfirmed: Boolean(rawIncident.runtimeConfirmed),
      statusReason: String(rawIncident.statusReason || rawIncident.reason || (incidentStatus === "RESOLVED" ? "Incident resolved." : incidentStatus === "OPEN" ? "Incident remains active." : "Incident mitigated.")),
      timelineTrail: Array.isArray(rawIncident.timelineTrail) && rawIncident.timelineTrail.length > 0
        ? rawIncident.timelineTrail.map(normalizeTimelinePoint).filter(Boolean)
        : buildTrail(timestamp, previousState, state, score, checkpoint),
      surfacedFile: String(rawIncident.surfacedFile || rawIncident.filePath || filePath || ""),
      linkedCheckpointId: String(rawIncident.linkedCheckpointId || checkpointId),
      linkedFindings: Array.isArray(rawIncident.linkedFindings) ? rawIncident.linkedFindings.map(String) : findings.map((finding) => finding.id),
      probableCauses: Array.isArray(rawIncident.probableCauses) ? rawIncident.probableCauses.map(String) : probableRootCauses.map((cause) => cause.id),
      linkedRuntimeEvents: Array.isArray(rawIncident.linkedRuntimeEvents) ? rawIncident.linkedRuntimeEvents.map(String) : runtimeEvents.map((event) => event.id),
      lastRuntimeEventAt: rawIncident.lastRuntimeEventAt ? String(rawIncident.lastRuntimeEventAt) : runtimeEvents[0]?.timestamp,
      evidenceCount: Number.isFinite(Number(rawIncident.evidenceCount)) ? Number(rawIncident.evidenceCount) : findings.length + runtimeEvents.length
    };
  }

  function buildFallbackIncidents(filePath, reasons, findings, probableRootCauses, runtimeEvents, score, previousState, state, timestamp, checkpoint, analysis, checkpointId) {
    const status = state === "ERROR" ? "OPEN" : state === "WARNING" ? "MITIGATED" : "RESOLVED";
    return [
      {
        id: `incident-${filePath || "file"}-${timestamp}`,
        summary: normalizeAnalysisText(analysis, reasons),
        status,
        runtimeConfirmationState: runtimeEvents.length > 0 ? (status === "OPEN" ? "RUNTIME_CONFIRMED" : status === "MITIGATED" ? "MITIGATED" : "RESOLVED") : (status === "RESOLVED" ? "RESOLVED" : "SUSPECTED"),
        runtimeConfirmed: runtimeEvents.some((event) => event.runtimeConfirmed),
        statusReason: status === "OPEN" ? "Runtime evidence confirms the issue is active." : status === "MITIGATED" ? "Issue remains active but is reduced by the current state." : "Incident resolved.",
        timelineTrail: buildTrail(timestamp, previousState, state, score, checkpoint),
        surfacedFile: filePath || "",
        linkedCheckpointId: checkpointId,
        linkedFindings: findings.map((finding) => finding.id),
        probableCauses: probableRootCauses.map((cause) => cause.id),
        linkedRuntimeEvents: runtimeEvents.map((event) => event.id),
        lastRuntimeEventAt: runtimeEvents[0]?.timestamp,
        evidenceCount: findings.length + runtimeEvents.length
      }
    ];
  }

  function normalizeRuntimeEvent(rawEvent, index, filePath, checkpointId, timestamp, state, checkpoint, findings, probableRootCauses) {
    if (!rawEvent || typeof rawEvent !== "object") {
      return buildRuntimeEventFromState(filePath, checkpointId, timestamp, state, checkpoint, findings, probableRootCauses, index);
    }

    const stackPreview = Array.isArray(rawEvent.stackPreview)
      ? rawEvent.stackPreview.map(String)
      : Array.isArray(rawEvent.stack)
        ? rawEvent.stack.map(String)
        : [];

    const runtimeType = normalizeRuntimeEventType(rawEvent.type || rawEvent.eventType);

    return {
      id: String(rawEvent.id || `runtime-${index + 1}`),
      eventType: runtimeType,
      type: runtimeType,
      message: String(rawEvent.message || rawEvent.summary || "Runtime event"),
      timestamp: String(rawEvent.timestamp || timestamp),
      severity: normalizeFindingSeverity(rawEvent.severity || rawEvent.level || "WARNING"),
      filePath: rawEvent.filePath ? String(rawEvent.filePath) : filePath || undefined,
      line: Number.isFinite(Number(rawEvent.line)) ? Number(rawEvent.line) : undefined,
      stackPreview: stackPreview.length > 0 ? stackPreview : buildRuntimeStackPreview(String(rawEvent.message || "Runtime event"), checkpointId, filePath),
      linkedCheckpointId: String(rawEvent.linkedCheckpointId || checkpointId),
      linkedIncidentId: rawEvent.linkedIncidentId ? String(rawEvent.linkedIncidentId) : undefined,
      runtimeConfirmed: Boolean(rawEvent.runtimeConfirmed),
      confirmationState: normalizeRuntimeConfirmationState(rawEvent.confirmationState, state, Boolean(rawEvent.runtimeConfirmed)),
      evidenceCount: Number.isFinite(Number(rawEvent.evidenceCount)) ? Number(rawEvent.evidenceCount) : Math.max(1, findings.length + probableRootCauses.length)
    };
  }

  function buildFallbackRuntimeEvents(filePath, checkpointId, timestamp, state, checkpoint, findings, probableRootCauses, analysis) {
    if (state === "NORMAL" && !checkpoint) {
      return [];
    }

    const eventType = state === "ERROR"
      ? "RuntimeError"
      : state === "WARNING"
        ? "NetworkFailure"
        : "ConsoleError";
    const runtimeConfirmed = state === "ERROR" || checkpoint;
    return [
      {
        id: `runtime-${checkpointId}`,
        eventType,
        type: eventType,
        message: normalizeRuntimeEventMessage(eventType, analysis),
        timestamp,
        severity: state === "ERROR" ? "ERROR" : "WARNING",
        filePath,
        line: changedLineFromFindings(findings),
        stackPreview: buildRuntimeStackPreview(normalizeRuntimeEventMessage(eventType, analysis), checkpointId, filePath),
        linkedCheckpointId: checkpointId,
        linkedIncidentId: `incident-${timestamp}`,
        runtimeConfirmed,
        confirmationState: runtimeConfirmed ? "RUNTIME_CONFIRMED" : state === "WARNING" ? "SUSPECTED" : "MITIGATED",
        evidenceCount: Math.max(1, findings.length + probableRootCauses.length)
      }
    ];
  }

  function buildRuntimeEventFromState(filePath, checkpointId, timestamp, state, checkpoint, findings, probableRootCauses, index) {
    const eventType = state === "ERROR" ? "RuntimeError" : state === "WARNING" ? "ConsoleError" : "NetworkFailure";

    return {
      id: `runtime-${index + 1}-${checkpointId}`,
      eventType,
      type: eventType,
      message: normalizeRuntimeEventMessage(eventType, `State ${state}`),
      timestamp,
      severity: state === "ERROR" ? "ERROR" : "WARNING",
      filePath,
      line: changedLineFromFindings(findings),
      stackPreview: buildRuntimeStackPreview(`State ${state}`, checkpointId, filePath),
      linkedCheckpointId: checkpointId,
      linkedIncidentId: `incident-${timestamp}`,
      runtimeConfirmed: state === "ERROR" || checkpoint,
      confirmationState: state === "ERROR" ? "RUNTIME_CONFIRMED" : state === "WARNING" ? "SUSPECTED" : "MITIGATED",
      evidenceCount: Math.max(1, findings.length + probableRootCauses.length)
    };
  }

  function normalizeRuntimeEventType(value) {
    const normalized = String(value || "ConsoleError").trim();

    if (normalized === "RuntimeError" || normalized === "UnhandledRejection" || normalized === "ConsoleError" || normalized === "NetworkFailure") {
      return normalized;
    }

    const legacy = normalized.toUpperCase();
    if (legacy === "RUNTIME_ERROR") {
      return "RuntimeError";
    }
    if (legacy === "UNHANDLED_REJECTION") {
      return "UnhandledRejection";
    }
    if (legacy === "CONSOLE_ERROR") {
      return "ConsoleError";
    }
    if (legacy === "NETWORK_FAILURE") {
      return "NetworkFailure";
    }

    return "ConsoleError";
  }

  function normalizeRuntimeConfirmationState(value, state, runtimeConfirmed) {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "SUSPECTED" || normalized === "RUNTIME_CONFIRMED" || normalized === "MITIGATED" || normalized === "RESOLVED") {
      return normalized;
    }

    if (runtimeConfirmed) {
      return "RUNTIME_CONFIRMED";
    }

    return state === "NORMAL" ? "RESOLVED" : "SUSPECTED";
  }

  function normalizeRuntimeEventMessage(eventType, analysis) {
    if (eventType === "RuntimeError") {
      return `Runtime error: ${analysis}`;
    }

    if (eventType === "UnhandledRejection") {
      return `Unhandled promise rejection: ${analysis}`;
    }

    if (eventType === "NetworkFailure") {
      return `Network/API failure: ${analysis}`;
    }

    return `Console error: ${analysis}`;
  }

  function buildRuntimeStackPreview(message, checkpointId, filePath) {
    const fileName = filePath ? filePath.split(/[\\/]/).pop() : "runtime";
    return [
      message,
      `at ${fileName}`,
      `linked checkpoint ${checkpointId}`
    ];
  }

  function changedLineFromFindings(findings) {
    const firstFinding = findings[0];
    const firstRange = firstFinding && Array.isArray(firstFinding.lineRanges) ? firstFinding.lineRanges[0] : undefined;
    return firstRange && Number.isFinite(Number(firstRange[0])) ? Number(firstRange[0]) : 1;
  }

  function buildCheckpointId(filePath, timestamp) {
    return `${filePath}::${timestamp}`.replace(/[^A-Za-z0-9_-]/g, '-');
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
    if (normalized === "OPEN" || normalized === "MITIGATED" || normalized === "RESOLVED") {
      return normalized;
    }

    return fallbackState === "ERROR" ? "OPEN" : fallbackState === "WARNING" ? "MITIGATED" : "RESOLVED";
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
    const checkpointIds = [0, 1, 2, 3].map((index) => buildCheckpointId(`src/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.ts`, `demo-${scenario.name}-${index}`));
    const runtimeEvents = buildDemoRuntimeEvents(scenario, checkpointIds);
    const incidents = buildDemoIncidents(scenario, findings, probableRootCauses, runtimeEvents, checkpointIds);

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
        checkpointId: checkpointIds[0],
        relatedFiles,
        impactedFiles,
        runtimeEvents: [],
        incidents: buildDemoIncidents(
          scenario,
          [{ id: "finding-baseline", message: "Baseline snapshot captured.", severity: "INFO", confidence: 0.91, lineRanges: [[1, 1]] }],
          [{ id: "root-cause-baseline", filePath: scenario.name, reason: "No regression detected yet.", confidence: 0.95, linkedEvidence: ["finding-baseline"] }],
          [],
          checkpointIds
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
        checkpointId: checkpointIds[1],
        relatedFiles,
        impactedFiles,
        runtimeEvents: runtimeEvents.slice(0, 1),
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
        checkpointId: checkpointIds[2],
        relatedFiles,
        impactedFiles,
        runtimeEvents,
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
        checkpointId: checkpointIds[3],
        relatedFiles,
        impactedFiles,
        runtimeEvents,
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

  function buildDemoRuntimeEvents(scenario, checkpointIds) {
    const baseFile = `src/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.ts`;
    return [
      {
        id: `runtime-${scenario.name.toLowerCase().replace(/\s+/g, "-")}-1`,
        eventType: "NetworkFailure",
        type: "NetworkFailure",
        message: `${scenario.analysis.summary} API request failed at runtime.`,
        timestamp: new Date(Date.now() - 82000).toISOString(),
        severity: "ERROR",
        filePath: baseFile,
        line: scenario.changedLineRanges[0]?.[0] || 1,
        stackPreview: [
          "Network/API failure",
          `at ${baseFile}: ${scenario.changedLineRanges[0]?.[0] || 1}`,
          `linked checkpoint ${checkpointIds[1]}`
        ],
        linkedCheckpointId: checkpointIds[1],
        linkedIncidentId: `incident-${scenario.name.toLowerCase().replace(/\s+/g, "-")}`,
        runtimeConfirmed: true,
        confirmationState: "RUNTIME_CONFIRMED",
        evidenceCount: 3
      },
      {
        id: `runtime-${scenario.name.toLowerCase().replace(/\s+/g, "-")}-2`,
        eventType: "ConsoleError",
        type: "ConsoleError",
        message: "Console error surfaced during follow-up execution.",
        timestamp: new Date(Date.now() - 38000).toISOString(),
        severity: "WARNING",
        filePath: baseFile,
        line: scenario.changedLineRanges[0]?.[0] || 1,
        stackPreview: [
          "Console error",
          `at ${baseFile}: ${scenario.changedLineRanges[0]?.[0] || 1}`,
          `linked checkpoint ${checkpointIds[2]}`
        ],
        linkedCheckpointId: checkpointIds[2],
        linkedIncidentId: `incident-${scenario.name.toLowerCase().replace(/\s+/g, "-")}`,
        runtimeConfirmed: false,
        confirmationState: "SUSPECTED",
        evidenceCount: 2
      }
    ];
  }

  function buildDemoIncidents(scenario, findings, probableRootCauses, runtimeEvents, checkpointIds) {
    return [
      {
        id: `incident-${scenario.name.toLowerCase().replace(/\s+/g, "-")}`,
        summary: scenario.analysis.summary,
        status: "OPEN",
        runtimeConfirmationState: runtimeEvents.length > 0 ? "RUNTIME_CONFIRMED" : "SUSPECTED",
        runtimeConfirmed: runtimeEvents.some((event) => event.runtimeConfirmed),
        statusReason: runtimeEvents.length > 0 ? "Runtime evidence confirms the issue is still active." : "Static analysis only.",
        timelineTrail: [
          { timestamp: new Date(Date.now() - 150000).toISOString(), state: "NORMAL", checkpoint: false, score: 16, label: "Baseline" },
          { timestamp: new Date(Date.now() - 70000).toISOString(), state: "WARNING", checkpoint: false, score: 42, label: "Risk surfaced" },
          { timestamp: new Date().toISOString(), state: "ERROR", checkpoint: true, score: 91, label: "Checkpoint" }
        ],
        surfacedFile: `src/${scenario.name.toLowerCase().replace(/\s+/g, "-")}.ts`,
        linkedCheckpointId: checkpointIds[3],
        linkedFindings: findings.map((finding) => finding.id),
        probableCauses: probableRootCauses.map((cause) => cause.id),
        linkedRuntimeEvents: runtimeEvents.map((event) => event.id),
        lastRuntimeEventAt: runtimeEvents[0]?.timestamp,
        evidenceCount: findings.length + runtimeEvents.length
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
    appState.codePane = buildFallbackCodePaneFromEntry(appState.demoEntries[appState.selectedIndex]);
    appState.timelineItems = buildTimelineItemsFromEntries(appState.demoEntries);
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
    appState.codePane = undefined;
    appState.timelineItems = [];
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
    if (appState.selectedIndex >= entries.length - 1) {
      appState.selectedIndex = 0;
    }
    updateView({ animateText: false });
    focusSelectedCheckpoint("center");

    let index = appState.selectedIndex;
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
    }, replayDuration);
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
  renderRuntimeEvents(selected.runtimeEvents, selected);
  renderIncidentList(selected.incidents, selected);
  renderIncidentDetail(selected, getSelectedIncident(selected));
  renderUnifiedTimeline(selected);
    renderFileContext(selected.relatedFiles, selected.impactedFiles);
    updateCode(selected);
    updateSignalChart(entries, selected);
    updateAnalysis(selected, animateText);
  }

  function renderEmptyPanels() {
    elements.checkpointState.textContent = "WAITING";
    elements.checkpointState.className = "checkpoint-state-value";
    elements.checkpointScore.textContent = "0";
    elements.checkpointTransition.textContent = "Awaiting checkpoint";
    elements.checkpointSummary.textContent = "Save the file again or let the backend publish history to populate the structured debugger panels.";
    elements.checkpointTimestamp.textContent = "No checkpoint history yet.";
    elements.rootCard.classList.remove("hidden");
    elements.rootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
    elements.overviewRootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
    elements.overviewRootCauseSummary.textContent = "AI inferred causes will appear when findings are available.";
    elements.findingsList.innerHTML = '<div class="empty-state">No findings yet.</div>';
    elements.runtimeEventsList.innerHTML = '<div class="empty-state">No runtime events captured yet.</div>';
    elements.timelineStream.innerHTML = '<div class="empty-state">No unified timeline events yet.</div>';
    elements.incidentList.innerHTML = '<div class="empty-state">No incidents yet.</div>';
    renderEmptyRuntimeDetail();
    renderEmptyIncidentDetail();
    elements.relatedFilesList.innerHTML = '<div class="empty-state">No related files yet.</div>';
    elements.impactedFilesList.innerHTML = '<div class="empty-state">No impacted files yet.</div>';
    elements.changedLines.innerHTML = '<span class="impact-chip">No changed lines yet</span>';
    elements.beforeCodeWindow.innerHTML = '<div class="code-line"><span class="code-line-number">1</span><span>// waiting for checkpoint data</span></div>';
    elements.afterCodeWindow.innerHTML = '<div class="code-line"><span class="code-line-number">1</span><span>// waiting for checkpoint data</span></div>';
    elements.beforeFocusLine.textContent = "Focus L-";
    elements.afterFocusLine.textContent = "Focus L-";
    elements.codeNavActions.innerHTML = '<div class="empty-state">No navigation targets available yet.</div>';
    elements.codeFlowSummary.textContent = "Flow will appear after analysis payload arrives.";
    elements.codeFlowNodes.innerHTML = '<div class="empty-state">No flow inference available yet.</div>';
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
    const minWidth = Math.max(260, elements.timelineWrap.clientWidth - 2);
    const calculatedWidth = Math.max(minWidth, 40 + Math.max(0, entryCount - 1) * timelineStep + 24);
    elements.timelineInner.style.width = `${calculatedWidth}px`;
    elements.timelineStamps.style.setProperty("--stamp-width", `${timelineStep}px`);
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
    const scrollBehavior = behavior === "center" ? "smooth" : "auto";
    scrollTimelineToIndex(appState.selectedIndex, scrollBehavior);
  }

  function scrollTimelineToIndex(index, behavior) {
    const targetCenter = 16 + (index * timelineStep);
    const targetLeft = Math.max(0, targetCenter - (elements.timelineWrap.clientWidth / 2));

    if (typeof elements.timelineWrap.scrollTo === "function") {
      elements.timelineWrap.scrollTo({ left: targetLeft, behavior });
    } else {
      elements.timelineWrap.scrollLeft = targetLeft;
    }

    if (typeof elements.timelineStamps.scrollTo === "function") {
      elements.timelineStamps.scrollTo({ left: targetLeft, behavior });
    } else {
      elements.timelineStamps.scrollLeft = targetLeft;
    }
  }

  function updateTimelineProgress(entries) {
    if (!entries.length) {
      elements.timelineProgress.style.width = "0%";
      elements.timelineProgress.style.left = "16px";
      return;
    }

    const nodeButtons = Array.from(elements.timelineNodes.querySelectorAll(".node"));
    const firstNode = nodeButtons[0];
    const selectedNode = nodeButtons[Math.max(0, Math.min(nodeButtons.length - 1, appState.selectedIndex))];

    if (!firstNode || !selectedNode) {
      elements.timelineProgress.style.width = "0%";
      elements.timelineProgress.style.left = "16px";
      return;
    }

    const innerRect = elements.timelineInner.getBoundingClientRect();
    const firstRect = firstNode.getBoundingClientRect();
    const selectedRect = selectedNode.getBoundingClientRect();

    const firstCenter = (firstRect.left - innerRect.left) + (firstRect.width / 2);
    const selectedCenter = (selectedRect.left - innerRect.left) + (selectedRect.width / 2);
    const start = Math.max(16, firstCenter);
    const width = Math.max(0, selectedCenter - start);

    elements.timelineProgress.style.left = `${start}px`;
    elements.timelineProgress.style.width = `${width}px`;
  }

  function updateCheckpointDetails(entry) {
    elements.checkpointState.textContent = entry.state;
    elements.checkpointState.className = `checkpoint-state-value ${stateClass(entry.state)}`;
    elements.checkpointScore.textContent = `${entry.score}`;
    elements.checkpointTransition.textContent = `${entry.previousState} → ${entry.state}`;
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
      elements.overviewRootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
      elements.overviewRootCauseSummary.textContent = "No strong root-cause signal is available for the selected checkpoint.";
      return;
    }

    const renderedRootCauses = probableRootCauses
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

    elements.rootCauseList.innerHTML = renderedRootCauses;
    elements.overviewRootCauseList.innerHTML = renderedRootCauses;

    const top = probableRootCauses[0];
    elements.overviewRootCauseSummary.textContent = top
      ? `Top inferred cause: ${top.reason || top.filePath || "Unknown"}`
      : "AI inferred causes for the selected checkpoint.";
  }

  function renderRuntimeEvents(runtimeEvents, selectedEntry) {
    if (!Array.isArray(runtimeEvents) || runtimeEvents.length === 0) {
      elements.runtimeEventsList.innerHTML = '<div class="empty-state">No runtime events captured yet. This incident is currently based on static analysis only.</div>';
      renderEmptyRuntimeDetail();
      return;
    }

    elements.runtimeEventsList.innerHTML = runtimeEvents
      .map((event) => {
        const selected = appState.selectedRuntimeEventId ? appState.selectedRuntimeEventId === event.id : runtimeEvents[0]?.id === event.id;
        const confirmedClass = runtimeConfirmationClass(event.confirmationState, event.runtimeConfirmed);
        const checkpointLabel = event.linkedCheckpointId ? event.linkedCheckpointId : "No checkpoint linked";
        return `
          <button class="runtime-event-item ${selected ? "selected" : ""}" type="button" data-runtime-event-id="${escapeHtml(event.id)}">
            <div class="finding-topline">
              <strong>${escapeHtml(formatRuntimeEventTypeLabel(event.type || event.eventType))}</strong>
              <span class="mini-pill ${confirmedClass}">${escapeHtml(runtimeConfirmationLabel(event.confirmationState, event.runtimeConfirmed))}</span>
            </div>
            <p>${escapeHtml(String(event.message))}</p>
            <div class="finding-meta">
              <span>${escapeHtml(formatRuntimeLocation(event))}</span>
              <span>${escapeHtml(checkpointLabel)}</span>
            </div>
          </button>
        `;
      })
      .join("");

    elements.runtimeEventsList.querySelectorAll("[data-runtime-event-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const eventId = button.getAttribute("data-runtime-event-id");
        if (!eventId) {
          return;
        }

        appState.selectedRuntimeEventId = eventId;
        renderRuntimeEvents(runtimeEvents, selectedEntry);
        renderRuntimeEventDetail(runtimeEvents.find((event) => event.id === eventId));
        const linkedIncident = findIncidentForRuntimeEvent(selectedEntry, eventId);
        if (linkedIncident) {
          appState.selectedIncidentId = linkedIncident.id;
          if (Array.isArray(selectedEntry.incidents)) {
            renderIncidentList(selectedEntry.incidents, selectedEntry);
          }
          renderIncidentDetail(selectedEntry, linkedIncident);
        }
      });
    });

    const selectedEvent = runtimeEvents.find((event) => event.id === appState.selectedRuntimeEventId) || runtimeEvents[0];
    if (selectedEvent && appState.selectedRuntimeEventId !== selectedEvent.id) {
      appState.selectedRuntimeEventId = selectedEvent.id;
    }
    renderRuntimeEventDetail(selectedEvent);
  }

  function renderRuntimeEventDetail(event) {
    if (!event) {
      renderEmptyRuntimeDetail();
      return;
    }

    elements.runtimeDetailType.textContent = formatRuntimeEventTypeLabel(event.type || event.eventType);
    elements.runtimeDetailStatus.textContent = runtimeConfirmationLabel(event.confirmationState, event.runtimeConfirmed);
    elements.runtimeDetailMessage.textContent = event.message;
    elements.runtimeDetailTime.textContent = event.timestamp || "-";
    elements.runtimeDetailFile.textContent = event.filePath || "-";
    elements.runtimeDetailLine.textContent = event.line ? `L${event.line}` : "-";
    elements.runtimeDetailCheckpoint.textContent = event.linkedCheckpointId || "-";
    elements.runtimeDetailStack.textContent = Array.isArray(event.stackPreview) && event.stackPreview.length > 0
      ? event.stackPreview.join("\n")
      : "No stack trace captured yet.";
  }

  function renderEmptyRuntimeDetail() {
    elements.runtimeDetailType.textContent = "No event selected";
    elements.runtimeDetailStatus.textContent = "Waiting";
    elements.runtimeDetailMessage.textContent = "Select a runtime event to inspect stack details and checkpoint links.";
    elements.runtimeDetailTime.textContent = "-";
    elements.runtimeDetailFile.textContent = "-";
    elements.runtimeDetailLine.textContent = "-";
    elements.runtimeDetailCheckpoint.textContent = "-";
    elements.runtimeDetailStack.textContent = "No runtime stack captured yet.";
  }

  function renderUnifiedTimeline(selectedEntry) {
    if (!selectedEntry) {
      elements.timelineStream.innerHTML = '<div class="empty-state">Click a checkpoint to inspect its detail.</div>';
      return;
    }

    elements.timelineStream.innerHTML = `
      <article class="timeline-detail-card ${stateClass(selectedEntry.state)}">
        <div class="timeline-detail-header">
          <span class="timeline-detail-marker ${stateClass(selectedEntry.state)}"></span>
          <strong>${escapeHtml(String(selectedEntry.state))}</strong>
          <span class="mini-pill">${escapeHtml(String(selectedEntry.timestamp))}</span>
        </div>
        <p>${escapeHtml(String(selectedEntry.analysis || "Checkpoint details"))}</p>
        <div class="timeline-detail-transition">${escapeHtml(`${selectedEntry.previousState} → ${selectedEntry.state}`)}</div>
      </article>
    `;
  }

  function renderIncidentDetail(entry, incident) {
    const selectedIncident = incident || getSelectedIncident(entry);
    if (!selectedIncident) {
      renderEmptyIncidentDetail();
      return;
    }

    appState.selectedIncidentId = selectedIncident.id;
    elements.incidentDetailSummary.textContent = selectedIncident.summary;
    elements.incidentDetailStatus.textContent = normalizeIncidentStatusLabel(selectedIncident.status);
    elements.incidentDetailRuntimeConfirmation.textContent = runtimeConfirmationLabel(selectedIncident.runtimeConfirmationState, selectedIncident.runtimeConfirmed);
    elements.incidentDetailSeverity.textContent = `${entry.state} · ${selectedIncident.statusReason}`;
    elements.incidentDetailFile.textContent = selectedIncident.surfacedFile || "-";
    elements.incidentDetailCheckpoint.textContent = selectedIncident.linkedCheckpointId || entry.checkpointId || "-";
    elements.incidentDetailRuntimeCount.textContent = String(selectedIncident.evidenceCount || 0);
    elements.incidentDetailLastRuntime.textContent = selectedIncident.lastRuntimeEventAt || "-";
    elements.incidentDetailReason.textContent = selectedIncident.statusReason || selectedIncident.summary;
    elements.incidentDetailFindings.innerHTML = renderLinkedChips(selectedIncident.linkedFindings, selectedIncident.linkedFindings.length ? "finding" : "none");
    elements.incidentDetailCauses.innerHTML = renderLinkedChips(selectedIncident.probableCauses, selectedIncident.probableCauses.length ? "cause" : "none");
    elements.incidentDetailRuntimeEvents.innerHTML = renderLinkedChips(selectedIncident.linkedRuntimeEvents, selectedIncident.linkedRuntimeEvents.length ? "runtime" : "none");
  }

  function renderEmptyIncidentDetail() {
    elements.incidentDetailSummary.textContent = "No incident selected";
    elements.incidentDetailStatus.textContent = "Waiting";
    elements.incidentDetailRuntimeConfirmation.textContent = "Suspected";
    elements.incidentDetailSeverity.textContent = "No incident selected";
    elements.incidentDetailFile.textContent = "-";
    elements.incidentDetailCheckpoint.textContent = "-";
    elements.incidentDetailRuntimeCount.textContent = "0";
    elements.incidentDetailLastRuntime.textContent = "-";
    elements.incidentDetailReason.textContent = "Select an incident to inspect linked findings, runtime evidence, and file context.";
    elements.incidentDetailFindings.innerHTML = '<div class="empty-state">No findings linked yet.</div>';
    elements.incidentDetailCauses.innerHTML = '<div class="empty-state">No root-cause candidates linked yet.</div>';
    elements.incidentDetailRuntimeEvents.innerHTML = '<div class="empty-state">No runtime evidence linked yet.</div>';
  }

  function renderIncidentList(incidents, selectedEntry) {
    if (!Array.isArray(incidents) || incidents.length === 0) {
      elements.incidentList.innerHTML = '<div class="empty-state">No incidents yet.</div>';
      renderEmptyIncidentDetail();
      return;
    }

    if (!appState.selectedIncidentId || !incidents.some((incident) => incident.id === appState.selectedIncidentId)) {
      appState.selectedIncidentId = incidents[0].id;
    }

    elements.incidentList.innerHTML = incidents
      .map((incident, index) => {
        const trail = Array.isArray(incident.timelineTrail)
          ? incident.timelineTrail.map((point) => `<span class="trail-chip ${stateClass(point.state)}">${escapeHtml(String(point.label || point.state))}</span>`).join("")
          : "";
        const isSelected = appState.selectedIncidentId === incident.id;
        return `
          <button class="incident-item ${isSelected ? "selected" : ""}" type="button" data-incident-index="${index}">
            <div class="finding-topline">
              <strong>${escapeHtml(String(incident.summary || "Incident"))}</strong>
              <span class="mini-pill ${incidentStatusClass(incident.status)}">${escapeHtml(normalizeIncidentStatusLabel(incident.status))}</span>
            </div>
            <p>${escapeHtml(String(incident.surfacedFile || ""))}</p>
            <div class="trail-row">${trail}</div>
            <div class="finding-meta">
              <span>${escapeHtml(runtimeConfirmationLabel(incident.runtimeConfirmationState, incident.runtimeConfirmed))}</span>
              <span>${escapeHtml(String(incident.evidenceCount || 0))} evidence items</span>
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

        appState.selectedIncidentId = incident.id;
        const linkedRuntimeEvent = Array.isArray(incident.linkedRuntimeEvents) ? incident.linkedRuntimeEvents[0] : undefined;
        if (linkedRuntimeEvent) {
          appState.selectedRuntimeEventId = linkedRuntimeEvent;
        }

        renderIncidentList(incidents, selectedEntry);
        if (Array.isArray(selectedEntry.runtimeEvents)) {
          renderRuntimeEvents(selectedEntry.runtimeEvents, selectedEntry);
        }
        renderIncidentDetail(selectedEntry, incident);

        if (linkedRuntimeEvent && Array.isArray(selectedEntry.runtimeEvents)) {
          const runtimeEvent = selectedEntry.runtimeEvents.find((event) => event.id === linkedRuntimeEvent);
          if (runtimeEvent) {
            renderRuntimeEventDetail(runtimeEvent);
          }
        }
      });
    });

    renderIncidentDetail(selectedEntry, getSelectedIncident(selectedEntry));
  }

  function getSelectedIncident(entry) {
    if (!entry || !Array.isArray(entry.incidents) || entry.incidents.length === 0) {
      return undefined;
    }

    return entry.incidents.find((incident) => incident.id === appState.selectedIncidentId) || entry.incidents[0];
  }

  function findIncidentForRuntimeEvent(entry, runtimeEventId) {
    if (!entry || !Array.isArray(entry.incidents)) {
      return undefined;
    }

    return entry.incidents.find((incident) => Array.isArray(incident.linkedRuntimeEvents) && incident.linkedRuntimeEvents.includes(runtimeEventId));
  }

  function renderLinkedChips(values) {
    if (!Array.isArray(values) || values.length === 0) {
      return '<div class="empty-state">None</div>';
    }

    return values.map((value) => `<span class="mini-pill">${escapeHtml(String(value))}</span>`).join("");
  }

  function runtimeConfirmationLabel(state, runtimeConfirmed) {
    const normalized = String(state || "SUSPECTED").toUpperCase();
    if (normalized === "RUNTIME_CONFIRMED" || runtimeConfirmed) {
      return "Runtime Confirmed";
    }

    if (normalized === "MITIGATED") {
      return "Mitigated";
    }

    if (normalized === "RESOLVED") {
      return "Resolved";
    }

    return "Suspected";
  }

  function normalizeIncidentStatusLabel(status) {
    const normalized = String(status || "OPEN").toUpperCase();
    if (normalized === "MITIGATED") {
      return "Mitigated";
    }

    if (normalized === "RESOLVED") {
      return "Resolved";
    }

    return "Open";
  }

  function incidentStatusClass(status) {
    const normalized = String(status || "OPEN").toUpperCase();
    if (normalized === "MITIGATED") {
      return "finding-warning";
    }

    if (normalized === "RESOLVED") {
      return "finding-info";
    }

    return "finding-error";
  }

  function runtimeEventTypeClass(eventType) {
    const normalized = normalizeRuntimeEventType(eventType);
    if (normalized === "NetworkFailure") {
      return "warning";
    }

    if (normalized === "UnhandledRejection") {
      return "error";
    }

    if (normalized === "RuntimeError") {
      return "error";
    }

    return "warning";
  }

  function formatRuntimeEventTypeLabel(eventType) {
    const normalized = normalizeRuntimeEventType(eventType);
    if (normalized === "RuntimeError") {
      return "Runtime Error";
    }
    if (normalized === "UnhandledRejection") {
      return "Unhandled Rejection";
    }
    if (normalized === "NetworkFailure") {
      return "Network Failure";
    }
    return "Console Error";
  }

  function runtimeConfirmationClass(state, runtimeConfirmed) {
    const normalized = runtimeConfirmationLabel(state, runtimeConfirmed);
    if (normalized === "Runtime Confirmed") {
      return "finding-error";
    }

    if (normalized === "Mitigated") {
      return "finding-warning";
    }

    if (normalized === "Resolved") {
      return "finding-info";
    }

    return "finding-warning";
  }

  function formatRuntimeLocation(event) {
    const location = event.filePath ? event.filePath.split(/[\\/]/).pop() : "unknown file";
    const line = event.line ? `:${event.line}` : "";
    return `${location}${line}`;
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
          <strong>${escapeHtml(String(item.filePath || ""))}</strong>
          <p>${escapeHtml(String(item.reason || "Contextual file"))}</p>
        </article>
      `)
      .join("");
  }

  function renderCompatibilitySummary(entry) {
    const summary = entry.analysis;
    elements.summary.textContent = summary;
  }

  function updateCode(entry) {
    const codePane = normalizeCodePane(appState.codePane, entry);
    const focusedLine = getPreferredFocusLine(codePane, entry);
    const beforeSnippet = selectSnippet(codePane.beforeSnippet, entry.codePreview.before, focusedLine, entry.codePreview.startLine || 1);
    const afterSnippet = selectSnippet(codePane.afterSnippet, entry.codePreview.after, focusedLine, entry.codePreview.startLine || 1);

    elements.beforeCodeWindow.innerHTML = renderSnippetLines(beforeSnippet);
    elements.afterCodeWindow.innerHTML = renderSnippetLines(afterSnippet);
    elements.beforeFocusLine.textContent = `Focus L${focusedLine}`;
    elements.afterFocusLine.textContent = `Focus L${focusedLine}`;

    renderCodeNavigation(codePane, entry, focusedLine);
    renderCodeFlow(codePane.flow);
  }

  function normalizeCodePane(rawCodePane, entry) {
    if (rawCodePane && typeof rawCodePane === "object") {
      return {
        currentFile: String(rawCodePane.currentFile || entry.filePath || ""),
        beforeSnippet: normalizeSnippet(rawCodePane.beforeSnippet, entry.codePreview.before, entry.codePreview.startLine || 1, entry.codePreview.focusLine || 1),
        afterSnippet: normalizeSnippet(rawCodePane.afterSnippet, entry.codePreview.after, entry.codePreview.startLine || 1, entry.codePreview.focusLine || 1),
        findingLocations: Array.isArray(rawCodePane.findingLocations) ? rawCodePane.findingLocations.map((location) => ({
          id: String(location.id || "finding"),
          message: String(location.message || "Finding"),
          filePath: String(location.filePath || entry.filePath || ""),
          line: Number.isFinite(Number(location.line)) ? Number(location.line) : undefined,
          severity: String(location.severity || "warning")
        })) : [],
        runtimeLocations: Array.isArray(rawCodePane.runtimeLocations) ? rawCodePane.runtimeLocations.map((location) => ({
          id: String(location.id || "runtime"),
          message: String(location.message || "Runtime event"),
          eventType: normalizeRuntimeEventType(location.eventType || location.type),
          type: normalizeRuntimeEventType(location.eventType || location.type),
          filePath: String(location.filePath || entry.filePath || ""),
          line: Number.isFinite(Number(location.line)) ? Number(location.line) : undefined,
          column: Number.isFinite(Number(location.column)) ? Number(location.column) : undefined
        })) : [],
        rootCauseFiles: Array.isArray(rawCodePane.rootCauseFiles) ? rawCodePane.rootCauseFiles.map(String) : [],
        relatedFiles: Array.isArray(rawCodePane.relatedFiles) ? rawCodePane.relatedFiles.map(String) : entry.relatedFiles.map((item) => item.filePath),
        impactedFiles: Array.isArray(rawCodePane.impactedFiles) ? rawCodePane.impactedFiles.map(String) : entry.impactedFiles.map((item) => item.filePath),
        flow: normalizeFlow(rawCodePane.flow, entry)
      };
    }

    return buildFallbackCodePaneFromEntry(entry);
  }

  function buildFallbackCodePaneFromEntry(entry) {
    const baseFile = entry.filePath || "";
    return {
      currentFile: baseFile,
      beforeSnippet: normalizeSnippet(undefined, entry.codePreview.before, entry.codePreview.startLine || 1, entry.codePreview.focusLine || 1),
      afterSnippet: normalizeSnippet(undefined, entry.codePreview.after, entry.codePreview.startLine || 1, entry.codePreview.focusLine || 1),
      findingLocations: (entry.findings || []).map((finding) => ({
        id: String(finding.id || "finding"),
        message: String(finding.message || "Finding"),
        filePath: baseFile,
        line: Array.isArray(finding.lineRanges) && finding.lineRanges[0] ? Number(finding.lineRanges[0][0]) : undefined,
        severity: String(finding.severity || "warning")
      })),
      runtimeLocations: (entry.runtimeEvents || []).map((event) => ({
        id: String(event.id || "runtime"),
        message: String(event.message || "Runtime event"),
        eventType: normalizeRuntimeEventType(event.type || event.eventType),
        type: normalizeRuntimeEventType(event.type || event.eventType),
        filePath: String(event.filePath || baseFile),
        line: Number.isFinite(Number(event.line)) ? Number(event.line) : undefined,
        column: undefined
      })),
      rootCauseFiles: (entry.probableRootCauses || []).map((candidate) => String(candidate.filePath || "")).filter(Boolean),
      relatedFiles: (entry.relatedFiles || []).map((file) => String(file.filePath || "")).filter(Boolean),
      impactedFiles: (entry.impactedFiles || []).map((file) => String(file.filePath || "")).filter(Boolean),
      flow: normalizeFlow(undefined, entry)
    };
  }

  function normalizeSnippet(rawSnippet, fallbackLines, fallbackStartLine, fallbackFocusLine) {
    if (rawSnippet && typeof rawSnippet === "object" && Array.isArray(rawSnippet.lines) && rawSnippet.lines.length > 0) {
      return {
        startLine: Number.isFinite(Number(rawSnippet.startLine)) ? Number(rawSnippet.startLine) : fallbackStartLine,
        focusLine: Number.isFinite(Number(rawSnippet.focusLine)) ? Number(rawSnippet.focusLine) : fallbackFocusLine,
        lines: rawSnippet.lines.map((line) => String(line))
      };
    }

    return {
      startLine: fallbackStartLine,
      focusLine: fallbackFocusLine,
      lines: Array.isArray(fallbackLines) && fallbackLines.length > 0 ? fallbackLines : ["// no preview available"]
    };
  }

  function normalizeFlow(rawFlow, entry) {
    if (rawFlow && typeof rawFlow === "object") {
      const nodes = Array.isArray(rawFlow.nodes) ? rawFlow.nodes.map((node, index) => ({
        id: String(node.id || `node-${index + 1}`),
        label: String(node.label || "module"),
        role: String(node.role || "Module"),
        kind: String(node.kind || "related")
      })) : [];
      const edges = Array.isArray(rawFlow.edges) ? rawFlow.edges.map((edge) => ({
        from: String(edge.from || ""),
        to: String(edge.to || ""),
        label: edge.label ? String(edge.label) : ""
      })).filter((edge) => edge.from && edge.to) : [];
      return {
        title: String(rawFlow.title || "Inferred Code Path"),
        summary: String(rawFlow.summary || "Inferred from file and dependency signals."),
        nodes,
        edges
      };
    }

    const currentFile = entry.filePath || "current file";
    const candidates = [
      currentFile,
      ...(entry.relatedFiles || []).map((item) => item.filePath),
      ...(entry.impactedFiles || []).map((item) => item.filePath),
      ...(entry.probableRootCauses || []).map((candidate) => candidate.filePath)
    ].filter(Boolean);
    const unique = [...new Set(candidates)].slice(0, 6);
    const nodes = unique.map((label, index) => ({
      id: `node-${index + 1}`,
      label,
      role: inferRoleFromLabel(label),
      kind: index === 0 ? "current" : "related"
    }));
    const edges = nodes.slice(1).map((node) => ({
      from: nodes[0].id,
      to: node.id,
      label: "touches"
    }));

    return {
      title: "Inferred Code Path",
      summary: "Fallback flow inferred from related, impacted, and root-cause file signals.",
      nodes,
      edges
    };
  }

  function inferRoleFromLabel(label) {
    const value = String(label || "").toLowerCase();
    if (/route|router|endpoint/.test(value)) { return "Route"; }
    if (/controller|handler/.test(value)) { return "Handler"; }
    if (/service|manager|provider/.test(value)) { return "Service"; }
    if (/repo|repository|dao/.test(value)) { return "Repository"; }
    if (/cache|redis/.test(value)) { return "Cache"; }
    if (/db|database|postgres|mongo|prisma|sql/.test(value)) { return "Database"; }
    if (/api|client|fetch|axios/.test(value)) { return "API Client"; }
    if (/worker|job|queue/.test(value)) { return "Worker"; }
    if (/auth|middleware/.test(value)) { return "Middleware"; }
    return "Module";
  }

  function getPreferredFocusLine(codePane, entry) {
    const finding = (codePane.findingLocations || []).find((item) => item.id === appState.selectedFindingId)
      || (codePane.findingLocations || [])[0];
    if (finding && Number.isFinite(Number(finding.line))) {
      return Number(finding.line);
    }

    const runtime = (codePane.runtimeLocations || []).find((item) => item.id === appState.selectedRuntimeEventId)
      || (codePane.runtimeLocations || [])[0];
    if (runtime && Number.isFinite(Number(runtime.line))) {
      return Number(runtime.line);
    }

    if (entry.codePreview && Number.isFinite(Number(entry.codePreview.focusLine))) {
      const startLine = Number(entry.codePreview.startLine || 1);
      return startLine + Number(entry.codePreview.focusLine) - 1;
    }

    return Number(codePane.afterSnippet.focusLine || 1);
  }

  function selectSnippet(snippet, fallbackLines, focusedLine, fallbackStartLine) {
    const normalized = normalizeSnippet(snippet, fallbackLines, fallbackStartLine, focusedLine);
    if (focusedLine >= normalized.startLine && focusedLine <= normalized.startLine + normalized.lines.length - 1) {
      return {
        ...normalized,
        focusLine: focusedLine
      };
    }

    return normalized;
  }

  function renderSnippetLines(snippet) {
    const focus = Math.max(1, Number(snippet.focusLine) || 1);
    return snippet.lines
      .map((line, index) => {
        const lineNumber = Number(snippet.startLine) + index;
        const lineClass = lineNumber === focus ? "code-line problem" : "code-line";
        return `<div class="${lineClass}"><span class="code-line-number">${lineNumber}</span><span>${escapeHtml(String(line))}</span></div>`;
      })
      .join("");
  }

  function renderCodeNavigation(codePane, entry, focusedLine) {
    const buttons = [];

    codePane.findingLocations.slice(0, 3).forEach((finding) => {
      const lineLabel = finding.line ? `L${finding.line}` : "file";
      buttons.push(`
        <button class="code-nav-btn" type="button" data-nav-type="finding" data-id="${escapeHtml(finding.id)}" data-file="${escapeHtml(finding.filePath)}" data-line="${finding.line || ""}">
          Jump to finding: ${escapeHtml(lineLabel)}
        </button>
      `);
    });

    codePane.runtimeLocations.slice(0, 3).forEach((runtimeEvent) => {
      const lineLabel = runtimeEvent.line ? `L${runtimeEvent.line}` : "file";
      buttons.push(`
        <button class="code-nav-btn" type="button" data-nav-type="runtime" data-id="${escapeHtml(runtimeEvent.id)}" data-file="${escapeHtml(runtimeEvent.filePath)}" data-line="${runtimeEvent.line || ""}" data-column="${runtimeEvent.column || ""}">
          Jump to runtime event: ${escapeHtml(lineLabel)}
        </button>
      `);
    });

    codePane.rootCauseFiles.slice(0, 3).forEach((rootFile) => {
      buttons.push(`
        <button class="code-nav-btn" type="button" data-nav-type="root" data-file="${escapeHtml(rootFile)}">
          Open root-cause file: ${escapeHtml(trimPathLabel(rootFile))}
        </button>
      `);
    });

    codePane.relatedFiles.slice(0, 2).forEach((relatedFile) => {
      buttons.push(`
        <button class="code-nav-btn" type="button" data-nav-type="related" data-file="${escapeHtml(relatedFile)}">
          Open related file: ${escapeHtml(trimPathLabel(relatedFile))}
        </button>
      `);
    });

    codePane.impactedFiles.slice(0, 2).forEach((impactedFile) => {
      buttons.push(`
        <button class="code-nav-btn" type="button" data-nav-type="impacted" data-file="${escapeHtml(impactedFile)}">
          Open impacted file: ${escapeHtml(trimPathLabel(impactedFile))}
        </button>
      `);
    });

    if (buttons.length === 0) {
      elements.codeNavActions.innerHTML = '<div class="empty-state">No navigation targets available for this checkpoint.</div>';
    } else {
      elements.codeNavActions.innerHTML = buttons.join("");
    }

    elements.codeNavActions.querySelectorAll("[data-nav-type]").forEach((button) => {
      button.addEventListener("click", () => {
        const navType = button.getAttribute("data-nav-type");
        const filePath = button.getAttribute("data-file") || codePane.currentFile || entry.filePath;
        const line = Number(button.getAttribute("data-line"));
        const column = Number(button.getAttribute("data-column"));
        const itemId = button.getAttribute("data-id");

        if (navType === "finding") {
          appState.selectedFindingId = itemId || appState.selectedFindingId;
          vscode.postMessage({
            type: "openLocation",
            payload: {
              filePath,
              line: Number.isFinite(line) && line > 0 ? line : focusedLine
            }
          });
          updateCode(entry);
          return;
        }

        if (navType === "runtime") {
          appState.selectedRuntimeEventId = itemId || appState.selectedRuntimeEventId;
          vscode.postMessage({
            type: "openLocation",
            payload: {
              filePath,
              line: Number.isFinite(line) && line > 0 ? line : focusedLine,
              column: Number.isFinite(column) && column > 0 ? column : undefined
            }
          });
          updateCode(entry);
          return;
        }

        if (navType === "root") {
          appState.selectedRootCauseFile = filePath;
          vscode.postMessage({ type: "openFile", payload: { filePath } });
          return;
        }

        if (navType === "related" || navType === "impacted") {
          vscode.postMessage({ type: "openFile", payload: { filePath } });
        }
      });
    });
  }

  function submitManualGoToLine() {
    if (!elements.codeGoLineInput) {
      return;
    }
    const value = Number(elements.codeGoLineInput.value);
    if (!Number.isFinite(value) || value < 1) {
      return;
    }

    const selectedEntry = getSelectedEntry();
    const activeCodePane = normalizeCodePane(appState.codePane, selectedEntry || {
      filePath: "",
      codePreview: { before: [], after: [], startLine: 1, focusLine: 1 },
      findings: [],
      runtimeEvents: [],
      probableRootCauses: [],
      relatedFiles: [],
      impactedFiles: []
    });

    vscode.postMessage({
      type: "goToLine",
      payload: {
        filePath: activeCodePane.currentFile || selectedEntry?.filePath,
        line: value
      }
    });
  }

  function renderCodeFlow(flow) {
    if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
      elements.codeFlowSummary.textContent = "No inferred flow available for this checkpoint.";
      elements.codeFlowNodes.innerHTML = '<div class="empty-state">No dependency path inferred.</div>';
      return;
    }

    elements.codeFlowSummary.textContent = flow.summary || "Inferred from imports, impacted files, and naming heuristics.";

    const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
    const renderedEdges = Array.isArray(flow.edges) ? flow.edges : [];

    elements.codeFlowNodes.innerHTML = flow.nodes
      .map((node) => {
        const outgoing = renderedEdges.filter((edge) => edge.from === node.id).map((edge) => {
          const target = nodeById.get(edge.to);
          if (!target) {
            return "";
          }
          const label = edge.label ? `${edge.label} -> ` : "-> ";
          return `<span class="mini-pill">${escapeHtml(label + target.role)}</span>`;
        }).join("");
        return `
          <article class="flow-node-card flow-${escapeHtml(String(node.kind || "related"))}">
            <div class="finding-topline">
              <strong>${escapeHtml(node.role)}</strong>
              <span class="mini-pill">${escapeHtml(String(node.kind || "related"))}</span>
            </div>
            <p>${escapeHtml(trimPathLabel(node.label))}</p>
            <div class="finding-meta">${outgoing || '<span class="mini-pill">leaf</span>'}</div>
          </article>
        `;
      })
      .join("");
  }

  function trimPathLabel(filePath) {
    const parts = String(filePath || "").split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) {
      return String(filePath || "");
    }
    return `${parts.slice(-2).join("/")}`;
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
