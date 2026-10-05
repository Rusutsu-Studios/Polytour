<!-- bump: patch -->

### Fixed

- The "Reduce motion" choice in Pause → Settings → Video is now kept. It was
  read from the operating system on every load, so a player whose system asks
  for less motion lost the animations again at each reload and could not keep
  them on. The system setting now only supplies the first default, and the
  player's own answer wins from then on.
