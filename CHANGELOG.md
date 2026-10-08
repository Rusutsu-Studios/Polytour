# What's new in Polytour

Player-facing updates, newest first. These notes describe changes merged into
the game; open pull requests are not included. Versions and dates identify the
application updates, independently of GitHub tags or release publication.

## [Unreleased]

## [0.8.0] - 2026-10-08

### Added

- Choose Easy, Medium or Hard bots before creating a room, then set each bot's
  level individually in the lobby. Their levels remain visible during the match.
  Easy bots sometimes pass up upgrades and buyouts; Hard bots plan more carefully.
  Every difficulty plays by the same rules and gets the same random dice.
- Play without a match time limit. Unlimited matches end through the enabled
  property wins or the last player standing; individual turns still have timers.
  You can also enter an exact match duration or a decision time from 10 to 60 seconds.
- Zoom the board with the wheel, +/- keys or a pinch, drag to rotate it, and
  Shift-drag to pan. Save your zoom, lock the view, or use Center map to return
  smoothly to the default view. Reduced motion resets the view immediately.
- Everyone sees an illustrated notice when a player cannot afford a free
  property or a buyout. It shows the player, property, price and available cash.
  Continue or Escape dismisses it before its four-second reading time ends.

### Changed

- Landing exactly on Start pays 150% of the salary: 600,000 with the default
  salary of 400,000. Crossing Start and stopping elsewhere pays the usual salary.
  Grand Tour receives the landing bonus too. Matches created before this update
  keep their original salary rule.
- A shared wheel reveals the randomly chosen starting player. Turns then follow
  the board clockwise, skipping empty seats and eliminated players. Existing
  matches keep their original turn order.
- Festivals are usually spread across different countries in new matches.
  Several festivals in one country remain possible, but are rare.
- Personal preferences and room rules share one Settings panel in the lobby
  and during a match. The leader can edit rules before starting; during play,
  everyone can read the rules without changing them.
- Language, graphics, board size, fullscreen, streamer mode and reduced motion
  are grouped in Settings. Personal choices are saved on this device and shared
  between its browser tabs. Audio remains coming soon.
- The board now visits Lyon, Marseille and Paris; Naples, Milan and Rome;
  Hamburg and Berlin; and Geneva and Zurich. The beaches are Seychelles,
  Maldives, Bora Bora and Hawaii. Prices, rents and tile positions are unchanged;
  older legacy boards keep their original destinations.
- Small houses are now cottages with owner-coloured roofs, chimneys, doors and
  windows visible from every side of the board.
- Rescue boat replaces the Jailbreak Chance card, with a boat and life-ring
  illustration. It releases everyone stranded on the Island without moving
  their pawns. Saved matches keep working with the renamed card.

### Fixed

- Bot difficulty explanations work on hover and keyboard focus, including when
  room rules are read only. Escape dismisses the explanation.
- Quick settings give labels and values clearer spacing. How to play has a book
  icon, and Center map and streamer mode explain their actions on hover or focus.
- Board gestures preserve property clicks and the Roll button. Trackpad pinches
  zoom the board without enlarging the whole page; intentional browser zoom
  shortcuts still work. A new gesture interrupts a view reset.
- Welcome, invitation and lobby board previews use their available desktop space.

## [0.7.5] - 2026-10-05

### Changed

- Maintenance release. Gameplay and room rules are unchanged.

## [0.7.4] - 2026-10-05

### Added

- Pause a solo match and resume with its remaining turn and match time intact.
  Multiplayer pauses require every human player's approval; a room can request
  one pause every five minutes.
- New Chance cards include Tailwind, Power Cut, Forced Sale, Shield, Patron and
  Roll Again. Fan Trip can send you to pay rent in the championship's host city;
  Gift makes you give a city to the poorest opponent.
- Keep an Escape card to leave the Island for free on a later turn. Held cards
  appear beside your cash and name; hover or focus a mini card to read it.
- Bare land flies a flag in its owner's colour as soon as it is bought.
- Streamer mode hides room codes and invitation codes while you share your screen.

### Changed

- New matches use a 36-card Chance deck with good and bad cards equally represented.
  Tax audit sends you to the Tax office, and Detour rolls for 1-6 spaces backwards.
  Existing matches keep the deck they started with.
- Each Chance card has its own drawing and a short explanation. Good cards have
  gold frames; bad cards have wooden frames. How to play holds the full details.
- Earthquake shakes the affected city, Power Cut darkens it, and Land Swap shows
  the new owners' colours. The game log identifies affected properties and players.
- Open the game log from its toolbar icon to see a compact history with action
  icons, coloured player names and clearly labelled doubles.
- First visits use your browser's French or English preference. A saved language
  choice takes priority.

### Fixed

- Your reduced-motion choice survives reloading, even when it differs from the
  operating system's preference.
- Held-card previews use the current illustrations, including the Escape card.
- Leaving or removing lobby players closes gaps between seats while preserving
  leadership, reconnection and players sharing one screen.
- Island choices explain unavailable actions and the remaining failed escape
  rolls before automatic release.
- The home screen, lobby and settings fit desktop displays more consistently.
  The welcome toolbar gives language, graphics and streamer mode matching controls.
- Missing pages offer a clear route home.

## [0.7.3] - 2026-10-04

### Changed

