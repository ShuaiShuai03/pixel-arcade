import { ROOMS_A } from './tether-twins-rooms-a.js';
import { ROOMS_B } from './tether-twins-rooms-b.js';

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

// Every room gets the same shape, so the simulation never has to test for missing lists.
const normalize = (room) => ({
  posts: [],
  relays: [],
  plates: [],
  rings: [],
  holds: [],
  pulse: null,
  ...room,
});

export const ROOMS = deepFreeze([...ROOMS_A, ...ROOMS_B].map(normalize));
export const ROOM_COUNT = ROOMS.length;
