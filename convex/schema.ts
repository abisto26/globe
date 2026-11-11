import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // A username, owned by the device id that created it and protected by a 4-digit PIN.
  // Another device signs in with username + PIN and then shares the same id.
  users: defineTable({
    pid: v.string(),      // private player id (kept on the player's devices, never sent to others)
    name: v.string(),     // username as typed, e.g. "Abisto"
    key: v.string(),      // lowercase form, unique: "abisto"
    salt: v.string(),
    pinHash: v.string(),
    fails: v.number(),    // wrong PINs in a row
    lockedUntil: v.number(),
    lastSubmit: v.number(),
    streak: v.optional(v.number()),     // most right answers in a row, any game (🔥 On fire)
    champion: v.optional(v.boolean()),  // has been #1 on a leaderboard (👑 Champion)
    avatar: v.optional(v.string()),     // chosen picture, "ibnbattuta:1" (picture:colour)
    prog: v.optional(v.record(v.string(), v.number())), // achievement progress: bull, light, explore, untouch, days, langs
  })
    .index("by_pid", ["pid"])
    .index("by_key", ["key"]),

  // Best result per user per board.
  bests: defineTable({
    pid: v.string(),
    name: v.string(),
    board: v.string(), // "flags_easy", "countries", "cities_pro", ...
    best: v.number(),
    tours: v.optional(v.number()), // most "world tours" (whole list seen) in one game
    at: v.number(),    // when that best was set; earlier wins a tie
  })
    .index("by_board_best", ["board", "best"])
    .index("by_pid_board", ["pid", "board"]),

  // Anonymous daily numbers, one row per day (Morocco time). No names, no ids: each phone adds 1 to
  // "players" the first time it opens the game that day; every finished game adds 1 to "games".
  daily: defineTable({
    day: v.string(),                    // "2026-11-11"
    players: v.number(),                // phones that opened the game that day
    named: v.number(),                  // ... of which had a username
    games: v.number(),                  // finished games
    newUsers: v.number(),               // usernames created
    byGame: v.record(v.string(), v.number()), // finished games per board
  }).index("by_day", ["day"]),

  // First version (name only, no usernames). Kept so old rows don't block deploys; no longer used.
  players: defineTable(v.any()),
  scores: defineTable(v.any()),
});
