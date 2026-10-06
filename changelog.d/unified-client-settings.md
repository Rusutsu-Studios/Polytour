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
- Show debug tools and network diagnostics only in development or with `?debug`.
- Gather the room rules into the same settings panel as a Rules tab, so one gear
  opens every setting from the waiting room and from a running match (#130). The
  separate rules dialog and the in-match rules drawer are gone.
- Keep the rules editable for the room leader in the waiting room and read only
  once the match starts, saving a leader draft when the panel closes.
- Leave a solo game running while its rules are read; only the pause menu itself
  still pauses.
- Verify that Escape returns from match rules to the pause menu, then closes
  the menu and restores focus to the rules button (#136).
