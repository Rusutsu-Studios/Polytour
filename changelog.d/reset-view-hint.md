### Changed

- Remove question-mark buttons from settings and the start page. Bot difficulty
  choices explain their behavior on hover or focus, including in read-only
  settings. How to play keeps its button with a book icon (#151).
- Streamer mode and Center map explain their actions with a small popup on
  hover or keyboard focus. The other settings have no explanatory popups.

### Fixed

- Center map, Default view and the 0 shortcut smoothly restore zoom, rotation
  and centering. Reduced motion keeps an immediate reset; new gestures stop
  the transition. The Center map explanation is a short sentence.
- Quick settings show each label above its value with clear spacing.
- Bot difficulty explanations stay dismissible with Escape, remain readable
  with keyboard focus, and never pin open when a difficulty is selected.
