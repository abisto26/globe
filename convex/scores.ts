import {
  queryGeneric, mutationGeneric,
  type QueryBuilder, type MutationBuilder, type DataModelFromSchemaDefinition,
} from "convex/server";
import { v } from "convex/values";
import schema from "./schema";
import { bump } from "./stats";

// Leaderboard for Globe by Abisto.
// Players pick a unique username and a 4-digit PIN. Each device keeps a private player id;
// signing in with username + PIN on another device hands that device the same id.

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;

const BOARD = /^(?:(?:flags|capitals|cities)_(?:easy|pro)|countries|twist)$/;
const PID = /^[a-z0-9]{20,40}$/;
const PIN = /^\d{4}$/;
const MAX_BEST = 3000;         // sanity cap: with 15 s per question this is over 12 hours of play without a miss
const MIN_GAP_MS = 1500;       // at most one save every 1.5 seconds per player
// how many places each game's list has: a best score this high means the whole list was played (🌍 World tour)
const LIST_SIZE: Record<string, number> = { flags_easy: 171, flags_pro: 134, countries: 134, capitals_easy: 164, capitals_pro: 164, cities_easy: 72, cities_pro: 72, twist: 670 };
const toursOf = (r: { board: string; best: number; tours?: number }) => Math.max(r.tours ?? 0, Math.floor(r.best / (LIST_SIZE[r.board] ?? 1e9)));
const FIRE = [25, 50]; // 🔥 On fire: silver at 25 in a row, gold at 50
const fireOf = (streak?: number) => (streak ?? 0) >= FIRE[1] ? 2 : (streak ?? 0) >= FIRE[0] ? 1 : 0;
const AVATAR = /^(abisto|ibnbattuta|marcopolo|columbus|zhenghe|earhart|tereshkova|nellybly|captain|fox|panda|lion|penguin|turtle|owl):[0-5]$/;
// achievement progress sent by the game; each kept as the best value seen (languages: one bit per language, combined)
const PROG_MAX: Record<string, number> = { bull: 1, light: 3000, explore: 200, untouch: 3000, days: 3660, langs: 15, cont: 31 };
function mergeProg(old: Record<string, number> | undefined, add: Record<string, number> | undefined) {
  const out: Record<string, number> = { ...(old ?? {}) };
  let changed = false;
  for (const [k, raw] of Object.entries(add ?? {})) {
    const max = PROG_MAX[k]; if (max === undefined || !Number.isInteger(raw) || raw < 0 || raw > max) continue;
    const next = k === "langs" || k === "cont" ? ((out[k] ?? 0) | raw) : Math.max(out[k] ?? 0, raw);
    if (next !== (out[k] ?? 0)) { out[k] = next; changed = true; }
  }
  return changed ? out : null;
}
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
  // mode: "rename" = only rename this device's own username (an existing name is refused),
  // "signin" = only sign in to an existing username; left out = either (first-time setup)
  args: { pid: v.string(), username: v.string(), pin: v.string(), mode: v.optional(v.union(v.literal("rename"), v.literal("signin"))) },
  handler: async (ctx, { pid, username, pin, mode }) => {
    if (!PID.test(pid)) throw new Error("bad player id");
    const name = cleanName(username), key = name.toLowerCase();
    if (name.length < 3 || name !== username.normalize("NFKC")) return { ok: false as const, reason: "bad_name" };
    if (!PIN.test(pin)) return { ok: false as const, reason: "bad_pin" };
    const now = Date.now();

    const owner = await ctx.db.query("users").withIndex("by_key", q => q.eq("key", key)).unique();
    if (mode === "rename" && owner && owner.pid !== pid) return { ok: false as const, reason: "taken" };
    if (mode === "signin" && !owner) return { ok: false as const, reason: "no_user" };
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
      await bump(ctx, { newUsers: 1 });
    }
    return { ok: true as const, pid, name, signedIn: false };
  },
});

/** Save results (one finished game, or the bests a device kept while offline). Keeps the best per board. */
/* 📅 Daily traveller follows the username, not the device: each finished game reports the player's
   local date, and the server keeps the run of days in a row (phone, computer and installed app together). */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const prevDay = (d: string) => new Date(Date.parse(d + "T12:00:00Z") - 864e5).toISOString().slice(0, 10);
// streaks given back by hand (days already played before the server kept them); used once, the first time
const RUN_GRANTS: Record<string, { run: number; lastDay: string }> = { abisto26: { run: 6, lastDay: "2026-11-12" } };
export const played = mutation({
  args: { pid: v.string(), day: v.string() },
  handler: async (ctx, { pid, day }) => {
    if (!PID.test(pid) || !DAY.test(day)) return null;
    // the local date can only be a day away from the server's (time zones)
    const off = Math.abs(Date.parse(day + "T12:00:00Z") - Date.now());
    if (!(off < 2 * 864e5)) return null;
    const user = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (!user) return null;
    let run = user.run, last = user.lastDay;
    if (run === undefined && RUN_GRANTS[user.key]) ({ run, lastDay: last } = RUN_GRANTS[user.key]);
    if (last === day) { /* already counted today */ }
    else if (last && last > day) return { run: run ?? 1 }; // a date earlier than one we have: ignore
    else { run = last === prevDay(day) ? (run ?? 0) + 1 : 1; last = day; }
    const prog = mergeProg(user.prog, { days: Math.min(run ?? 1, PROG_MAX.days) });
    await ctx.db.patch(user._id, prog ? { run, lastDay: last, prog } : { run, lastDay: last });
    return { run: run ?? 1 };
  },
});

