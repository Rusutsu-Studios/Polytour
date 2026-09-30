# Polytour

A fast, good-looking multiplayer property-trading board game for the web, in the
spirit of Business Tour. 2–4 players, ~20-minute matches, buyouts and instant-win
monopolies, a stylized 3D board with heavy animation polish. Runs entirely on
Cloudflare Workers + Durable Objects.

**Status:** design phase. There's no code yet, only the docs below.

| Doc | What's in it |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Working rules for AI-assisted development in this repo |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Cloudflare system design, Durable Objects, storage, auth |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Libraries picked, the reasons, and what we rejected |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Rules v0, board, economy, win conditions, engine contract |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | WebSocket messages and game events |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Art direction, animation pipeline, signature moments, perf budgets |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased build plan |
