<!--
  Claude Code reads CLAUDE.md, and Codex reads AGENTS.md. The import below keeps them
  to one shared file. CI checks that this line exists. Put project rules in AGENTS.md.
-->
@AGENTS.md

## Claude Code

- Project rules live in AGENTS.md, which Codex reads too. When asked to add or change
  a rule, including "add this to CLAUDE.md", edit AGENTS.md. Put a rule in this file
  only if it applies to Claude Code alone, because Codex never sees it.