export const submit = mutation({
  args: { pid: v.string(), scores: v.array(v.object({ board: v.string(), best: v.number(), tours: v.optional(v.number()) })), streak: v.optional(v.number()),
          prog: v.optional(v.record(v.string(), v.number())) },
  handler: async (ctx, { pid, scores, streak, prog }) => {
    if (!PID.test(pid)) throw new Error("bad player id");
    if (scores.length > 10) throw new Error("too many");
    const user = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (!user) return { newBest: [] as string[], newChampion: false, noUser: true };
    const now = Date.now();
    if (now - user.lastSubmit < MIN_GAP_MS) return { newBest: [] as string[], newChampion: false, throttled: true };
    await ctx.db.patch(user._id, { lastSubmit: now });

    const newBest: string[] = [];
    for (const { board, best, tours: t } of scores) {
      if (!BOARD.test(board) || !Number.isInteger(best) || best < 1 || best > MAX_BEST) continue;
      // a world tour means the whole list was played (72 to 171 places, depending on the game),
      // so there can't be more tours than right answers allow
      const tours = t !== undefined && Number.isInteger(t) && t > 0 && t * 60 <= best + 10 ? t : 0;
      const row = await ctx.db.query("bests").withIndex("by_pid_board", q => q.eq("pid", pid).eq("board", board)).unique();
      if (!row) { await ctx.db.insert("bests", { pid, name: user.name, board, best, at: now, ...(tours ? { tours } : {}) }); newBest.push(board); continue; }
      const patch: { name?: string; best?: number; at?: number; tours?: number } = {};
      if (best > row.best) { Object.assign(patch, { name: user.name, best, at: now }); newBest.push(board); }
      if (tours > (row.tours ?? 0)) patch.tours = tours;
      if (Object.keys(patch).length) await ctx.db.patch(row._id, patch);
    }
    // 🔥 best run of right answers (can't be more than a whole game's score)
    const topScore = Math.max(0, ...scores.map(x => x.best));
    if (streak !== undefined && Number.isInteger(streak) && streak > (user.streak ?? 0) && streak <= Math.max(topScore, MAX_BEST))
      await ctx.db.patch(user._id, { streak });
    const merged = mergeProg(user.prog, prog);
    if (merged) await ctx.db.patch(user._id, { prog: merged });
    // 👑 #1 on any board this player is on
    let newChampion = false;
    if (!user.champion) {
      for (const { board } of scores) {
        if (!BOARD.test(board)) continue;
        const first = await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", board)).order("desc").first();
        if (first && first.pid === pid) { await ctx.db.patch(user._id, { champion: true }); newChampion = true; break; }
      }
    }
    return { newBest, newChampion };
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
  args: { board: v.string(), pid: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { board, pid, limit }) => {
    if (!BOARD.test(board)) throw new Error("bad board");
    const top = await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", board)).order("desc").take(100);
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
    // results screen asks for 5 (the default), the leaderboard sheet for 100
    const shown = top.slice(0, Math.min(100, Math.max(1, Math.floor(limit ?? 5))));
    // badges next to names: 🌍 world tours on this board, 🔥 best streak, 👑 champion
    const userOf = async (p: string) => ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", p)).unique();
    const badges = async (r: { pid: string; board: string; best: number; tours?: number }, isFirst: boolean) => {
      const u = await userOf(r.pid);
      return { tours: toursOf(r), fire: fireOf(u?.streak), champ: !!u?.champion || isFirst, avatar: u?.avatar ?? "" };
    };
    const rows = [];
    for (const [i, r] of shown.entries()) rows.push({ name: r.name, best: r.best, me: r.pid === pid, ...(await badges(r, i === 0)) });
    let meOut = null;
    if (me && pid) {
      const mine = await ctx.db.query("bests").withIndex("by_pid_board", q => q.eq("pid", pid).eq("board", board)).unique();
      meOut = { ...me, ...(mine ? await badges(mine, me.rank === 1) : { tours: 0, fire: 0, champ: false, avatar: "" }) };
    }
    return { top: rows, me: meOut, count };
  },
});

/** A player's profile: best score, best streak, world tours and achievements. */
export const profile = query({
  args: { pid: v.string() },
  handler: async (ctx, { pid }) => {
    if (!PID.test(pid)) return null;
    const user = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (!user) return null;
    const rows = await ctx.db.query("bests").withIndex("by_pid_board", q => q.eq("pid", pid)).collect();
    let best = 0, bestBoard = "", tours = 0, firstOn: string[] = [];
    const modes = new Set<string>(); let proBest = 0;
    for (const r of rows) {
      if (r.best >= 10) modes.add(r.board.split("_")[0]);
      if (r.board.endsWith("_pro")) proBest = Math.max(proBest, r.best);
      if (r.best > best) { best = r.best; bestBoard = r.board; }
      tours += toursOf(r);
      const first = await ctx.db.query("bests").withIndex("by_board_best", q => q.eq("board", r.board)).order("desc").first();
      if (first && first.pid === pid) firstOn.push(r.board);
    }
    return { name: user.name, best, bestBoard, tours, streak: user.streak ?? 0, fire: fireOf(user.streak),
             champion: !!user.champion || firstOn.length > 0, firstOn, avatar: user.avatar ?? "",
             prog: { ...(user.prog ?? {}), allround: modes.size, pro: proBest } };
  },
});

/** Save the player's avatar (picture and background colour). */
export const setAvatar = mutation({
  args: { pid: v.string(), avatar: v.string() },
  handler: async (ctx, { pid, avatar }) => {
    if (!PID.test(pid) || !AVATAR.test(avatar)) throw new Error("bad avatar");
    const user = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (user) await ctx.db.patch(user._id, { avatar });
    return !!user;
  },
});
