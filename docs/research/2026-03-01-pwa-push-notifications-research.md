# PWA + Push Notifications Research

**Date:** 2026-03-01
**Status:** Research complete

## 1. PWA Feasibility — YES, Fully Supported

### Current State
The project has **zero PWA configuration** — no manifest, no service worker, no PWA packages, no PWA meta tags. This is a greenfield PWA implementation.

### What's Needed (Minimal PWA)

| Component | File | Purpose |
|-----------|------|---------|
| Web App Manifest | `app/manifest.ts` | App name, icons, display mode, theme color |
| Service Worker | `public/sw.js` | Push notifications, (optional) offline caching |
| Icons | `public/icon-192x192.png`, `public/icon-512x512.png` | Home screen icons |
| Layout metadata | Update `app/layout.tsx` | `theme-color` meta tag |

### Next.js 16 Built-in Support
- Next.js 16.1.6 has **native PWA support** via App Router (no external library needed for basic installability)
- `app/manifest.ts` is a built-in file convention — Next.js auto-generates the manifest route
- For offline support/caching: use `@serwist/next` (successor to `next-pwa`, Turbopack-compatible)
- `next-pwa` is **abandoned** and requires webpack — NOT recommended

### Installability Requirements
1. Valid web app manifest with `display: "standalone"` + icons
2. Served over HTTPS (already using Vercel)
3. Service worker registered
4. Browser auto-shows install prompt (Chrome/Edge/Samsung) or user adds manually (Safari/iOS)

### iOS Considerations
- iOS 16.4+ supports PWA push notifications (home screen installed apps only)
- Safari on iOS does NOT show auto-install prompts — users must use "Add to Home Screen" from share menu
- Need `apple-touch-icon` and `apple-mobile-web-app-capable` meta tags

## 2. Push Notifications — YES, Feasible via `onFinish` Hook

### Architecture Overview

```
User sends message → POST /api/chat → handleChatStream starts
    ↓
Stream completes → onFinish callback fires
    ↓
onFinish: {
  1. Save context/billing to Convex (existing)
  2. Clear activeStreamId (existing)
  3. NEW: Send push notification via web-push
}
    ↓
web-push.sendNotification(subscription, payload)
    ↓
Service Worker receives push event → self.registration.showNotification()
    ↓
User sees notification on phone (even if app is in background/closed)
```

### Hook Point: `onFinish` in `app/api/chat/route.ts` (line 300)

The `onFinish` callback already fires when the stream completes. It currently:
- Saves context window snapshot to Convex
- Saves billing record to Convex
- Clears the resumable stream `activeStreamId`

**Adding push notification here is the natural extension** — just add a `web-push.sendNotification()` call after the existing logic.

### Condition for Sending Notifications
Only send when the user is NOT actively viewing the chat:
- Option A: Client sends a `visibility` header or param (document.hidden)
- Option B: Always send, let the service worker check if page is focused
- Option C: Use the Notifications API `tag` to auto-replace duplicate notifications

**Recommended: Option B** — service worker checks `clients.matchAll()` and skips if a focused window exists on the same URL.

### Push Subscription Storage
Store subscriptions in **Convex** (already the persistent store):

```
Table: pushSubscriptions
- userId: string (Clerk user ID or guest session ID)
- endpoint: string (push service URL)
- keys: { p256dh: string, auth: string }
- createdAt: number
```

### VAPID Keys
- Generate with `web-push generate-vapid-keys`
- Store in `.env`: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`

### Dependencies
- `web-push` — Node.js library for sending Web Push notifications (server-side)
- No client-side library needed (native `PushManager` API)

## 3. Connection with Resumable Streams

The resumable stream and push notification features are complementary:

| Scenario | Resumable Stream | Push Notification |
|----------|-----------------|-------------------|
| User on page, stream active | Streaming live | Not needed |
| User reloads page mid-stream | Resumes via GET | Not needed |
| User leaves page, stream completes | Stream data in Redis (10min) | **Sends push** |
| User returns after completion | Loads from Convex memory | Notification already shown |

The `onFinish` callback is the shared hook point — it already clears `activeStreamId` and is the right place to also trigger `web-push.sendNotification()`.

## 4. Implementation Plan (High-Level Phases)

### Phase 1: PWA Foundation
- Create `app/manifest.ts` (Hebrew RTL, standalone display, theme colors)
- Generate PWA icons (192x192, 512x512) from existing logo
- Create `public/sw.js` (basic push listener)
- Update `app/layout.tsx` with theme-color, apple-touch-icon meta tags

### Phase 2: Push Subscription Infrastructure
- Add `pushSubscriptions` table to Convex schema
- Create Convex mutations: `savePushSubscription`, `deletePushSubscription`, `getPushSubscriptions`
- Generate VAPID keys, add to `.env`
- Install `web-push` package

### Phase 3: Client-Side Push Subscription
- Create `hooks/use-push-subscription.ts` — register service worker, subscribe/unsubscribe
- Add notification permission prompt UI (Hebrew, RTL)
- Store subscription in Convex via mutation

### Phase 4: Server-Side Push Trigger
- In `onFinish` callback of `app/api/chat/route.ts`:
  - Fetch user's push subscriptions from Convex
  - Send notification with `web-push.sendNotification()`
  - Include thread ID in notification data for deep linking
- Service worker: `notificationclick` → open `/chat/{threadId}`

### Phase 5: Smart Notification Logic
- Service worker checks `clients.matchAll()` — skip if user has focused window
- Notification tag = threadId (auto-replace, don't spam)
- Rate limiting: max 1 notification per thread per minute

## 5. Browser Support

| Feature | Chrome | Safari | Firefox | Samsung |
|---------|--------|--------|---------|---------|
| PWA Install | Yes | iOS 16.4+ | Yes | Yes |
| Push Notifications | Yes | iOS 16.4+ (home screen) | Yes | Yes |
| Service Worker | Yes | Yes | Yes | Yes |
| Background Sync | Yes | No | No | Yes |

## Sources

- [Next.js PWA Guide (official)](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [AI SDK Resumable Streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams)
- [@serwist/next (Turbopack-compatible)](https://serwist.pages.dev/docs/next)
- [Web Push Notifications in Next.js](https://medium.com/@ameerezae/implementing-web-push-notifications-in-next-js-a-complete-guide-e21acd89492d)
- [Next.js 16 PWA Guide](https://www.buildwithmatija.com/blog/turn-nextjs-16-app-into-pwa)
- [LogRocket: Next.js 16 PWA with Offline Support](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)
