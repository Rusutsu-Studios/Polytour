<!-- bump: minor -->
### Added
- Small question-mark buttons beside every room setting reuse the existing
  popup for French and English explanations, including read-only settings.
  Bot strategy and configuration-aware Gift help move into these popups.
- Select the default Easy, Medium or Hard bot difficulty before creating a room,
  then cycle each bot's visible level on its lobby card before starting. Persist
  mixed levels across reloads and show each frozen level in the match HUD, with
  French and English strategy explanations (#75).
- Strategic Hard decisions and a reproducible comparison across bot levels,
  adapted from #116 to the current rules. Existing unmarked saves keep Medium;
  all levels share the same rules and random sources.
### Changed
- Easy bots still construct and buy out properties, with occasional delayed
  upgrades and missed buyouts instead of systematically avoiding development.
