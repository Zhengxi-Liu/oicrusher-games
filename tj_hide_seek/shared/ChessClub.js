/**
 * TJ Hide and Seek - the chess club in Room 23 (floor 1): three student bots, one per table.
 * Shared by the server (who may start a game: you have to stand at the table) and the client (tables, students).
 * UMD: window.TJChess in the browser, module.exports in Node.
 *
 * level: js-chess-engine AI level (1-5, see server/ChessWorker.js); pts: points for beating them (once per bot per day).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TJChess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ROOM = { floor: 1, name: '23' };
  const BOTS = [
    { id: 'riley', name: 'Riley', label: 'Easy', level: 1, randomness: 60, look: 3, pts: 5, hello: 'Wanna play? I just learned how the horsey moves.' },
    { id: 'priya', name: 'Priya', label: 'Medium', level: 3, randomness: 15, look: 6, pts: 15, hello: 'Chess club meets here every day. Think you can beat me?' },
    { id: 'marcus', name: 'Marcus', label: 'Hard', level: 4, randomness: 0, look: 9, pts: 40, hello: 'Captain of the TJ chess team. Nobody has beaten me this week.' },
  ];
  const REACH = 2.6;            // metres from the table centre to start a game

  /** Where each table is: {bot, x, z, y, npc: {x, z, rot}} - a row across the middle of the room, the bots face south. */
  function spots(map) {
    const rm = map.rooms.find(r => r.floor === ROOM.floor && r.name === ROOM.name);
    if (!rm) return [];
    const bb = map.bbox(rm.poly), w = bb.x1 - bb.x0, h = bb.z1 - bb.z0;
    const z = bb.z0 + h * 0.55;
    return BOTS.map((bot, i) => {
      const x = bb.x0 + w * (0.22 + 0.28 * i);
      return { bot, x, z, y: 0, npc: { x, z: z - 0.62, rot: 0 } };
    });
  }

  return { ROOM, BOTS, REACH, spots };
});
