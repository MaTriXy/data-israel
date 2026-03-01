## Context

The app is a Next.js 16 streaming chat application deployed on Vercel (HTTPS). Users interact with AI agents that query Israeli open data APIs — responses can take 30-60 seconds for multi-tool chains. The app already uses Convex for persistent storage, Clerk for auth, and Redis/Upstash for resumable streams. There is no existing PWA configuration.

Key stakeholders:
- **Mobile users** who want an app-like experience and background notifications
- **Guest users** (no Clerk account) who still need push support
- **Existing streaming architecture** (`onFinish` callback) that must not be disrupted

## Goals / Non-Goals

**Goals:**
- Make the app installable on mobile home screens (Android + iOS)
- Send push notifications when a chat response completes and the user is not viewing the tab
- Support both authenticated (Clerk) and guest users for push subscriptions
- Minimal complexity — no offline caching, no background sync

**Non-Goals:**
- Offline support / service worker caching (out of scope; can be added later with `@serwist/next`)
- Marketing/promotional push notifications — only triggered by chat response completion
- Custom install prompt UI — rely on browser-native install prompts (more reliable cross-platform)
- Push notification preferences UI (e.g., mute per thread) — defer to future change

## Decisions

### 1. Manifest via `app/manifest.ts` (Next.js built-in)
- **Decision:** Use Next.js App Router's built-in `manifest.ts` file convention
- **Why:** Zero-config, auto-generates `/manifest.webmanifest` route, type-safe via `MetadataRoute.Manifest`
- **Alternative rejected:** Static `public/manifest.json` — loses type safety and dynamic capability

### 2. Service Worker as static `public/sw.js`
- **Decision:** Plain JS service worker in `public/sw.js`, manually registered from client code
- **Why:** Minimal footprint, no build tool dependency. The service worker only needs push event handling — no caching, no precaching
- **Alternative rejected:** `@serwist/next` — adds webpack requirement and complexity for features we don't need (offline caching). Can be adopted later if offline support is desired

### 3. Push subscriptions stored in Convex
- **Decision:** Store push subscriptions in a `push_subscriptions` Convex table keyed by `userId` (Clerk ID or guest session ID)
- **Why:** Convex is already the persistent store; avoids adding another database. Subscriptions need to survive server restarts
- **Alternative rejected:** Redis/Upstash — subscriptions are long-lived data, not ephemeral. Redis is for caching/streams

### 4. Push trigger in `onFinish` callback
- **Decision:** Send push notification from the existing `onFinish` callback in `app/api/chat/route.ts`
- **Why:** `onFinish` already fires when the stream completes and has access to `threadId` and `userId`. Natural extension point
- **Flow:** `onFinish` → fetch subscriptions from Convex → `web-push.sendNotification()` → service worker shows notification
- **Error handling:** Fire-and-forget (non-blocking). Push failure should never break the chat response

### 5. Smart notification suppression in service worker
- **Decision:** Service worker checks `clients.matchAll({ type: 'window', includeUncontrolled: true })` and skips notification if a focused client exists on the same origin
- **Why:** Prevents annoying notifications when user is actively looking at the chat
- **Notification tag:** Set to `chat-{threadId}` so multiple responses in the same thread don't stack

### 6. VAPID keys as environment variables
- **Decision:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client) + `VAPID_PRIVATE_KEY` (server)
- **Why:** Standard approach for Web Push. Public key is safe to expose (used by browser to verify subscription)

### 7. Notification prompt shown contextually
- **Decision:** Show notification permission prompt after the user sends their first message (not on page load)
- **Why:** Browsers increasingly block permission prompts shown too early. Asking after the user has engaged increases acceptance rates
- **UI:** Small Hebrew banner below the chat input, dismissible, persists dismissal to localStorage

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| iOS Safari requires "Add to Home Screen" for push | Mobile iOS users may miss feature | Show Hebrew instructions for iOS users |
| Push subscription can expire/become invalid | Notifications silently fail | Catch `410 Gone` from web-push and remove stale subscriptions from Convex |
| `onFinish` runs in serverless function — may hit timeout | Push not sent if function times out | Use `after()` from Next.js to run push in background after response is sent |
| Guest users have ephemeral sessions | Push subscription orphaned after session expires | Set TTL on guest subscriptions; clean up with Convex scheduled function |
| Multiple devices per user | Each device gets its own notification | Store multiple subscriptions per user; fan out `sendNotification` to all |

## Migration Plan

No migration needed — this is a new capability. Rollout:
1. Deploy manifest + icons + service worker → installability works immediately
2. Deploy push infrastructure (Convex table, VAPID keys, `web-push`) → subscriptions can be created
3. Deploy notification trigger in `onFinish` → notifications start flowing
4. Deploy notification prompt UI → users can opt in

All steps are backwards-compatible. No existing functionality is modified (only extended).

## Resolved Questions

1. **Icon design**: User will provide the two PNG icons (192x192 and 512x512). Place directly in `public/`.
2. **Notification sound**: Browser default. No custom sound.
3. **Guest push TTL**: 30 days. Convex scheduled function cleans up subscriptions older than 30 days for guest users (non-Clerk IDs).
