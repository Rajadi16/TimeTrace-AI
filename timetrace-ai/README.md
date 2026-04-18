# TimeTrace AI

TimeTrace AI is a next-generation VS Code extension that helps developers understand how errors evolve over time by rewinding code execution states.

## Features

- **Interactive Timeline**: Scrub through your file's history to see exact structural and logic changes.
- **Incident Engine**: Automatically groups findings across saves into coherent incidents.
- **Root Cause Analysis**: Detects regressions and ranks probable root causes by using AST-driven dependency graphs.
- **Cross-File Context**: Automatically identifies impacted downstream dependencies and upstream requirements.

## Requirements

- VS Code 1.94.0 or newer (v1.116).
- Node.js environment (for runtime telemetry correlation, optional).

## Known Issues

- The V3 runtime correlation is currently in beta and expects manual telemetry event injections or specific Node bindings.

## Release Notes

### 0.0.1
- V3 Integration (Sidebar, Correlation Engine, Checkpoint State)
- Stable release with backend and frontend integration intact.

**Enjoy TimeTrace AI!**
