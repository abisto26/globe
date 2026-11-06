import {
  queryGeneric, mutationGeneric,
  type QueryBuilder, type MutationBuilder, type DataModelFromSchemaDefinition,
} from "convex/server";
import schema from "./schema";

// Typed against the schema without needing generated files.
type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;
import { v } from "convex/values";

// Leaderboard for Globe by Abisto.
// A player is a random id stored on their device; it is never sent back to other players.

const BOARD = /^(?:(?:flags|capitals|cities)_(?:easy|pro)|countries)$/;
const PID = /^[a-z0-9]{20,40}$/;
const MAX_BEST = 400;        // nobody gets this many right in one game
const MIN_GAP_MS = 3000;     // at most one save every 3 seconds per player

const cleanName = (s: string) =>
  s.replace(/[^\p{L}\p{N} _.\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 16);

function check(pid: string, board?: string) {
  if (!PID.test(pid)) throw new Error("bad player id");
  if (board !== undefined && !BOARD.test(board)) throw new Error("bad board");
}

/** Save a finished game. Keeps only the player's best per board. Returns whether it was a new best. */
export const submit = mutation({
  args: { pid: v.string(), name: v.string(), board: v.string(), best: v.number() },
  handler: async (ctx, { pid, name, board, best }) => {
    check(pid, board);
    const n = cleanName(name);
    if (n.length < 2) throw new Error("name too short");
    if (!Number.isInteger(best) || best < 1 || best > MAX_BEST) throw new Error("bad score");

    const now = Date.now();
    const player = await ctx.db.query("players").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (player && now - player.lastSubmit < MIN_GAP_MS) return { newBest: false, throttled: true };
    if (player) await ctx.db.patch(player._id, { name: n, lastSubmit: now });
    else await ctx.db.insert("players", { pid, name: n, lastSubmit: now });

    const row = await ctx.db.query("scores").withIndex("by_pid_board", q => q.eq("pid", pid).eq("board", board)).unique();
    if (!row) { await ctx.db.insert("scores", { pid, name: n, board, best, at: now }); return { newBest: true }; }
    if (best > row.best) { await ctx.db.patch(row._id, { name: n, best, at: now }); return { newBest: true }; }
    if (row.name !== n) await ctx.db.patch(row._id, { name: n });
    return { newBest: false };
  },
});

/** Change the name shown on every board this player is on. */
export const rename = mutation({
  args: { pid: v.string(), name: v.string() },
  handler: async (ctx, { pid, name }) => {
    check(pid);
    const n = cleanName(name);
    if (n.length < 2) throw new Error("name too short");
    const player = await ctx.db.query("players").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (!player) return null; // never played a scored game: nothing to rename
    await ctx.db.patch(player._id, { name: n });
    const rows = await ctx.db.query("scores").withIndex("by_pid_board", q => q.eq("pid", pid)).collect();
    for (const r of rows) await ctx.db.patch(r._id, { name: n });
    return null;
  },
});

/** Top players on a board, plus this player's own rank. */
export const board = query({
  args: { board: v.string(), pid: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { board, pid, limit }) => {
    check(pid ?? "x".repeat(20), board);
    const top = await ctx.db.query("scores").withIndex("by_board_best", q => q.eq("board", board))
      .order("desc").take(50);
    const byRank = (a: { best: number; at: number }, b: { best: number; at: number }) => b.best - a.best || a.at - b.at;
    top.sort(byRank);
    const n = Math.min(Math.max(1, limit ?? 3), 20);

    let me: { rank: number; best: number; name: string } | null = null;
    if (pid) {
      const mine = await ctx.db.query("scores").withIndex("by_pid_board", q => q.eq("pid", pid).eq("board", board)).unique();
      if (mine) {
        // everyone with a higher score, plus those who reached the same score earlier
        const higher = await ctx.db.query("scores").withIndex("by_board_best", q => q.eq("board", board).gt("best", mine.best)).collect();
        const tied = await ctx.db.query("scores").withIndex("by_board_best", q => q.eq("board", board).eq("best", mine.best)).collect();
        me = { rank: higher.length + tied.filter(r => r.at < mine.at).length + 1, best: mine.best, name: mine.name };
      }
    }
    const count = (await ctx.db.query("scores").withIndex("by_board_best", q => q.eq("board", board)).collect()).length;
    return {
      top: top.slice(0, n).map(r => ({ name: r.name, best: r.best, me: r.pid === pid })),
      me,
      count,
    };
  },
});
