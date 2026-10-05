### Fixed

- Follow the board's direction when passing turns: bottom-right, bottom-left,
  top-left, then top-right, skipping empty and eliminated seats. Reveal the
  randomly selected starting player with a shared, bounded wheel animation,
  respecting reduced motion and snapshot recovery (#110). The wheel selects for
  3.6 seconds and holds its result for 3.4 seconds; coloured name badges remain
  empty until the order numbers appear. First-turn clocks and bots reserve the
  full seven-second presentation.

### Changed

- Spread initial festivals across countries in new rooms. With three festivals,
  a country receives several in about 3% of matches; rare grouped draws remain
  possible. Keep the configured count and preserve older rooms' festival rules.
