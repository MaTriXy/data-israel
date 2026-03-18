import { mutation } from './_generated/server';
import { v } from 'convex/values';

/**
 * Submit a new feedback entry.
 */
export const submit = mutation({
    args: {
        name: v.string(),
        email: v.string(),
        title: v.string(),
        description: v.string(),
    },
    handler: async (ctx, args) => {
        const id = await ctx.db.insert('feedback', {
            ...args,
            createdAt: Date.now(),
        });
        return id;
    },
});
