import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// One row per player (a random id kept on their device) and one row per player per board.
export default defineSchema({
  players: defineTable({
    pid: v.string(),
    name: v.string(),
    lastSubmit: v.number(),
  }).index("by_pid", ["pid"]),

  scores: defineTable({
    pid: v.string(),
    name: v.string(),
    board: v.string(), // e.g. "flags_easy", "countries", "cities_pro"
    best: v.number(),  // most right answers in one game
    at: v.number(),    // when that best was set; earlier wins a tie
  })
    .index("by_board_best", ["board", "best"])
    .index("by_pid_board", ["pid", "board"]),
});
