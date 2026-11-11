/**
 * The eight carrier aircraft of Carrier War (WWII: a fighter, a dive bomber and a torpedo bomber per navy). Gameplay numbers only - the flight
 * models are derived in client/CarrierPlanes.js. hp is in "hits" (a .50 cal round that lands = 1); gun = damage of one round.
 * flak = how many AA hits the airframe takes (BALANCE: kept within a narrow band across both navies - the AA lethality is about being hit at all, so
 * the fragile IJN airframes are only a little worse off against flak than the rugged USN ones; against guns they keep their real hp).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CWPlanes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PLANES = {
    hellcat:   { id: 'hellcat',   team: 0, role: 'fighter', name: 'F6F Hellcat',    hp: 16, flak: 14, gun: 1,   bombs: 0 },
    corsair:   { id: 'corsair',   team: 0, role: 'fighter', name: 'F4U Corsair',    hp: 17, flak: 14, gun: 1,   bombs: 2, bomb: 'b500' },
    dauntless: { id: 'dauntless', team: 0, role: 'bomber',  name: 'SBD Dauntless',  hp: 13, flak: 13, gun: 1,   bombs: 1, bomb: 'b1000' },
    avenger:   { id: 'avenger',   team: 0, role: 'torpedo', name: 'TBF Avenger',    hp: 15, flak: 14, gun: 1,   bombs: 1, bomb: 'tp' },
    zero:      { id: 'zero',      team: 1, role: 'fighter', name: 'A6M Zero',       hp: 9,  flak: 12, gun: 1.6, bombs: 1, bomb: 'b500' },
    kate:      { id: 'kate',      team: 1, role: 'torpedo', name: 'B5N Kate',       hp: 10, flak: 13, gun: 0.7, bombs: 1, bomb: 'tp' },
    suisei:    { id: 'suisei',    team: 1, role: 'bomber',  name: 'D4Y Suisei',     hp: 10, flak: 12, gun: 0.9, bombs: 1, bomb: 'b1000' },
    val:       { id: 'val',       team: 1, role: 'bomber',  name: 'D3A Val',        hp: 11, flak: 13, gun: 0.7, bombs: 2, bomb: 'b500' },
  };
  const TEAMS = [
    { id: 0, name: 'US Navy', short: 'USN', planes: ['hellcat', 'corsair', 'dauntless', 'avenger'] },
    { id: 1, name: 'Imperial Japanese Navy', short: 'IJN', planes: ['zero', 'suisei', 'val', 'kate'] },
  ];
  return { PLANES, TEAMS, IDS: Object.keys(PLANES) };
});
