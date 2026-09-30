# Polytour

A fast, multiplayer property-strategy board game for the web. Two to four players
race through ~20-minute matches with buyouts, instant-win monopolies, and a stylized
3D board planned for a later phase. It runs on Cloudflare Workers + Durable Objects.

**Status:** Phase 0 scaffold. The React client, Worker, and Durable Object health
checks are in place; the deterministic rules engine is next.

| Doc | What's in it |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Working rules for AI coding agents (Codex reads it; [CLAUDE.md](CLAUDE.md) imports it for Claude Code) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cloudflare system design, Durable Objects, storage, auth |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Libraries picked, the reasons, and what we rejected |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Rules v0.1, board, economy, win conditions, engine contract |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebSocket messages and game events |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Art direction, animation pipeline, signature moments, perf budgets |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased build plan |
