<!-- bump: minor -->

### Added

- Persistent streamer mode hides room codes in the lobby and match, masks the
  manual join input, and removes invitation codes from the address bar (#37).
- Missing pages show a roundabout and car with a keyboard-accessible link home
  while returning HTTP 404 (#92).
- New rooms include a retained Escape card that releases its holder from Lost
  Island for free; saved rooms retain their existing card decks (#48).
- The welcome menu opens video settings from a gear button. The network status
  beside the credits and in a match opens the same settings panel on Debug.
- First visits follow the browser's French or English language preference;
  an explicitly saved language choice takes priority.

### Fixed

- The welcome toolbar removes the Prototype badge and gives graphics and streamer
  mode the same text-control styling as language; active streamer mode uses red
  text (#37).
- Interface minus signs use the standard ASCII hyphen-minus (-).
- The pause menu uses a gear button for settings, and the language shortcut
  remains available in the welcome toolbar.
- Lobby departures and player removals shift occupied seats left, preserving
  leadership, reconnect credentials and local player controls. New players and
  bots fill the first open seat (#94).
- Lost Island displays its title once, uses an island icon and keeps unavailable
  escape choices visible with explanations (#48).
- Lost Island descriptions include the Escape card when available under the
  room’s rules, and the turn decision shows how many failed rolls remain until
  automatic release (#87).
- Regression coverage confirms Championship choices work during the first lap,
  including a city acquired during doubles in the same turn (#83).
