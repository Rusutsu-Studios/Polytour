<!-- bump: minor -->

### Changed

- Share personal settings between the lobby and pause menu, with language,
  graphics, saved board size and fullscreen controls (#130). Keep Audio reserved
  for the upcoming sound work.
- Label both settings buttons beside their gear icon: "Réglages" in French and
  "Settings" in English.
- Group reduced motion under Accessibility with System, On and Off choices,
  applying the same preference to scene animation and interface motion.
- Save client preferences together, migrate existing choices without deleting
  their legacy keys, and synchronize changes between browser tabs.
- Show debug tools and network diagnostics only in development or with `?debug`,
  and distinguish room rules from personal settings.