- Maintenance release. Gameplay and room rules are unchanged.

## [0.7.2] - 2026-10-04

### Changed

- Maintenance release. Gameplay and room rules are unchanged.

## [0.7.1] - 2026-10-04

### Changed

- The four-beach win is optional and off by default in new rooms. Existing
  matches keep their original win conditions.
- The leader's room settings save when the settings window closes.
- Start has a clearer arrow and is called Départ in French.

## [0.7.0] - 2026-10-04

### Added

- Build immediately after buying out a city: up to two houses before your first
  completed lap, three after it, or a Hotel on an eligible three-house city.

### Changed

- Owning all four beaches earns 200,000 rent. The property card shows the fourth
  rent tier. Existing matches retain their original rent and construction rules.

### Fixed

- After the dice reveal their total, your destination stays outlined in your
  colour throughout the move and the decision there.

## [0.6.1] - 2026-10-04

### Fixed

- Purchases, construction, sales, taxes and travel fees animate at the property
  or special space they belong to.
- Salary appears as soon as your pawn passes Start, including during World Tour,
  instead of waiting for the entire journey to finish.

## [0.6.0] - 2026-10-04

### Added

- Start has a small bank and a printed salary. Money animations make bank
  payments and property transactions easier to follow.

## [0.5.2] - 2026-10-04

### Added

- Choose whether three consecutive doubles send a player to the Island. The
  rule is on by default; turning it off lets the third double move normally.

## [0.5.1] - 2026-10-04

### Changed

- Festivals appear only on cities in new matches. Existing matches retain
  their original festival rules.

### Fixed

- Unavailable actions explain why on hover or keyboard focus, including missing
  cash, construction requirements and reconnecting.
- Chance cards and tax notices give everyone time to read before the next decision.
- Switch French and English directly with the globe-and-language button.
- Minimize a decision into a compact tab that keeps its countdown and selection.
- Joining and room preparation show progress inline.

## [0.5.0] - 2026-10-03

### Added

- Room settings summarize the active win conditions and explain how player-to-player
  gifts interact with bankruptcy and forced sales.

### Fixed

- Long settings scroll while their closing controls stay within short desktop screens.

## [0.4.4] - 2026-10-03

### Changed

- Refreshed French and English welcome text, creator credits and the project link.

## [0.4.3] - 2026-10-03

### Fixed

- The lobby board fills its preview area instead of appearing in a short canvas.

## [0.4.2] - 2026-10-03

### Fixed

- Leaving the lobby frees your seats and transfers leadership to another player,
  including in rooms with local players or people waiting for a place.

## [0.4.1] - 2026-10-03

### Changed

- Match graphics settings use clear High and Low choices in the pause menu.
- Room leaders choose a successor from player portraits.
- Property inspection uses fewer controls so the details stay easier to read.

## [0.4.0] - 2026-10-03

### Added

- Polytour has browser and home-screen icons, a share image, and French and
  English search descriptions. Private rooms stay out of search results.

## [0.3.1] - 2026-10-03

### Changed

- Festival cities display colourful pennant garlands, and the championship host
  keeps its searchlights.
- Two country groups have distinct concrete pavements to make them easier to tell apart.

## [0.3.0] - 2026-10-03

### Added

- Select the version in the welcome footer to read the game's release history.

### Changed

- The Championship corner has a stadium with a spinning trophy and lighting in
  the host's colour. World Tour has an airport, control tower and departing airliner.

## [0.2.0] - 2026-10-03

### Added

- Play opens a lobby with three bots. Friends joining with the room code can
  take a bot's place before the match starts.
- The room leader can lock the room, approve newcomers, transfer leadership,
  give a waiting player a bot's seat, and return everyone to the lobby.
- Several players can share one computer, with each decision labelled for the
  player whose turn it is. Mid-game newcomers can watch while waiting for a seat.
- Personal settings include graphics and reduced motion. Audio is marked coming soon.
- A High/Low graphics choice offers lighter rendering for older PCs.

### Changed

- World Tour can reach your own properties as well as unowned ones in new rooms.
  Existing matches retain their original destinations.
- Long moves follow the board route and show salary when passing Start. World
  Tour's destination picker includes the salary you will collect.
- Country groups have distinct colours and pavements. City lots separate their
  names and buildings from the price or rent strip; beaches have sandy ground.
- Player colours identify pawns, ownership and menus consistently. Softer road
  markings make names and prices easier to read.
- Animation catch-up and reconnect recovery run automatically.

### Fixed

- Invitation links ask only for a nickname, recover saved seats and offer retry
  or a return home when joining fails.
- Chance draws are independent of visible setup information and earlier draws.

## [0.1.0] - 2026-10-03

### Added

- First recorded playable desktop prototype: private rooms for 2-4 players,
  server bots, a 32-space 3D board, French and English controls, and reconnection
  to saved matches.
- Buy cities and beaches, build houses and Hotels, pay rent, and sell properties
  to settle debts. Inspect a property to see its owner, price and rent.
- Discover Chance cards, the Island, Championship and World Tour. Choose
  properties directly on the board for travel, hosting and forced sales.
- Play on a board grouped by country, with ownership colours, beach bungalows,
  a growing central town and turn countdowns beside each player.
- New matches use the reference economy and configured property wins. Matches
  already saved keep the rules and economy they started with.
