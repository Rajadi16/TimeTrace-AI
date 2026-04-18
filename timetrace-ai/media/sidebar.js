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
    rootCard: document.getElementById("root-cause-card") || document.getElementById("overview-root-cause-card"),
    rootCauseList: document.getElementById("root-cause-list") || document.getElementById("overview-root-cause-list"),
    snippetLayout: document.querySelector(".snippet-layout"),
    beforeSnippetPanel: document.getElementById("before-snippet-panel"),
    afterSnippetPanel: document.getElementById("after-snippet-panel"),
    beforeCodeWindow: document.getElementById("before-code-window"),
    afterCodeWindow: document.getElementById("after-code-window"),
    beforeFocusLine: document.getElementById("before-focus-line"),
    afterFocusLine: document.getElementById("after-focus-line"),
    snippetTabBefore: document.getElementById("snippet-tab-before"),
    snippetTabAfter: document.getElementById("snippet-tab-after"),
    snippetModeTab: document.getElementById("snippet-mode-tab"),
    snippetModeSplit: document.getElementById("snippet-mode-split"),
    codeNavActions: document.getElementById("code-nav-actions"),
    codeGoLineInput: document.getElementById("code-go-line-input"),
    codeGoLineBtn: document.getElementById("code-go-line-btn"),
    codeFlowSummary: document.getElementById("code-flow-summary"),
    flowHeroHost: document.getElementById("flow-hero-host"),
    flowLaneHost: document.getElementById("flow-lane-host"),
    codeFlowNodes: document.getElementById("code-flow-nodes"),
    changedLines: document.getElementById("changed-lines"),
    findingsOverview: document.getElementById("findings-overview"),
    findingsList: document.getElementById("findings-list"),
    incidentOverview: document.getElementById("incident-overview"),
    incidentSearchInput: document.getElementById("incident-search-input"),
    incidentStatusFilter: document.getElementById("incident-status-filter"),
    incidentRuntimeOnly: document.getElementById("incident-runtime-only"),
    incidentFilterReset: document.getElementById("incident-filter-reset"),
    runtimeEventsList: document.getElementById("runtime-events-list"),
    runtimeEventsCount: document.getElementById("runtime-events-count"),
    runtimeEventsLoaded: document.getElementById("runtime-events-loaded"),
    runtimeDetailType: document.getElementById("runtime-detail-type"),
    runtimeDetailStatus: document.getElementById("runtime-detail-status"),
    runtimeDetailMessage: document.getElementById("runtime-detail-message"),
    runtimeDetailTime: document.getElementById("runtime-detail-time"),
    runtimeDetailFile: document.getElementById("runtime-detail-file"),
    runtimeDetailLine: document.getElementById("runtime-detail-line"),
    runtimeDetailCheckpoint: document.getElementById("runtime-detail-checkpoint"),
    incidentList: document.getElementById("incident-list"),
    incidentDetailSummary: document.getElementById("incident-detail-summary"),
    incidentDetailStatus: document.getElementById("incident-detail-status"),
    incidentDetailRuntimeConfirmation: document.getElementById("incident-detail-runtime-confirmation"),
    incidentDetailFile: document.getElementById("incident-detail-file"),
    incidentDetailCheckpoint: document.getElementById("incident-detail-checkpoint"),
    incidentDetailRuntimeCount: document.getElementById("incident-detail-runtime-count"),
    incidentDetailLastRuntime: document.getElementById("incident-detail-last-runtime"),
    incidentDetailReason: document.getElementById("incident-detail-reason"),
    incidentDetailEvidence: document.getElementById("incident-detail-evidence"),
    relatedFilesList: document.getElementById("related-files-list"),
    impactedFilesList: document.getElementById("impacted-files-list"),
    summary: document.getElementById("analysis-summary"),
    timelineRewind: document.getElementById("timeline-rewind"),
    timelineWrap: document.getElementById("timeline-wrap"),
    sparklinePathBase: document.getElementById("sparkline-path-base"),
    sparklinePathUp: document.getElementById("sparkline-path-up"),
    sparklinePathDown: document.getElementById("sparkline-path-down"),
    sparklinePathFlat: document.getElementById("sparkline-path-flat"),
    sparklineArea: document.getElementById("sparkline-area"),
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
    snippetViewMode: "tab",
    activeSnippetTab: "after",
    timelineItems: [],
    selectedIncidentId: undefined,
    incidentSearchQuery: "",
    incidentStatusFilter: "all",
    incidentRuntimeOnly: false,
    selectedRuntimeEventId: undefined,
    runtimeEventsVisibleCount: 0,
    runtimeEventsSourceKey: undefined,
    findingsVisibleCount: 0,
    findingsSourceKey: undefined,
    incidentsVisibleCount: 0,
    incidentsSourceKey: undefined,
    incidentLinkedVisibleCount: {
      evidence: 0,
    },
    incidentLinkedSourceKeys: {
      evidence: undefined,
    },
    selectedFindingId: undefined,
    selectedRootCauseFile: undefined,
    signalDotX: undefined,
    signalDotY: undefined
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
    restorePersistedUiState();
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

    if (elements.snippetTabBefore) {
      elements.snippetTabBefore.addEventListener("click", () => {
        appState.activeSnippetTab = "before";
        updateSnippetPresentation();
      });
    }

    if (elements.snippetTabAfter) {
      elements.snippetTabAfter.addEventListener("click", () => {
        appState.activeSnippetTab = "after";
        updateSnippetPresentation();
      });
    }

    if (elements.snippetModeTab) {
      elements.snippetModeTab.addEventListener("click", () => {
        appState.snippetViewMode = "tab";
        updateSnippetPresentation();
      });
    }

    if (elements.snippetModeSplit) {
      elements.snippetModeSplit.addEventListener("click", () => {
        appState.snippetViewMode = "split";
        updateSnippetPresentation();
      });
    }

    if (elements.timelinePlayPause) {
      elements.timelinePlayPause.addEventListener("click", toggleReplay);
    }
    if (elements.timelineRewind) {
      elements.timelineRewind.addEventListener("click", () => shiftCheckpoint(-1));
    }

    if (elements.incidentSearchInput) {
      elements.incidentSearchInput.addEventListener("input", () => {
        appState.incidentSearchQuery = String(elements.incidentSearchInput.value || "").trim();
        refreshIncidentWorkspace();
        persistUiState();
      });
    }
    if (elements.incidentStatusFilter) {
      elements.incidentStatusFilter.addEventListener("change", () => {
        appState.incidentStatusFilter = String(elements.incidentStatusFilter.value || "all");
        refreshIncidentWorkspace();
        persistUiState();
      });
    }
    if (elements.incidentRuntimeOnly) {
      elements.incidentRuntimeOnly.addEventListener("change", () => {
        appState.incidentRuntimeOnly = Boolean(elements.incidentRuntimeOnly.checked);
        refreshIncidentWorkspace();
        persistUiState();
      });
    }
    if (elements.incidentFilterReset) {
      elements.incidentFilterReset.addEventListener("click", () => {
        appState.incidentSearchQuery = "";
        appState.incidentStatusFilter = "all";
        appState.incidentRuntimeOnly = false;
        if (elements.incidentSearchInput) {
          elements.incidentSearchInput.value = "";
        }
        if (elements.incidentStatusFilter) {
          elements.incidentStatusFilter.value = "all";
        }
        if (elements.incidentRuntimeOnly) {
          elements.incidentRuntimeOnly.checked = false;
        }
        refreshIncidentWorkspace();
        persistUiState();
      });
    }

    elements.timelineWrap.addEventListener("scroll", () => {
      elements.timelineStamps.scrollLeft = elements.timelineWrap.scrollLeft;
    });

    elements.timelineStamps.addEventListener("scroll", () => {
      elements.timelineWrap.scrollLeft = elements.timelineStamps.scrollLeft;
    });

    // Parallax effect for flow diagram
    const contentArea = document.querySelector(".sidebar-content") || document.documentElement;
    contentArea.addEventListener("scroll", () => {
      const parallaxElement = document.querySelector("[data-parallax-target]");
      if (parallaxElement && contentArea) {
        const scrollY = contentArea.scrollTop || window.scrollY;
        const offset = scrollY * 0.08; // Subtle parallax multiplier
        parallaxElement.style.transform = `translateY(${offset}px)`;
      }
    }, { passive: true });

    elements.paneButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const pane = button.getAttribute("data-pane-target");
        if (!pane) {
          return;
        }
        appState.activePane = pane;
        applyPaneVisibility();
        persistUiState();
      });
    });

    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target) && event.key !== "Escape") {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        if (elements.incidentSearchInput) {
          elements.incidentSearchInput.focus();
          elements.incidentSearchInput.select();
        }
        return;
      }

      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        selectIncidentByDelta(1);
        return;
      }

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        selectIncidentByDelta(-1);
        return;
      }

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
      const nextChangedLineRanges = Array.isArray(payload.changedLineRanges) ? payload.changedLineRanges : latestEntry.changedLineRanges;
      const nextReasons = Array.isArray(payload.reasons) ? payload.reasons : latestEntry.reasons;
      const nextFindings = Array.isArray(payload.findings)
        ? payload.findings.map((item, findingIndex) => normalizeFinding(item, findingIndex, nextChangedLineRanges || [], nextReasons || []))
        : latestEntry.findings;
      const nextRootCauses = Array.isArray(payload.probableRootCauses) && payload.probableRootCauses.length > 0
        ? payload.probableRootCauses.map((item, causeIndex) => normalizeRootCause(item, causeIndex, latestEntry.filePath, nextFindings || []))
        : (Array.isArray(latestEntry.probableRootCauses) && latestEntry.probableRootCauses.length > 0
          ? latestEntry.probableRootCauses
          : buildFallbackRootCauses(latestEntry.filePath, nextReasons || [], nextFindings || []));
      const nextRuntimeEvents = Array.isArray(payload.runtimeEvents)
        ? payload.runtimeEvents.map((item, eventIndex) => normalizeRuntimeEvent(item, eventIndex, latestEntry.filePath || "", latestEntry.checkpointId, latestEntry.timestamp, latestEntry.state, latestEntry.checkpoint, nextFindings || [], nextRootCauses || []))
        : latestEntry.runtimeEvents;
      const nextIncidents = Array.isArray(payload.incidents)
        ? payload.incidents.map((item, incidentIndex) => normalizeIncident(item, incidentIndex, latestEntry.filePath, nextFindings || [], nextRootCauses || [], nextRuntimeEvents || [], latestEntry.score, latestEntry.previousState, latestEntry.state, latestEntry.timestamp, latestEntry.checkpoint, latestEntry.checkpointId))
        : latestEntry.incidents;

      appState.mode = "live";
      appState.liveEntries[latestIndex] = {
        ...latestEntry,
        state: payload.state || latestEntry.state,
        score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : latestEntry.score,
        previousState: payload.previousState || latestEntry.previousState,
        reasons: nextReasons,
        analysis: payload.analysis || latestEntry.analysis,
        changedLineRanges: nextChangedLineRanges,
        findings: nextFindings,
        probableRootCauses: nextRootCauses,
        incidents: nextIncidents,
        runtimeEvents: nextRuntimeEvents,
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
    const checkpointId = String(rawEntry.checkpointId || rawEntry.timestamp || buildCheckpointId(rawEntry.filePath || filePath || "", rawEntry.timestamp || String(index)));
    const findings = Array.isArray(rawEntry.findings)
      ? rawEntry.findings.map((item, findingIndex) => normalizeFinding(item, findingIndex, changedLineRanges, reasons))
      : buildFallbackFindings(reasons, changedLineRanges, rawEntry.analysis);
    const probableRootCauses = Array.isArray(rawEntry.probableRootCauses) && rawEntry.probableRootCauses.length > 0
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
      symbol: rawFinding.symbol ? String(rawFinding.symbol) : undefined,
      kind: rawFinding.kind ? String(rawFinding.kind) : undefined,
      evidence: rawFinding.evidence ? String(rawFinding.evidence) : undefined,
      filePath: rawFinding.filePath ? String(rawFinding.filePath) : undefined,
      timestamp: rawFinding.timestamp ? String(rawFinding.timestamp) : undefined
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
      reason: String(
        rawCause.reason
        || rawCause.message
        || (Array.isArray(rawCause.signals) && rawCause.signals.length > 0 ? rawCause.signals[0] : "Probable cause")
      ),
      confidence: clampConfidence(rawCause.confidence, 0.82 - index * 0.08),
      linkedEvidence: Array.isArray(rawCause.linkedEvidence)
        ? rawCause.linkedEvidence.map(String)
        : Array.isArray(rawCause.signals) && rawCause.signals.length > 0
          ? rawCause.signals.map(String).slice(0, 4)
          : findings.slice(0, 2).map((finding) => finding.id)
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
      summary: String(rawIncident.summary || rawIncident.title || rawIncident.message || "Incident detail"),
      status: incidentStatus,
      runtimeConfirmationState,
      runtimeConfirmed: Boolean(rawIncident.runtimeConfirmed),
      statusReason: String(rawIncident.statusReason || rawIncident.reason || (incidentStatus === "RESOLVED" ? "Incident resolved." : incidentStatus === "OPEN" ? "Incident remains active." : "Incident mitigated.")),
      timelineTrail: Array.isArray(rawIncident.timelineTrail) && rawIncident.timelineTrail.length > 0
        ? rawIncident.timelineTrail.map(normalizeTimelinePoint).filter(Boolean)
        : buildTrail(timestamp, previousState, state, score, checkpoint),
      surfacedFile: String(rawIncident.surfacedFile || rawIncident.filePath || rawIncident.impactedFiles?.[0] || rawIncident.relatedFiles?.[0] || filePath || ""),
      linkedCheckpointId: String(rawIncident.linkedCheckpointId || checkpointId),
      linkedFindings: Array.isArray(rawIncident.linkedFindings)
        ? rawIncident.linkedFindings.map(String)
        : Array.isArray(rawIncident.findings)
          ? rawIncident.findings.map(String)
          : findings.map((finding) => finding.id),
      probableCauses: Array.isArray(rawIncident.probableCauses) ? rawIncident.probableCauses.map(String) : probableRootCauses.map((cause) => cause.id),
      linkedRuntimeEvents: Array.isArray(rawIncident.linkedRuntimeEvents)
        ? rawIncident.linkedRuntimeEvents.map(String)
        : Array.isArray(rawIncident.runtimeEventIds)
          ? rawIncident.runtimeEventIds.map(String)
          : runtimeEvents.map((event) => event.id),
      lastRuntimeEventAt: rawIncident.lastRuntimeEventAt ? String(rawIncident.lastRuntimeEventAt) : runtimeEvents[0]?.timestamp,
      evidenceCount: Number.isFinite(Number(rawIncident.evidenceCount))
        ? Number(rawIncident.evidenceCount)
        : Number.isFinite(Number(rawIncident.runtimeEvidenceCount))
          ? Number(rawIncident.runtimeEvidenceCount)
          : findings.length + runtimeEvents.length
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
      functionName: rawEvent.functionName ? String(rawEvent.functionName) : undefined,
      stackPreview: stackPreview.length > 0 ? stackPreview : buildRuntimeStackPreview(String(rawEvent.message || "Runtime event"), checkpointId, filePath),
      linkedCheckpointId: String(rawEvent.linkedCheckpointId || checkpointId),
      linkedIncidentId: rawEvent.linkedIncidentId ? String(rawEvent.linkedIncidentId) : undefined,
      relatedFindingIds: Array.isArray(rawEvent.relatedFindingIds) ? rawEvent.relatedFindingIds.map(String) : [],
      evidence: Array.isArray(rawEvent.evidence) ? rawEvent.evidence.map(String) : [],
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

    // Keep canonical ISO timestamp so checkpoint IDs and timeline correlation IDs are stable.
    return parsed.toISOString();
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
    persistUiState();
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
    persistUiState();
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
    renderFindings(selected.findings, selected);
    const rootCauses = Array.isArray(selected.probableRootCauses) && selected.probableRootCauses.length > 0
      ? selected.probableRootCauses
      : buildFallbackRootCauses(selected.filePath || appState.sourceLabel, selected.reasons || [], selected.findings || []);
    renderRootCauseCandidates(rootCauses);
    renderRuntimeEvents(selected.runtimeEvents, selected);
    renderIncidentList(selected.incidents, selected);
    renderIncidentDetail(selected, getSelectedIncident(selected));
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
    if (elements.findingsOverview) {
      elements.findingsOverview.textContent = "No findings available yet.";
    }
    if (elements.incidentOverview) {
      elements.incidentOverview.textContent = "No incidents available yet.";
    }
    elements.findingsList.innerHTML = '<div class="empty-state">No findings yet.</div>';
    if (elements.rootCauseList) {
      elements.rootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
    }
    if (elements.overviewRootCauseList && elements.overviewRootCauseList !== elements.rootCauseList) {
      elements.overviewRootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
    }
    if (elements.overviewRootCauseSummary) {
      elements.overviewRootCauseSummary.textContent = "No strong root-cause signal is available for the selected checkpoint.";
    }
    elements.runtimeEventsList.innerHTML = '<div class="empty-state">No runtime events captured yet.</div>';
    elements.incidentList.innerHTML = '<div class="empty-state">No incidents yet.</div>';
    renderEmptyRuntimeDetail();
    renderEmptyIncidentDetail();
    elements.changedLines.innerHTML = '<span class="impact-chip">No changed lines yet</span>';
    elements.beforeCodeWindow.innerHTML = '<div class="code-line"><span class="code-line-number">1</span><span>// waiting for checkpoint data</span></div>';
    elements.afterCodeWindow.innerHTML = '<div class="code-line"><span class="code-line-number">1</span><span>// waiting for checkpoint data</span></div>';
    elements.beforeFocusLine.textContent = "Focus L-";
    elements.afterFocusLine.textContent = "Focus L-";
    elements.codeNavActions.innerHTML = '<div class="empty-state">No navigation targets available yet.</div>';
    elements.codeFlowSummary.textContent = "Flow will appear after analysis payload arrives.";
    if (elements.flowHeroHost) {
      elements.flowHeroHost.classList.add("is-visible");
      elements.flowHeroHost.innerHTML = '<div class="empty-state">No flow inference available yet.</div>';
    }
    if (elements.flowLaneHost) {
      elements.flowLaneHost.classList.remove("is-visible");
      elements.flowLaneHost.innerHTML = "";
    }
    const flowGraph = document.getElementById("flow-graph-svg");
    if (flowGraph) {
      flowGraph.classList.add("is-hidden");
    }
    const flowEdges = document.getElementById("flow-edges");
    const flowNodes = document.getElementById("flow-svg-nodes");
    if (flowEdges) {
      flowEdges.innerHTML = "";
    }
    if (flowNodes) {
      flowNodes.innerHTML = "";
    }
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
  }

  function updateTransportControls() {
    if (!elements.timelinePlayPause || !elements.timelinePlayPauseIcon) {
      return;
    }

    elements.timelinePlayPauseIcon.innerHTML = appState.isReplaying ? "&#10074;&#10074;" : "&#9654;";
    elements.timelinePlayPause.setAttribute("aria-label", appState.isReplaying ? "Pause timeline" : "Play timeline");
    elements.timelinePlayPause.title = appState.isReplaying ? "Pause" : "Play";
  }

  function renderFindings(findings, selectedEntry, options = {}) {
    if (!Array.isArray(findings) || findings.length === 0) {
      appState.findingsVisibleCount = 0;
      appState.findingsSourceKey = undefined;
      if (elements.findingsOverview) {
        elements.findingsOverview.textContent = "No findings detected for this checkpoint.";
      }
      elements.findingsList.innerHTML = '<div class="empty-state">No findings detected.</div>';
      return;
    }

    const batchSize = 14;
    const sourceKey = `${selectedEntry?.checkpointId || "none"}:${findings.length}`;
    if (appState.findingsSourceKey !== sourceKey) {
      appState.findingsSourceKey = sourceKey;
      appState.findingsVisibleCount = Math.min(batchSize, findings.length);
    } else {
      appState.findingsVisibleCount = Math.max(1, Math.min(appState.findingsVisibleCount, findings.length));
    }

    const visibleFindings = findings.slice(0, appState.findingsVisibleCount);

    const bySeverity = findings.reduce((acc, finding) => {
      const severity = String(finding.severity || "WARNING").toUpperCase();
      acc[severity] = (acc[severity] || 0) + 1;
      return acc;
    }, {});
    const topConfidence = Math.max(...findings.map((finding) => Math.round(Number(finding.confidence || 0) * 100)));
    if (elements.findingsOverview) {
      const loadedText = appState.findingsVisibleCount >= findings.length
        ? `all loaded (${findings.length})`
        : `loaded ${appState.findingsVisibleCount} of ${findings.length}`;
      elements.findingsOverview.textContent = `${findings.length} finding${findings.length === 1 ? "" : "s"} • ${bySeverity.ERROR || 0} critical • ${bySeverity.WARNING || 0} warning • top confidence ${topConfidence}% • ${loadedText}`;
    }

    elements.findingsList.innerHTML = visibleFindings
      .map((finding) => {
        const confidencePct = Math.round(Number(finding.confidence || 0) * 100);
        const findingKind = finding.kind ? String(finding.kind) : "General";
        const evidence = finding.evidence ? String(finding.evidence) : "";
        const lineRanges = Array.isArray(finding.lineRanges) && finding.lineRanges.length > 0
          ? finding.lineRanges.map((range) => `L${range[0]}-${range[1]}`).join(", ")
          : "-";
        const symbol = finding.symbol ? `<span class="mini-pill">${escapeHtml(String(finding.symbol))}</span>` : "";
        return `
          <article class="finding-item finding-${String(finding.severity || "WARNING").toLowerCase()}">
            <div class="finding-topline">
              <span class="mini-pill">${escapeHtml(String(finding.severity || "WARNING"))}</span>
              <span class="mini-pill">${escapeHtml(findingKind)}</span>
            </div>
            <p class="finding-message">${escapeHtml(String(finding.message || "Finding"))}</p>
            <div class="finding-confidence-row">
              <span>Confidence</span>
              <div class="finding-confidence-track" role="presentation">
                <span class="finding-confidence-fill" style="width:${Math.max(6, Math.min(100, confidencePct))}%"></span>
              </div>
              <strong>${escapeHtml(String(confidencePct))}%</strong>
            </div>
            <div class="finding-meta">
              <span>${escapeHtml(lineRanges)}</span>
              ${symbol}
            </div>
            ${evidence ? `<p class="finding-evidence">${escapeHtml(evidence)}</p>` : ""}
          </article>
        `;
      })
      .join("");

    const findingsEl = elements.findingsList;
    findingsEl.onscroll = () => {
      const nearBottom = findingsEl.scrollTop + findingsEl.clientHeight >= findingsEl.scrollHeight - 24;
      const canLoadMore = appState.findingsVisibleCount < findings.length;
      if (!nearBottom || !canLoadMore) {
        return;
      }

      const prevScrollTop = findingsEl.scrollTop;
      const prevScrollHeight = findingsEl.scrollHeight;
      appState.findingsVisibleCount = Math.min(findings.length, appState.findingsVisibleCount + batchSize);
      renderFindings(findings, selectedEntry, {
        preserveScroll: true,
        prevScrollTop,
        prevScrollHeight,
      });
    };

    if (options.preserveScroll) {
      const prevTop = Number(options.prevScrollTop || 0);
      const prevHeight = Number(options.prevScrollHeight || 0);
      requestAnimationFrame(() => {
        const growth = elements.findingsList.scrollHeight - prevHeight;
        elements.findingsList.scrollTop = Math.max(0, prevTop + Math.max(0, growth));
      });
    }
  }

  function renderRootCauseCandidates(probableRootCauses) {
    if (elements.rootCard) {
      elements.rootCard.classList.remove("hidden");
    }
    if (!Array.isArray(probableRootCauses) || probableRootCauses.length === 0) {
      if (elements.rootCauseList) {
        elements.rootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
      }
      if (elements.overviewRootCauseList && elements.overviewRootCauseList !== elements.rootCauseList) {
        elements.overviewRootCauseList.innerHTML = '<div class="empty-state">No root-cause candidates yet.</div>';
      }
      if (elements.overviewRootCauseSummary) {
        elements.overviewRootCauseSummary.textContent = "No strong root-cause signal is available for the selected checkpoint.";
      }
      return;
    }

    const renderedRootCauses = probableRootCauses
      .map((candidate, index) => {
        const confidence = Math.round(Number(candidate.confidence || 0) * 100);
        const signals = Array.isArray(candidate.signals) ? candidate.signals : [];
        const evidence = Array.isArray(candidate.linkedEvidence) ? candidate.linkedEvidence : [];
        const hasDetails = signals.length > 0 || evidence.length > 0;
        
        return `
          <article class="root-cause-card${index === 0 ? ' is-primary' : ''}" data-cause-index="${index}">
            <div class="root-cause-header">
              <div class="root-cause-rank">${index + 1}</div>
              <div class="root-cause-main">
                <div class="root-cause-title">${escapeHtml(String(candidate.filePath || ""))}</div>
                ${candidate.relatedSymbol ? `<div class="root-cause-symbol">${escapeHtml(candidate.relatedSymbol)}</div>` : ''}
                <p class="root-cause-reason">${escapeHtml(String(candidate.reason || "Probable root cause"))}</p>
              </div>
              <div class="root-cause-confidence-wrap">
                <svg class="confidence-gauge" viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="22.5" cy="22.5" r="19" class="confidence-bg" />
                  <circle cx="22.5" cy="22.5" r="19" class="confidence-fill" style="stroke-dasharray: ${confidence * 1.194} 119.38;" />
                  <text x="22.5" y="24" class="confidence-text">${confidence}</text>
                </svg>
                ${hasDetails ? `<button class="root-cause-toggle" data-collapsed="true" aria-expanded="false" title="Show details">
                  <span class="toggle-icon">›</span>
                </button>` : ''}
              </div>
            </div>
            ${hasDetails ? `
              <div class="root-cause-details">
                ${signals.length > 0 ? `
                  <div class="details-section">
                    <div class="section-title">Signals</div>
                    <div class="signal-list">
                      ${signals.slice(0, 2).map(s => `<span class="signal-badge">${escapeHtml(s)}</span>`).join('')}
                    </div>
                  </div>
                ` : ''}
                ${evidence.length > 0 ? `
                  <div class="details-section">
                    <div class="section-title">Evidence</div>
                    <div class="evidence-list">
                      ${evidence.slice(0, 2).map(e => `<div class="evidence-item">${escapeHtml(e)}</div>`).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </article>
        `;
      })
      .join("");

    if (elements.rootCauseList) {
      elements.rootCauseList.innerHTML = renderedRootCauses;
    }
    if (elements.overviewRootCauseList && elements.overviewRootCauseList !== elements.rootCauseList) {
      elements.overviewRootCauseList.innerHTML = renderedRootCauses;
    }
    
    // Setup toggle handlers
    setupRootCauseToggles();

    const top = probableRootCauses[0];
    if (elements.overviewRootCauseSummary) {
      elements.overviewRootCauseSummary.textContent = top
        ? `Top inferred cause: ${top.reason || top.filePath || "Unknown"}`
        : "AI inferred causes for the selected checkpoint.";
    }
  }

  function setupRootCauseToggles() {
    const toggles = document.querySelectorAll(".root-cause-toggle");
    toggles.forEach((toggle) => {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        const isCollapsed = toggle.getAttribute("data-collapsed") === "true";
        const card = toggle.closest(".root-cause-card");
        const details = card.querySelector(".root-cause-details");
        
        if (!details) return;
        
        if (isCollapsed) {
          // Expand
          details.style.display = "block";
          // Force reflow to ensure scrollHeight is calculated
          void details.offsetHeight;
          details.style.maxHeight = (details.scrollHeight + 2) + "px";
          toggle.setAttribute("data-collapsed", "false");
          toggle.setAttribute("aria-expanded", "true");
        } else {
          // Collapse
          details.style.maxHeight = "0";
          toggle.setAttribute("data-collapsed", "true");
          toggle.setAttribute("aria-expanded", "false");
          // Hide after transition completes
          setTimeout(() => {
            if (toggle.getAttribute("data-collapsed") === "true") {
              details.style.display = "none";
            }
          }, 300);
        }
      });
    });
  }

  function renderRuntimeEvents(runtimeEvents, selectedEntry, options = {}) {
    if (!Array.isArray(runtimeEvents) || runtimeEvents.length === 0) {
      elements.runtimeEventsList.innerHTML = '<div class="empty-state">No runtime events captured yet. This incident is currently based on static analysis only.</div>';
      appState.runtimeEventsVisibleCount = 0;
      appState.runtimeEventsSourceKey = undefined;
      if (elements.runtimeEventsCount) {
        elements.runtimeEventsCount.textContent = "0 events";
      }
      if (elements.runtimeEventsLoaded) {
        elements.runtimeEventsLoaded.textContent = "Scroll to load more";
      }
      renderEmptyRuntimeDetail();
      return;
    }

    const batchSize = 12;
    const sourceKey = `${selectedEntry?.checkpointId || "none"}:${runtimeEvents.length}`;
    if (appState.runtimeEventsSourceKey !== sourceKey) {
      appState.runtimeEventsSourceKey = sourceKey;
      appState.runtimeEventsVisibleCount = Math.min(batchSize, runtimeEvents.length);
    } else {
      appState.runtimeEventsVisibleCount = Math.max(1, Math.min(appState.runtimeEventsVisibleCount, runtimeEvents.length));
    }

    if (appState.selectedRuntimeEventId) {
      const selectedIndex = runtimeEvents.findIndex((event) => event.id === appState.selectedRuntimeEventId);
      if (selectedIndex >= 0 && selectedIndex + 1 > appState.runtimeEventsVisibleCount) {
        appState.runtimeEventsVisibleCount = Math.min(runtimeEvents.length, selectedIndex + 1);
      }
    }

    const visibleRuntimeEvents = runtimeEvents.slice(0, appState.runtimeEventsVisibleCount);

    const selectedInView = visibleRuntimeEvents.some((event) => event.id === appState.selectedRuntimeEventId);
    if (!selectedInView && visibleRuntimeEvents.length > 0) {
      appState.selectedRuntimeEventId = visibleRuntimeEvents[0].id;
    }

    if (elements.runtimeEventsCount) {
      elements.runtimeEventsCount.textContent = `${runtimeEvents.length} events`;
    }
    if (elements.runtimeEventsLoaded) {
      elements.runtimeEventsLoaded.textContent = appState.runtimeEventsVisibleCount >= runtimeEvents.length
        ? `All loaded (${runtimeEvents.length})`
        : `Loaded ${appState.runtimeEventsVisibleCount} of ${runtimeEvents.length}`;
    }

    elements.runtimeEventsList.innerHTML = visibleRuntimeEvents
      .map((event) => {
        const selected = appState.selectedRuntimeEventId ? appState.selectedRuntimeEventId === event.id : visibleRuntimeEvents[0]?.id === event.id;
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

    const runtimeListEl = elements.runtimeEventsList;
    runtimeListEl.onscroll = () => {
      const nearBottom = runtimeListEl.scrollTop + runtimeListEl.clientHeight >= runtimeListEl.scrollHeight - 24;
      const canLoadMore = appState.runtimeEventsVisibleCount < runtimeEvents.length;
      if (!nearBottom || !canLoadMore) {
        return;
      }

      const prevScrollTop = runtimeListEl.scrollTop;
      const prevScrollHeight = runtimeListEl.scrollHeight;
      appState.runtimeEventsVisibleCount = Math.min(runtimeEvents.length, appState.runtimeEventsVisibleCount + batchSize);
      renderRuntimeEvents(runtimeEvents, selectedEntry, {
        preserveScroll: true,
        prevScrollTop,
        prevScrollHeight
      });
    };

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

    if (options.preserveScroll) {
      const prevTop = Number(options.prevScrollTop || 0);
      const prevHeight = Number(options.prevScrollHeight || 0);
      requestAnimationFrame(() => {
        const growth = elements.runtimeEventsList.scrollHeight - prevHeight;
        elements.runtimeEventsList.scrollTop = Math.max(0, prevTop + Math.max(0, growth));
      });
    }
  }

  function renderRuntimeEventDetail(event) {
    if (!elements.runtimeDetailType || !elements.runtimeDetailStatus || !elements.runtimeDetailMessage || !elements.runtimeDetailTime || !elements.runtimeDetailFile || !elements.runtimeDetailLine || !elements.runtimeDetailCheckpoint) {
      return;
    }

    if (!event) {
      renderEmptyRuntimeDetail();
      return;
    }

    const statusClass = runtimeConfirmationClass(event.confirmationState, event.runtimeConfirmed);
    elements.runtimeDetailType.textContent = formatRuntimeEventTypeLabel(event.type || event.eventType);
    elements.runtimeDetailStatus.textContent = runtimeConfirmationLabel(event.confirmationState, event.runtimeConfirmed);
    elements.runtimeDetailStatus.className = `mini-pill ${statusClass}`;
    elements.runtimeDetailMessage.textContent = event.message;
    elements.runtimeDetailTime.textContent = event.timestamp || "-";
    elements.runtimeDetailFile.textContent = event.filePath || "-";
    elements.runtimeDetailLine.textContent = event.line ? `L${event.line}` : "-";
    elements.runtimeDetailCheckpoint.textContent = event.linkedCheckpointId || "-";
  }

  function renderEmptyRuntimeDetail() {
    if (!elements.runtimeDetailType || !elements.runtimeDetailStatus || !elements.runtimeDetailMessage || !elements.runtimeDetailTime || !elements.runtimeDetailFile || !elements.runtimeDetailLine || !elements.runtimeDetailCheckpoint) {
      return;
    }

    elements.runtimeDetailType.textContent = "No event selected";
    elements.runtimeDetailStatus.textContent = "Waiting";
    elements.runtimeDetailStatus.className = "mini-pill";
    elements.runtimeDetailMessage.textContent = "Select a runtime event to inspect details.";
    elements.runtimeDetailTime.textContent = "-";
    elements.runtimeDetailFile.textContent = "-";
    elements.runtimeDetailLine.textContent = "-";
    elements.runtimeDetailCheckpoint.textContent = "-";
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
    const runtimeStatus = runtimeConfirmationLabel(selectedIncident.runtimeConfirmationState, selectedIncident.runtimeConfirmed);
    elements.incidentDetailSummary.textContent = selectedIncident.summary;
    elements.incidentDetailStatus.textContent = normalizeIncidentStatusLabel(selectedIncident.status);
    elements.incidentDetailStatus.className = `mini-pill ${incidentStatusClass(selectedIncident.status)}`;
    elements.incidentDetailRuntimeConfirmation.textContent = runtimeStatus;
    elements.incidentDetailRuntimeConfirmation.className = `mini-pill ${runtimeConfirmationClass(selectedIncident.runtimeConfirmationState, selectedIncident.runtimeConfirmed)}`;
    elements.incidentDetailFile.textContent = selectedIncident.surfacedFile || "-";
    elements.incidentDetailRuntimeCount.textContent = String(selectedIncident.evidenceCount || 0);
    elements.incidentDetailReason.textContent = selectedIncident.statusReason || selectedIncident.summary;
    persistUiState();
  }

  function renderEmptyIncidentDetail() {
    elements.incidentDetailSummary.textContent = "No incident selected";
    elements.incidentDetailStatus.textContent = "Waiting";
    elements.incidentDetailStatus.className = "mini-pill";
    elements.incidentDetailRuntimeConfirmation.textContent = "Suspected";
    elements.incidentDetailRuntimeConfirmation.className = "mini-pill";
    elements.incidentDetailFile.textContent = "-";
    elements.incidentDetailRuntimeCount.textContent = "0";
    elements.incidentDetailReason.textContent = "Select an incident to inspect linked findings, runtime evidence, and file context.";
  }

  function isTypingTarget(target) {
    if (!target) {
      return false;
    }

    const tag = String(target.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target.isContentEditable);
  }

  function getFilteredSortedIncidents(incidents) {
    if (!Array.isArray(incidents) || incidents.length === 0) {
      return [];
    }

    const query = String(appState.incidentSearchQuery || "").trim().toLowerCase();
    const statusFilter = String(appState.incidentStatusFilter || "all").toLowerCase();
    const runtimeOnly = Boolean(appState.incidentRuntimeOnly);

    return incidents
      .filter((incident) => {
        const statusLabel = normalizeIncidentStatusLabel(incident.status).toLowerCase();
        if (statusFilter !== "all" && statusLabel !== statusFilter) {
          return false;
        }

        if (runtimeOnly && runtimeConfirmationLabel(incident.runtimeConfirmationState, incident.runtimeConfirmed) !== "Runtime Confirmed") {
          return false;
        }

        if (!query) {
          return true;
        }

        const summary = String(incident.summary || "").toLowerCase();
        const file = String(incident.surfacedFile || "").toLowerCase();
        return summary.includes(query) || file.includes(query);
      })
      .sort(compareIncidentsForQueue);
  }

  function refreshIncidentWorkspace() {
    const selected = getSelectedEntry();
    if (!selected) {
      return;
    }

    renderIncidentList(selected.incidents, selected);
  }

  function selectIncidentByDelta(delta) {
    const selectedEntry = getSelectedEntry();
    if (!selectedEntry || !Array.isArray(selectedEntry.incidents) || selectedEntry.incidents.length === 0) {
      return;
    }

    const filtered = getFilteredSortedIncidents(selectedEntry.incidents);
    if (!filtered.length) {
      return;
    }

    const currentIndex = filtered.findIndex((incident) => incident.id === appState.selectedIncidentId);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(filtered.length - 1, baseIndex + delta));
    const nextIncident = filtered[nextIndex];
    if (!nextIncident) {
      return;
    }

    appState.selectedIncidentId = nextIncident.id;
    renderIncidentList(selectedEntry.incidents, selectedEntry);
    renderIncidentDetail(selectedEntry, nextIncident);
    persistUiState();
  }

  function persistUiState() {
    if (!vscode || typeof vscode.setState !== "function") {
      return;
    }

    vscode.setState({
      activePane: appState.activePane,
      selectedIncidentId: appState.selectedIncidentId,
      selectedCheckpointIndex: appState.selectedIndex,
      incidentSearchQuery: appState.incidentSearchQuery,
      incidentStatusFilter: appState.incidentStatusFilter,
      incidentRuntimeOnly: appState.incidentRuntimeOnly,
      snippetViewMode: appState.snippetViewMode,
      activeSnippetTab: appState.activeSnippetTab,
    });
  }

  function restorePersistedUiState() {
    if (!vscode || typeof vscode.getState !== "function") {
      return;
    }

    const persisted = vscode.getState();
    if (!persisted || typeof persisted !== "object") {
      return;
    }

    if (persisted.activePane) {
      appState.activePane = String(persisted.activePane);
    }
    if (persisted.selectedIncidentId) {
      appState.selectedIncidentId = String(persisted.selectedIncidentId);
    }
    if (Number.isFinite(Number(persisted.selectedCheckpointIndex))) {
      appState.selectedIndex = Math.max(0, Number(persisted.selectedCheckpointIndex));
    }
    if (typeof persisted.incidentSearchQuery === "string") {
      appState.incidentSearchQuery = persisted.incidentSearchQuery;
    }
    if (typeof persisted.incidentStatusFilter === "string") {
      appState.incidentStatusFilter = persisted.incidentStatusFilter;
    }
    if (typeof persisted.incidentRuntimeOnly === "boolean") {
      appState.incidentRuntimeOnly = persisted.incidentRuntimeOnly;
    }
    if (typeof persisted.snippetViewMode === "string") {
      appState.snippetViewMode = persisted.snippetViewMode;
    }
    if (typeof persisted.activeSnippetTab === "string") {
      appState.activeSnippetTab = persisted.activeSnippetTab;
    }

    if (elements.incidentSearchInput) {
      elements.incidentSearchInput.value = appState.incidentSearchQuery;
    }
    if (elements.incidentStatusFilter) {
      elements.incidentStatusFilter.value = appState.incidentStatusFilter;
    }
    if (elements.incidentRuntimeOnly) {
      elements.incidentRuntimeOnly.checked = Boolean(appState.incidentRuntimeOnly);
    }
  }

  function renderIncidentList(incidents, selectedEntry, options = {}) {
    if (!Array.isArray(incidents) || incidents.length === 0) {
      appState.incidentsVisibleCount = 0;
      appState.incidentsSourceKey = undefined;
      if (elements.incidentOverview) {
        elements.incidentOverview.textContent = "No incidents available yet.";
      }
      elements.incidentList.innerHTML = '<div class="empty-state">No incidents yet.</div>';
      renderEmptyIncidentDetail();
      return;
    }

    const batchSize = 10;
    const filteredIncidents = getFilteredSortedIncidents(incidents);
    const sourceKey = `${selectedEntry?.checkpointId || "none"}:${incidents.length}:${filteredIncidents.length}:${appState.incidentSearchQuery}:${appState.incidentStatusFilter}:${appState.incidentRuntimeOnly ? "runtime" : "all"}`;
    if (appState.incidentsSourceKey !== sourceKey) {
      appState.incidentsSourceKey = sourceKey;
      appState.incidentsVisibleCount = Math.min(batchSize, filteredIncidents.length);
    } else {
      appState.incidentsVisibleCount = Math.max(1, Math.min(appState.incidentsVisibleCount, filteredIncidents.length || 1));
    }

    if (!filteredIncidents.length) {
      if (elements.incidentOverview) {
        elements.incidentOverview.textContent = `0 matches • filtered from ${incidents.length} incidents`;
      }
      elements.incidentList.innerHTML = '<div class="empty-state">No incidents match the current filter.</div>';
      renderEmptyIncidentDetail();
      return;
    }

    if (!appState.selectedIncidentId || !filteredIncidents.some((incident) => incident.id === appState.selectedIncidentId)) {
      appState.selectedIncidentId = filteredIncidents[0].id;
    }

    if (appState.selectedIncidentId) {
      const selectedIndex = filteredIncidents.findIndex((incident) => incident.id === appState.selectedIncidentId);
      if (selectedIndex >= 0 && selectedIndex + 1 > appState.incidentsVisibleCount) {
        appState.incidentsVisibleCount = Math.min(filteredIncidents.length, selectedIndex + 1);
      }
    }

    const visibleIncidents = filteredIncidents.slice(0, appState.incidentsVisibleCount);

    if (elements.incidentOverview) {
      const loadedText = appState.incidentsVisibleCount >= filteredIncidents.length
        ? `all loaded (${filteredIncidents.length})`
        : `loaded ${appState.incidentsVisibleCount} of ${filteredIncidents.length}`;
      elements.incidentOverview.textContent = `${filteredIncidents.length} match${filteredIncidents.length === 1 ? "" : "es"} • ${loadedText} • total ${incidents.length}`;
    }
    const grouped = {
      Open: [],
      Mitigated: [],
      Resolved: []
    };
    visibleIncidents.forEach((incident) => {
      const statusLabel = normalizeIncidentStatusLabel(incident.status);
      if (statusLabel === "Mitigated") {
        grouped.Mitigated.push(incident);
        return;
      }
      if (statusLabel === "Resolved") {
        grouped.Resolved.push(incident);
        return;
      }
      grouped.Open.push(incident);
    });

    elements.incidentList.innerHTML = Object.entries(grouped)
      .map(([status, items]) => {
        if (!items.length) {
          return "";
        }

        const cards = items.map((incident) => {
          const trail = Array.isArray(incident.timelineTrail)
            ? incident.timelineTrail.map((point) => `<span class="trail-chip ${stateClass(point.state)}">${escapeHtml(String(point.label || point.state))}</span>`).join("")
            : "";
          const isSelected = appState.selectedIncidentId === incident.id;
          return `
            <button class="incident-item ${isSelected ? "selected" : ""}" type="button" data-incident-id="${escapeHtml(incident.id)}">
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
        }).join("");

        return `
          <section class="incident-group">
            <div class="incident-group-header">${escapeHtml(status)} <span>${items.length}</span></div>
            <div class="incident-group-list">${cards}</div>
          </section>
        `;
      })
      .join("");

    const incidentListEl = elements.incidentList;
    incidentListEl.onscroll = () => {
      const nearBottom = incidentListEl.scrollTop + incidentListEl.clientHeight >= incidentListEl.scrollHeight - 24;
      const canLoadMore = appState.incidentsVisibleCount < filteredIncidents.length;
      if (!nearBottom || !canLoadMore) {
        return;
      }

      const prevScrollTop = incidentListEl.scrollTop;
      const prevScrollHeight = incidentListEl.scrollHeight;
      appState.incidentsVisibleCount = Math.min(filteredIncidents.length, appState.incidentsVisibleCount + batchSize);
      renderIncidentList(incidents, selectedEntry, {
        preserveScroll: true,
        prevScrollTop,
        prevScrollHeight,
      });
    };

    elements.incidentList.querySelectorAll("[data-incident-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const incidentId = button.getAttribute("data-incident-id");
        const incident = incidents.find((item) => item.id === incidentId);
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
        persistUiState();
      });
    });

    if (options.preserveScroll) {
      const prevTop = Number(options.prevScrollTop || 0);
      const prevHeight = Number(options.prevScrollHeight || 0);
      requestAnimationFrame(() => {
        const growth = elements.incidentList.scrollHeight - prevHeight;
        elements.incidentList.scrollTop = Math.max(0, prevTop + Math.max(0, growth));
      });
    }

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

  function renderLinkedChipSection(container, values, sectionKey, incidentId, options = {}) {
    if (!container) {
      return;
    }

    if (!Array.isArray(values) || values.length === 0) {
      appState.incidentLinkedVisibleCount[sectionKey] = 0;
      appState.incidentLinkedSourceKeys[sectionKey] = undefined;
      container.innerHTML = '<div class="empty-state">None</div>';
      return;
    }

    const batchSize = 18;
    const sourceKey = `${incidentId || "none"}:${sectionKey}:${values.length}`;
    if (appState.incidentLinkedSourceKeys[sectionKey] !== sourceKey) {
      appState.incidentLinkedSourceKeys[sectionKey] = sourceKey;
      appState.incidentLinkedVisibleCount[sectionKey] = Math.min(batchSize, values.length);
    } else {
      appState.incidentLinkedVisibleCount[sectionKey] = Math.max(
        1,
        Math.min(appState.incidentLinkedVisibleCount[sectionKey] || 1, values.length)
      );
    }

    const visibleCount = appState.incidentLinkedVisibleCount[sectionKey];
    const visibleValues = values.slice(0, visibleCount);
    const statusText = visibleCount >= values.length
      ? `All loaded (${values.length})`
      : `Loaded ${visibleCount} of ${values.length}`;

    container.innerHTML = `${visibleValues.map((value) => `<span class="mini-pill">${escapeHtml(String(value))}</span>`).join("")}<div class="linked-chip-status">${escapeHtml(statusText)}</div>`;
    container.onscroll = () => {
      const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
      const canLoadMore = appState.incidentLinkedVisibleCount[sectionKey] < values.length;
      if (!nearBottom || !canLoadMore) {
        return;
      }

      const prevScrollTop = container.scrollTop;
      const prevScrollHeight = container.scrollHeight;
      appState.incidentLinkedVisibleCount[sectionKey] = Math.min(values.length, appState.incidentLinkedVisibleCount[sectionKey] + batchSize);
      renderLinkedChipSection(container, values, sectionKey, incidentId, {
        preserveScroll: true,
        prevScrollTop,
        prevScrollHeight,
      });
    };

    if (options.preserveScroll) {
      const prevTop = Number(options.prevScrollTop || 0);
      const prevHeight = Number(options.prevScrollHeight || 0);
      requestAnimationFrame(() => {
        const growth = container.scrollHeight - prevHeight;
        container.scrollTop = Math.max(0, prevTop + Math.max(0, growth));
      });
    }
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

  function incidentStatusRank(status) {
    const label = normalizeIncidentStatusLabel(status);
    if (label === "Open") {
      return 0;
    }
    if (label === "Mitigated") {
      return 1;
    }
    return 2;
  }

  function incidentPriorityScore(incident) {
    const runtimeConfirmed = runtimeConfirmationLabel(incident.runtimeConfirmationState, incident.runtimeConfirmed) === "Runtime Confirmed";
    const evidenceCount = Number(incident.evidenceCount || 0);
    const runtimeSignals = Array.isArray(incident.linkedRuntimeEvents) ? incident.linkedRuntimeEvents.length : 0;
    const findings = Array.isArray(incident.linkedFindings) ? incident.linkedFindings.length : 0;
    const freshAt = incident.lastRuntimeEventAt ? Date.parse(String(incident.lastRuntimeEventAt)) : 0;
    const recencyBoost = Number.isFinite(freshAt) ? Math.max(0, Math.floor((freshAt % 1000000) / 1000)) : 0;

    return (runtimeConfirmed ? 100000 : 0)
      + (evidenceCount * 100)
      + (runtimeSignals * 25)
      + (findings * 12)
      + recencyBoost;
  }

  function compareIncidentsForQueue(a, b) {
    const rankDelta = incidentStatusRank(a.status) - incidentStatusRank(b.status);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const scoreDelta = incidentPriorityScore(b) - incidentPriorityScore(a);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return String(a.summary || "").localeCompare(String(b.summary || ""));
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
    const entryPreviewStart = Number(entry?.codePreview?.startLine || 1);
    const entryPreviewFocus = Number(entry?.codePreview?.focusLine || 1);
    const hasEntryBefore = Array.isArray(entry?.codePreview?.before) && entry.codePreview.before.length > 0;
    const hasEntryAfter = Array.isArray(entry?.codePreview?.after) && entry.codePreview.after.length > 0;

    // Prefer the selected checkpoint preview. A live codePane payload may only
    // represent the latest analysis, which can make older checkpoints look identical.
    const sourceBeforeSnippet = hasEntryBefore
      ? normalizeSnippet(undefined, entry.codePreview.before, entryPreviewStart, entryPreviewFocus)
      : codePane.beforeSnippet;
    const sourceAfterSnippet = hasEntryAfter
      ? normalizeSnippet(undefined, entry.codePreview.after, entryPreviewStart, entryPreviewFocus)
      : codePane.afterSnippet;

    const beforeSnippet = selectSnippet(sourceBeforeSnippet, entry.codePreview.before, focusedLine, entry.codePreview.startLine || 1);
    const afterSnippet = selectSnippet(sourceAfterSnippet, entry.codePreview.after, focusedLine, entry.codePreview.startLine || 1);

    elements.beforeCodeWindow.innerHTML = renderSnippetLines(beforeSnippet);
    elements.afterCodeWindow.innerHTML = renderSnippetLines(afterSnippet);
    elements.beforeFocusLine.textContent = `Focus L${focusedLine}`;
    elements.afterFocusLine.textContent = `Focus L${focusedLine}`;
    updateSnippetPresentation();

    renderCodeNavigation(codePane, entry, focusedLine);
    renderCodeFlow(codePane.flow, codePane.summary || codePane.title || "");
  }

  function updateSnippetPresentation() {
    const isSplit = appState.snippetViewMode === "split";
    const showBefore = isSplit || appState.activeSnippetTab === "before";
    const showAfter = isSplit || appState.activeSnippetTab === "after";

    if (elements.beforeSnippetPanel) {
      elements.beforeSnippetPanel.classList.toggle("is-hidden", !showBefore);
    }

    if (elements.afterSnippetPanel) {
      elements.afterSnippetPanel.classList.toggle("is-hidden", !showAfter);
    }

    if (elements.snippetLayout) {
      elements.snippetLayout.classList.toggle("split-mode", isSplit);
    }

    if (elements.snippetTabBefore) {
      const active = !isSplit && appState.activeSnippetTab === "before";
      elements.snippetTabBefore.classList.toggle("active", active);
      elements.snippetTabBefore.setAttribute("aria-selected", active ? "true" : "false");
    }

    if (elements.snippetTabAfter) {
      const active = !isSplit && appState.activeSnippetTab === "after";
      elements.snippetTabAfter.classList.toggle("active", active);
      elements.snippetTabAfter.setAttribute("aria-selected", active ? "true" : "false");
    }

    if (elements.snippetModeTab) {
      const active = !isSplit;
      elements.snippetModeTab.classList.toggle("active", active);
      elements.snippetModeTab.setAttribute("aria-pressed", active ? "true" : "false");
    }

    if (elements.snippetModeSplit) {
      const active = isSplit;
      elements.snippetModeSplit.classList.toggle("active", active);
      elements.snippetModeSplit.setAttribute("aria-pressed", active ? "true" : "false");
    }
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
        return `<div class="${lineClass}"><span class="code-line-number">${lineNumber}</span><span class="code-line-content">${escapeHtml(String(line))}</span></div>`;
      })
      .join("");
  }

  function renderCodeNavigation(codePane, entry, focusedLine) {
    const jumpActions = [];
    const fileActions = [];
    const seenLocations = new Set();
    const seenFiles = new Set();

    codePane.runtimeLocations.slice(0, 3).forEach((runtimeEvent) => {
      const filePath = runtimeEvent.filePath || codePane.currentFile || entry.filePath || "";
      const key = `${filePath}|${runtimeEvent.line || ""}`;
      if (seenLocations.has(key)) {
        return;
      }
      seenLocations.add(key);

      const lineLabel = runtimeEvent.line ? `L${runtimeEvent.line}` : "File";
      jumpActions.push({
        navType: "runtime",
        id: runtimeEvent.id,
        filePath,
        line: runtimeEvent.line,
        column: runtimeEvent.column,
        tone: "runtime",
        kind: "Runtime",
        target: lineLabel,
        meta: ""
      });
    });

    codePane.findingLocations.slice(0, 3).forEach((finding) => {
      const filePath = finding.filePath || codePane.currentFile || entry.filePath || "";
      const key = `${filePath}|${finding.line || ""}`;
      if (seenLocations.has(key)) {
        return;
      }
      seenLocations.add(key);

      const lineLabel = finding.line ? `L${finding.line}` : "File";
      jumpActions.push({
        navType: "finding",
        id: finding.id,
        filePath,
        line: finding.line,
        tone: "finding",
        kind: "Finding",
        target: lineLabel,
        meta: ""
      });
    });

    const fileCandidates = [
      ...codePane.rootCauseFiles.slice(0, 2).map((filePath) => ({ navType: "root", filePath, tone: "root", kind: "Root" })),
      ...codePane.impactedFiles.slice(0, 2).map((filePath) => ({ navType: "impacted", filePath, tone: "impacted", kind: "Impacted" })),
      ...codePane.relatedFiles.slice(0, 2).map((filePath) => ({ navType: "related", filePath, tone: "related", kind: "Related" }))
    ];

    fileCandidates.forEach((action) => {
      const filePath = action.filePath || "";
      if (!filePath || seenFiles.has(filePath)) {
        return;
      }
      seenFiles.add(filePath);
      fileActions.push({
        ...action,
        target: trimPathLabel(filePath),
        meta: ""
      });
    });

    const allActions = [...jumpActions, ...fileActions];
    if (allActions.length === 0) {
      elements.codeNavActions.innerHTML = '<div class="empty-state">No navigation targets available for this checkpoint.</div>';
    } else {
      const renderAction = (action) => `
        <button class="code-nav-btn" type="button" data-nav-type="${escapeHtml(action.navType)}" data-id="${escapeHtml(action.id || "")}" data-file="${escapeHtml(action.filePath || "")}" data-line="${escapeHtml(String(action.line || ""))}" data-column="${escapeHtml(String(action.column || ""))}" data-tone="${escapeHtml(action.tone || "neutral")}">
          <span class="code-nav-pill code-nav-pill-${escapeHtml(action.tone || "neutral")}">${escapeHtml(action.kind || "Open")}</span>
          <span class="code-nav-target">${escapeHtml(action.target || "Target")}</span>
          ${action.meta ? `<span class="code-nav-meta">${escapeHtml(action.meta)}</span>` : ""}
        </button>
      `;

      const jumpGroup = jumpActions.length > 0
        ? `
          <section class="code-nav-group">
            <div class="code-nav-chip-grid">
              ${jumpActions.map(renderAction).join("")}
            </div>
          </section>
        `
        : "";

      const fileGroup = fileActions.length > 0
        ? `
          <section class="code-nav-group">
            <div class="code-nav-chip-grid">
              ${fileActions.map(renderAction).join("")}
            </div>
          </section>
        `
        : "";

      elements.codeNavActions.innerHTML = `${jumpGroup}${fileGroup}`;
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

  function renderCodeFlow(flow, summaryText = "") {
    if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
      elements.codeFlowSummary.textContent = "No inferred flow available for this checkpoint.";
      elements.codeFlowNodes.innerHTML = '<div class="empty-state">No dependency path inferred.</div>';
      return;
    }

    elements.codeFlowSummary.textContent = flow.summary || "Inferred from imports, impacted files, and naming heuristics.";

    const edges = Array.isArray(flow.edges) ? flow.edges : [];
    const isSoloNode = flow.nodes.length === 1 && edges.length === 0;
    
    // Find the "current" node (usually first or marked as current)
    const currentNode = flow.nodes.find(n => n.isCurrent) || flow.nodes[0];
    const currentIndex = flow.nodes.indexOf(currentNode);
    
    // Calculate positions using radial layout
    const positions = calculateRadialPositions(flow.nodes, currentIndex);
    
    // Render SVG flow graph
    renderFlowGraph(flow.nodes, edges, positions, currentIndex, summaryText, isSoloNode);
  }

  function calculateRadialPositions(nodes, currentIndex) {
    const positions = new Map();
    const centerX = 400;
    const centerY = 200;
    const currentRadius = 60;
    const otherRadius = 140;
    
    // Current node at center
    positions.set(nodes[currentIndex].id, { x: centerX, y: centerY, isCurrent: true });
    
    // Other nodes arranged in circle
    const otherNodes = nodes.filter((_, i) => i !== currentIndex);
    const angleStep = (2 * Math.PI) / Math.max(1, otherNodes.length);
    
    otherNodes.forEach((node, i) => {
      const angle = angleStep * i;
      const x = centerX + Math.cos(angle) * otherRadius;
      const y = centerY + Math.sin(angle) * otherRadius;
      positions.set(node.id, { x, y, isCurrent: false });
    });
    
    return positions;
  }

  function renderFlowGraph(nodes, edges, positions, currentIndex, summaryText, isSoloNode) {
    const svg = document.getElementById("flow-graph-svg");
    const edgesGroup = document.getElementById("flow-edges");
    const nodesGroup = document.getElementById("flow-svg-nodes");
    const heroHost = elements.flowHeroHost;
    const laneHost = elements.flowLaneHost;
    
    if (heroHost) {
      heroHost.innerHTML = "";
      heroHost.classList.toggle("is-visible", isSoloNode);
    }

    if (laneHost) {
      laneHost.innerHTML = "";
      laneHost.classList.toggle("is-visible", !isSoloNode);
    }

    if (svg) {
      svg.classList.add("is-hidden");
    }

    if (isSoloNode) {
      const currentNode = nodes[currentIndex];
      if (heroHost) {
        heroHost.innerHTML = `
          <article class="flow-hero-card-html">
            <div class="flow-hero-badge">Current</div>
            <div class="flow-hero-file">${escapeHtml(trimPathLabel(currentNode.label))}</div>
            <div class="flow-hero-role-html">${escapeHtml(currentNode.role)}</div>
            <div class="flow-hero-kind-html">${escapeHtml(String(currentNode.kind || "current"))}</div>
            <div class="flow-hero-note-html">${escapeHtml(summaryText || "Single file inferred. No dependency edges found.")}</div>
          </article>
        `;
      }
      return;
    }

    if (laneHost) {
      const edgesByFrom = new Map();
      edges.forEach((edge) => {
        if (!edgesByFrom.has(edge.from)) {
          edgesByFrom.set(edge.from, []);
        }
        edgesByFrom.get(edge.from).push(edge);
      });

      laneHost.innerHTML = `
        <div class="flow-lane-meta">
          <span class="flow-lane-count">${nodes.length} modules</span>
          <span class="flow-lane-note">${escapeHtml(summaryText || "Inferred dependency path")}</span>
        </div>
        <div class="flow-lane-list">
          ${nodes.map((node, index) => {
            const connected = edgesByFrom.get(node.id) || [];
            const edgePills = connected.slice(0, 2).map((edge) => {
              const target = nodes.find((candidate) => candidate.id === edge.to);
              const targetLabel = target ? target.role : "module";
              return `<span class="flow-lane-chip">${escapeHtml(edge.label || "→")} ${escapeHtml(targetLabel)}</span>`;
            }).join("");
            const extraCount = connected.length > 2 ? `<span class="flow-lane-chip flow-lane-chip-more">+${connected.length - 2} more</span>` : "";
            return `
              <article class="flow-lane-card${node.kind === "current" ? " is-current" : ""}" data-node-id="${escapeHtml(node.id)}">
                <div class="flow-lane-index">${index + 1}</div>
                <div class="flow-lane-content">
                  <div class="flow-lane-topline">
                    <strong>${escapeHtml(node.role)}</strong>
                    <span class="mini-pill">${escapeHtml(node.kind || "related")}</span>
                  </div>
                  <div class="flow-lane-path">${escapeHtml(trimPathLabel(node.label))}</div>
                  <div class="flow-lane-chips">${edgePills}${extraCount}</div>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      `;
    }

    edgesGroup.innerHTML = "";
    nodesGroup.innerHTML = "";
    
    // Render edges first (so they appear behind nodes)
    edges.forEach((edge, idx) => {
      const fromPos = positions.get(edge.from);
      const toPos = positions.get(edge.to);
      if (!fromPos || !toPos) return;
      
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const d = `M ${fromPos.x} ${fromPos.y} L ${toPos.x} ${toPos.y}`;
      path.setAttribute("d", d);
      path.setAttribute("class", `flow-edge flow-edge-${idx}`);
      path.setAttribute("data-from", edge.from);
      path.setAttribute("data-to", edge.to);
      if (edge.label) {
        path.setAttribute("data-label", edge.label);
      }
      edgesGroup.appendChild(path);
      
      // Add hover label
      if (edge.label) {
        const midX = (fromPos.x + toPos.x) / 2;
        const midY = (fromPos.y + toPos.y) / 2;
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", midX);
        text.setAttribute("y", midY - 5);
        text.setAttribute("class", "flow-edge-label");
        text.setAttribute("data-edge-idx", idx);
        text.textContent = edge.label;
        edgesGroup.appendChild(text);
      }
    });
    
    // Render nodes
    nodes.forEach((node, idx) => {
      const pos = positions.get(node.id);
      if (!pos) return;
      
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", `flow-node-group flow-node-${idx}`);
      g.setAttribute("data-node-id", node.id);
      g.setAttribute("data-animation-delay", idx * 0.08);
      
      // Circle background (for glow)
      const glowCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      glowCircle.setAttribute("cx", pos.x);
      glowCircle.setAttribute("cy", pos.y);
      glowCircle.setAttribute("r", pos.isCurrent ? 35 : 28);
      glowCircle.setAttribute("class", pos.isCurrent ? "flow-node-circle flow-current" : "flow-node-circle");
      glowCircle.setAttribute("filter", pos.isCurrent ? "url(#active-glow-filter)" : "url(#glow-filter)");
      g.appendChild(glowCircle);
      
      // Node role text
      const roleText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      roleText.setAttribute("x", pos.x);
      roleText.setAttribute("y", pos.y);
      roleText.setAttribute("class", "flow-node-role");
      roleText.textContent = node.role.substring(0, 12);
      g.appendChild(roleText);
      
      // Node kind badge (small text below)
      const kindText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      kindText.setAttribute("x", pos.x);
      kindText.setAttribute("y", pos.y + 12);
      kindText.setAttribute("class", "flow-node-kind");
      kindText.textContent = node.kind || "related";
      g.appendChild(kindText);
      
      // Tooltip (shown on hover)
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = `${node.role} (${trimPathLabel(node.label)})`;
      g.appendChild(title);
      
      nodesGroup.appendChild(g);
    });
    
    // Setup hover interactions
    setupFlowHoverInteractions(nodes, positions);
  }

  function setupFlowHoverInteractions(nodes, positions) {
    const nodeGroups = document.querySelectorAll(".flow-node-group");
    const edges = document.querySelectorAll(".flow-edge");
    
    nodeGroups.forEach((group) => {
      const nodeId = group.getAttribute("data-node-id");
      
      group.addEventListener("mouseenter", () => {
        // Highlight connected edges
        edges.forEach((edge) => {
          if (edge.getAttribute("data-from") === nodeId || edge.getAttribute("data-to") === nodeId) {
            edge.classList.add("active");
            const label = edge.nextElementSibling;
            if (label && label.classList.contains("flow-edge-label")) {
              label.classList.add("visible");
            }
          } else {
            edge.classList.add("inactive");
          }
        });
      });
      
      group.addEventListener("mouseleave", () => {
        edges.forEach((edge) => {
          edge.classList.remove("active", "inactive");
        });
        document.querySelectorAll(".flow-edge-label").forEach((label) => {
          label.classList.remove("visible");
        });
      });
    });
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

    const baseline = height - padding;
    const firstX = coords[0][0].toFixed(2);
    const lastX = coords[coords.length - 1][0].toFixed(2);
    const areaPath = `${path} L${lastX} ${baseline.toFixed(2)} L${firstX} ${baseline.toFixed(2)} Z`;

    const selectedPoint = Math.max(0, Math.min(coords.length - 1, appState.selectedIndex));
    const [dotX, dotY] = coords[selectedPoint];

    if (elements.sparklineArea) {
      elements.sparklineArea.setAttribute("d", areaPath);
    }

    if (elements.sparklinePathBase) {
      elements.sparklinePathBase.classList.remove("chart-refresh");
    }
    if (elements.sparklinePathUp) {
      elements.sparklinePathUp.classList.remove("chart-refresh");
    }
    if (elements.sparklinePathDown) {
      elements.sparklinePathDown.classList.remove("chart-refresh");
    }
    if (elements.sparklinePathFlat) {
      elements.sparklinePathFlat.classList.remove("chart-refresh");
    }
    if (elements.sparklineArea) {
      elements.sparklineArea.classList.remove("chart-refresh");
    }
    if (elements.sparklinePathBase) {
      void elements.sparklinePathBase.getBoundingClientRect();
      elements.sparklinePathBase.classList.add("chart-refresh");
    }
    if (elements.sparklinePathUp) {
      elements.sparklinePathUp.classList.add("chart-refresh");
    }
    if (elements.sparklinePathDown) {
      elements.sparklinePathDown.classList.add("chart-refresh");
    }
    if (elements.sparklinePathFlat) {
      elements.sparklinePathFlat.classList.add("chart-refresh");
    }
    if (elements.sparklineArea) {
      elements.sparklineArea.classList.add("chart-refresh");
    }

    const segmentPath = (kind) => {
      const parts = [];
      for (let i = 1; i < coords.length; i += 1) {
        const diff = Number(values[i]) - Number(values[i - 1]);
        const currentKind = diff > 1 ? "up" : diff < -1 ? "down" : "flat";
        if (currentKind !== kind) {
          continue;
        }
        const [x1, y1] = coords[i - 1];
        const [x2, y2] = coords[i];
        parts.push(`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`);
      }
      return parts.join(" ");
    };

    if (elements.sparklinePathBase) {
      elements.sparklinePathBase.setAttribute("d", path);
    }
    if (elements.sparklinePathUp) {
      elements.sparklinePathUp.setAttribute("d", segmentPath("up"));
    }
    if (elements.sparklinePathDown) {
      elements.sparklinePathDown.setAttribute("d", segmentPath("down"));
    }
    if (elements.sparklinePathFlat) {
      elements.sparklinePathFlat.setAttribute("d", segmentPath("flat"));
    }
    elements.sparklineDot.setAttribute("cx", dotX.toFixed(2));
    elements.sparklineDot.setAttribute("cy", dotY.toFixed(2));

    if (Number.isFinite(appState.signalDotX) && Number.isFinite(appState.signalDotY)) {
      const dx = appState.signalDotX - dotX;
      const dy = appState.signalDotY - dotY;
      elements.sparklineDot.style.transition = "none";
      elements.sparklineDot.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
      void elements.sparklineDot.getBoundingClientRect();
      elements.sparklineDot.style.transition = "transform 520ms cubic-bezier(0.23, 1, 0.32, 1)";
      elements.sparklineDot.style.transform = "translate(0, 0)";
    }

    appState.signalDotX = dotX;
    appState.signalDotY = dotY;

    elements.sparklineDot.classList.remove("pulse");
    void elements.sparklineDot.offsetWidth;
    elements.sparklineDot.classList.add("pulse");

    try {
      if (elements.sparklinePathBase) {
        const length = elements.sparklinePathBase.getTotalLength();
        elements.sparklinePathBase.style.transition = "none";
        elements.sparklinePathBase.style.strokeDasharray = `${length.toFixed(2)}`;
        elements.sparklinePathBase.style.strokeDashoffset = `${length.toFixed(2)}`;
        void elements.sparklinePathBase.getBoundingClientRect();
        elements.sparklinePathBase.style.transition = "stroke-dashoffset 520ms cubic-bezier(0.23, 1, 0.32, 1)";
        elements.sparklinePathBase.style.strokeDashoffset = "0";
      }
    } catch {
      // Keep rendering resilient on browsers that may fail path length reads.
    }

    const currentValue = selectedEntry ? Number(selectedEntry.score || 0) : 0;
    const previousValue = selectedPoint > 0
      ? Number(values[selectedPoint - 1] || currentValue)
      : currentValue;
    const delta = currentValue - previousValue;
    const trendEpsilon = 1;
    const trendClass = delta > trendEpsilon
      ? "trend-up"
      : delta < -trendEpsilon
        ? "trend-down"
        : "trend-flat";
    const stateClassName = selectedEntry ? `state-${stateClass(selectedEntry.state)}` : "state-normal";
    const trendClasses = ["trend-up", "trend-down", "trend-flat"];
    const stateClasses = ["state-normal", "state-warning", "state-error"];

    elements.sparklineArea.classList.remove(...trendClasses, ...stateClasses);
    elements.sparklineDot.classList.remove(...trendClasses, ...stateClasses);

    elements.sparklineArea.classList.add(trendClass, stateClassName);
    elements.sparklineDot.classList.add(trendClass, stateClassName);

    elements.latencyValue.textContent = String(currentValue);
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
