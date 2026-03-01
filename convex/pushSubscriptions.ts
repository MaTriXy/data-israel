/**
 * Convex mutations and queries for Web Push subscription management.
 *
 * Subscriptions are keyed by (userId, endpoint) — each device/browser generates
 * a unique endpoint when calling `pushManager.subscribe()`. A single user may
 * have multiple active subscriptions (one per device/browser).
 *
 * Stale subscriptions (HTTP 410 Gone from web-push) are cleaned up via
 * `deleteByEndpoint`, called server-side from `lib/push/send-notification.ts`.
 */

import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Upserts a push subscription for a user.
 *
 * If a subscription with the same userId + endpoint already exists, updates its
 * keys and refreshes createdAt. Otherwise inserts a new record.
 *
 * @param userId   - Clerk user ID or guest session ID
 * @param endpoint - PushSubscription endpoint URL (unique per browser/device)
 * @param keys     - ECDH public key and auth secret from the PushSubscription
 */
export const savePushSubscription = mutation({
    args: {
        userId: v.string(),
        endpoint: v.string(),
        keys: v.object({
            p256dh: v.string(),
            auth: v.string(),
        }),
    },
    handler: async (ctx, { userId, endpoint, keys }) => {
        const existing = await ctx.db
            .query('push_subscriptions')
            .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
            .unique();

        if (existing) {
            await ctx.db.patch(existing._id, {
                userId,
                keys,
                createdAt: Date.now(),
            });
            return existing._id;
        }

        return ctx.db.insert('push_subscriptions', {
            userId,
            endpoint,
            keys,
            createdAt: Date.now(),
        });
    },
});

/**
 * Deletes a push subscription identified by userId + endpoint.
 *
 * Called when a user explicitly unsubscribes from push notifications on a device.
 *
 * @param userId   - Clerk user ID or guest session ID
 * @param endpoint - PushSubscription endpoint URL to remove
 */
export const deletePushSubscription = mutation({
    args: {
        userId: v.string(),
        endpoint: v.string(),
    },
    handler: async (ctx, { userId, endpoint }) => {
        const existing = await ctx.db
            .query('push_subscriptions')
            .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
            .unique();

        if (!existing || existing.userId !== userId) {
            return;
        }

        await ctx.db.delete(existing._id);
    },
});

/**
 * Deletes a push subscription by endpoint only.
 *
 * Used for stale subscription cleanup when web-push receives HTTP 410 Gone,
 * indicating the browser has invalidated the subscription. In this case we only
 * know the endpoint, not the userId.
 *
 * @param endpoint - PushSubscription endpoint URL that returned 410
 */
export const deleteByEndpoint = mutation({
    args: {
        endpoint: v.string(),
    },
    handler: async (ctx, { endpoint }) => {
        const existing = await ctx.db
            .query('push_subscriptions')
            .withIndex('by_endpoint', (q) => q.eq('endpoint', endpoint))
            .unique();

        if (!existing) {
            return;
        }

        await ctx.db.delete(existing._id);
    },
});

/**
 * Returns all push subscriptions for a given user.
 *
 * Used server-side by `lib/push/send-notification.ts` to fan out push
 * notifications to every device/browser a user is subscribed on.
 *
 * @param userId - Clerk user ID or guest session ID
 * @returns Array of subscription records (endpoint + keys)
 */
export const getPushSubscriptionsByUser = query({
    args: {
        userId: v.string(),
    },
    handler: async (ctx, { userId }) => {
        return ctx.db
            .query('push_subscriptions')
            .withIndex('by_user_id', (q) => q.eq('userId', userId))
            .collect();
    },
});
