# Shared game code

This directory is reserved for deterministic code imported by both the Worker and
client: board configuration, the rules engine, and protocol schemas. It must never
import from `src/client` or `src/worker`.
