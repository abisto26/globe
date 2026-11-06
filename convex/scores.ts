import {
  queryGeneric, mutationGeneric,
  type QueryBuilder, type MutationBuilder, type DataModelFromSchemaDefinition,
} from "convex/server";
import { v } from "convex/values";
import schema from "./schema";

// Leaderboard for Globe by Abisto.
// Players pick a unique username and a 4-digit PIN. Each device keeps a private player id;
// signing in with username + PIN on another device hands that device the same id.

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;

const BOARD = /^(?:(?:flags|capitals|cities)_(?:easy|pro)|countries)$/;
const PID = /^[a-z0-9]{20,40}$/;
const PIN = /^\d{4}$/;
const MAX_BEST = 400;          // nobody gets this many right in one game
const MIN_GAP_MS = 1500;       // at most one save every 1.5 seconds per player
const MAX_FAILS = 5;           // wrong PINs before a username is locked for a while
const LOCK_MS = 10 * 60 * 1000;

const cleanName = (s: string) =>
  s.normalize("NFKC").replace(/[^\p{L}\p{N}_.\-]/gu, "").slice(0, 16);
const keyOf = (s: string) => cleanName(s).toLowerCase();

async function hashPin(salt: string, pin: string) {
  const data = new TextEncoder().encode(`globe-by-abisto:${salt}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
const newSalt = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join("");

/**
 * Create a username, rename your own, or sign in to an existing one with its PIN.
 * Returns the player id this device should use from now on.
 */
export const claim = mutation({
  args: { pid: v.string(), username: v.string(), pin: v.string() },
  handler: async (ctx, { pid, username, pin }) => {
    if (!PID.test(pid)) throw new Error("bad player id");
    const name = cleanName(username), key = name.toLowerCase();
    if (name.length < 3 || name !== username.normalize("NFKC")) return { ok: false as const, reason: "bad_name" };
    if (!PIN.test(pin)) return { ok: false as const, reason: "bad_pin" };
    const now = Date.now();

    const owner = await ctx.db.query("users").withIndex("by_key", q => q.eq("key", key)).unique();
    if (owner && owner.pid !== pid) {
      // someone else's username: sign in with its PIN
      if (owner.lockedUntil > now) return { ok: false as const, reason: "locked", wait: Math.ceil((owner.lockedUntil - now) / 60000) };
      if ((await hashPin(owner.salt, pin)) !== owner.pinHash) {
        const fails = owner.fails + 1;
        await ctx.db.patch(owner._id, fails >= MAX_FAILS ? { fails: 0, lockedUntil: now + LOCK_MS } : { fails });
        return { ok: false as const, reason: "wrong_pin" };
      }
      await ctx.db.patch(owner._id, { fails: 0 });
      return { ok: true as const, pid: owner.pid, name: owner.name, signedIn: true };
    }

    const salt = newSalt(), pinHash = await hashPin(salt, pin);
    const me = owner ?? (await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique());
    if (me) {
      // this device's own username: new spelling and/or new name and PIN
      await ctx.db.patch(me._id, { name, key, salt, pinHash, fails: 0 });
      const rows = await ctx.db.query("bests").withIndex("by_pid_board", q => q.eq("pid", pid)).collect();
      for (const r of rows) if (r.name !== name) await ctx.db.patch(r._id, { name });
    } else {
      await ctx.db.insert("users", { pid, name, key, salt, pinHash, fails: 0, lockedUntil: 0, lastSubmit: 0 });
    }
    return { ok: true as const, pid, name, signedIn: false };
  },
});

/** Save results (one finished game, or the bests a device kept while offline). Keeps the best per board. */
export const submit = mutation({
  args: { pid: v.string(), scores: v.array(v.object({ board: v.string(), best: v.number() })) },
  handler: async (ctx, { pid, scores }) => {
    if (!PID.test(pid)) throw new Error("bad player id");
    if (scores.length > 10) throw new Error("too many");
    const user = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (!user) return { newBest: [] as string[], noUser: true };
    const now = Date.now();
    if (now - user.lastSubmit < MIN_GAP_MS) return { newBest: [] as string[], throttled: true };
    await ctx.db.patch(user._id, { lastSubmit: now });

    const newBest: string[] = [];
    for (const { board, best } of scores) {
      if (!BOARD.test(board) || !Number.isInteger(best) || best < 1 || best > MAX_BEST) continue;
      const row = await ctx.db.query("bests").withIndex("by_pid_board", q => q.eq("pid", pid).eq("board", board)).unique();
      if (!row) { await ctx.db.insert("bests", { pid, name: user.name, board, best, at: now }); newBest.push(board); }
      else if (best > row.best) { await ctx.db.patch(row._id, { name: user.name, best, at: now }); newBest.push(board); }
    }
    return { newBest };
  },
});

/** This device's username, if it has one (e.g. after signing in elsewhere and coming back). */
export const me = query({
  args: { pid: v.string() },
  handler: async (ctx, { pid }) => {
    if (!PID.test(pid)) return null;
    const user = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    return user ? { name: user.name } : null;
  },
});

/** Top 5 players on a board, plus this player's own rank. */
export const board = query({
  args: { board: v.string(), pid: v.optional(v.string()) },
  handler: async (ctx, { board, pid }) => {
    if (!BOARD.test(board)) throw new Error("bad board");
    const top = await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", board)).order("desc").take(50);
    top.sort((a, b) => b.best - a.best || a.at - b.at);

    let me: { rank: number; best: number; name: string } | null = null;
    if (pid && PID.test(pid)) {
      const mine = await ctx.db.query("bests").withIndex("by_pid_board", q => q.eq("pid", pid).eq("board", board)).unique();
      if (mine) {
        // everyone with a higher score, plus those who reached the same score earlier
        const higher = await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", board).gt("best", mine.best)).collect();
        const tied = await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", board).eq("best", mine.best)).collect();
        me = { rank: higher.length + tied.filter(r => r.at < mine.at).length + 1, best: mine.best, name: mine.name };
      }
    }
    const count = (await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", board)).collect()).length;
    return { top: top.slice(0, 5).map(r => ({ name: r.name, best: r.best, me: r.pid === pid })), me, count };
  },
});
