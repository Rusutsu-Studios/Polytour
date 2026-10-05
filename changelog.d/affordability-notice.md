<!-- bump: minor -->

### Added

- Everyone now sees a large illustrated notice when a player cannot afford the
  buyout of an opponent's city or the land of a free city or resort (#98). It
  names the player ("you" on their own screen), the city, the price and their
  cash, and stays for four seconds or until Continue or Escape.

### Changed

- A player who cannot pay for even the land of a free city or resort no longer
  gets a buy decision with every option locked; the notice replaces it. The
  outcome is the same as declining. Protocol version 8 adds the
  `PurchaseUnaffordable` event, so clients opened before the update reload.
