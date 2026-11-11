import {
  queryGeneric, mutationGeneric,
  type QueryBuilder, type MutationBuilder, type DataModelFromSchemaDefinition, type GenericMutationCtx,
} from "convex/server";
import { v } from "convex/values";
import schema from "./schema";

// Anonymous daily numbers for Globe by Abisto. Nothing about the player is stored:
// a phone sends "open" once a day and "game" after each finished game, without its id or name.
// Only the owner's username can read the numbers.

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
const query = queryGeneric as QueryBuilder<DataModel, "public">;
const mutation = mutationGeneric as MutationBuilder<DataModel, "public">;

const BOARD = /^(?:(?:flags|capitals|cities)_(?:easy|pro)|countries|twist)$/;
const PID = /^[a-z0-9]{20,40}$/;
const OWNERS = ["abisto26", "abisto"]; // usernames (lowercase) that can see the numbers

// days follow Morocco time (UTC+1)
export const dayOf = (ms: number) => new Date(ms + 60 * 60 * 1000).toISOString().slice(0, 10);

export async function bump(ctx: GenericMutationCtx<DataModel>, add: { players?: number; named?: number; games?: number; newUsers?: number; board?: string }) {
  const day = dayOf(Date.now());
  const row = await ctx.db.query("daily").withIndex("by_day", q => q.eq("day", day)).unique();
  const byGame = { ...(row?.byGame ?? {}) };
  if (add.board) byGame[add.board] = (byGame[add.board] ?? 0) + 1;
  const next = {
    players: (row?.players ?? 0) + (add.players ?? 0),
    named: (row?.named ?? 0) + (add.named ?? 0),
    games: (row?.games ?? 0) + (add.games ?? 0),
    newUsers: (row?.newUsers ?? 0) + (add.newUsers ?? 0),
    byGame,
  };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("daily", { day, ...next });
}

/** "open": first visit of the day on this phone. "game": a game was finished on that board. */
export const ping = mutation({
  args: { kind: v.union(v.literal("open"), v.literal("game")), named: v.optional(v.boolean()), board: v.optional(v.string()) },
  handler: async (ctx, { kind, named, board }) => {
    if (kind === "open") await bump(ctx, { players: 1, named: named ? 1 : 0 });
    else if (board && BOARD.test(board)) await bump(ctx, { games: 1, board });
    return null;
  },
});

/** The last 30 days, for the owner only. */
export const daily = query({
  args: { pid: v.string() },
  handler: async (ctx, { pid }) => {
    if (!PID.test(pid)) return null;
    const me = await ctx.db.query("users").withIndex("by_pid", q => q.eq("pid", pid)).unique();
    if (!me || !OWNERS.includes(me.key)) return null;
    const days = await ctx.db.query("daily").withIndex("by_day").order("desc").take(30);
    const users = (await ctx.db.query("users").collect()).length;
    return { today: dayOf(Date.now()), users, days: days.map(d => ({ day: d.day, players: d.players, named: d.named, games: d.games, newUsers: d.newUsers, byGame: d.byGame })) };
  },
});
