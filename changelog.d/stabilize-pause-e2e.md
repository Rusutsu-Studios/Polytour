<!-- bump: patch -->

### Fixed

- Two Pause end-to-end tests no longer fail on a slow CI runner: the frozen-clock
  helper retries when the page clock has already passed its target, and the solo
  pause test waits for a bot decision with more time left.
