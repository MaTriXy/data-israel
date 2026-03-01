## 1. PWA Foundation

- [x] 1.1 Create `app/manifest.ts` with Hebrew metadata (`name: "דאטה ישראל"`, `short_name: "דאטה ישראל"`, `display: "standalone"`, `dir: "rtl"`, `lang: "he"`, `start_url: "/"`, `theme_color`, `background_color`, icon references)
- [ ] 1.2 Generate PWA icons from existing logo: `public/icon-192x192.png` and `public/icon-512x512.png`
- [x] 1.3 Create `public/sw.js` service worker with `push` event listener (show notification with Hebrew text, vibrate, icon, tag), `notificationclick` listener (open/focus `/chat/{threadId}`), and smart suppression via `clients.matchAll()`
- [x] 1.4 Update `app/layout.tsx` metadata to include `themeColor` via `generateViewport()` (Next.js 16 requires viewport export, not metadata)
- [x] 1.5 Add security headers for `/sw.js` in `next.config.ts` (`Cache-Control: no-cache`, `Content-Type: application/javascript`, `Content-Security-Policy: default-src 'self'`)
- [x] 1.6 Verify: `npm run build && npm run lint && npm run vibecheck` — manifest route accessible, icons served, no TS errors

## 2. Push Subscription Infrastructure (Convex + VAPID)

- [x] 2.1 Add `push_subscriptions` table to `convex/schema.ts` with fields: `userId` (string), `endpoint` (string), `keys` (object: `p256dh` string, `auth` string), `createdAt` (number) — indexed by `by_user_id` on `userId`
- [x] 2.2 Create `convex/pushSubscriptions.ts` with mutations: `savePushSubscription` (upsert by userId + endpoint), `deletePushSubscription` (by userId + endpoint), and query: `getPushSubscriptionsByUser` (by userId)
- [x] 2.3 Generate VAPID keys (`npx web-push generate-vapid-keys`), add `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to `.env.example`
- [x] 2.4 Install `web-push` package: `pnpm add web-push` and `pnpm add -D @types/web-push`
- [x] 2.5 Create `lib/push/send-notification.ts` — wrapper that configures `web-push.setVapidDetails()`, exports `sendPushToUser(userId, payload)` which fetches subscriptions from Convex and fans out `sendNotification()` to each; catches 410 Gone and deletes stale subscriptions; graceful no-op if VAPID keys missing
- [x] 2.6 Verify: `npm run build && npm run lint && npm run vibecheck` — Convex schema deploys, no TS errors

## 3. Server-Side Push Trigger

- [x] 3.1 In `app/api/chat/route.ts` `onFinish` callback, add push notification trigger: call `sendPushToUser(userId, { threadId, title, body })` as fire-and-forget (`void sendPushToUser(...)`) after existing billing/context logic
- [x] 3.2 The notification payload SHALL include `threadId` (for deep linking), a Hebrew title (e.g., "התשובה מוכנה"), and a Hebrew body summarizing that the answer is available
- [x] 3.3 Verify: `npm run build && npm run lint && npm run vibecheck` — no TS errors, onFinish still works correctly

## 4. Client-Side Push Subscription

- [x] 4.1 Create `hooks/use-push-subscription.ts` — registers service worker on mount, checks existing subscription via `pushManager.getSubscription()`, exposes `{ isSupported, isSubscribed, subscribe, unsubscribe }`. `subscribe()` requests notification permission, creates `PushSubscription` with VAPID public key, saves to Convex. `unsubscribe()` calls `subscription.unsubscribe()` + deletes from Convex
- [x] 4.2 Create `components/chat/NotificationPrompt.tsx` — Hebrew RTL banner below chat input. Shown after first message sent AND not previously dismissed (check `localStorage` key `notification-prompt-dismissed`). Shows "enable notifications" button (calls `subscribe()`) and dismiss button (sets localStorage). Hidden if `!isSupported` or `isSubscribed`
- [x] 4.3 Integrate `NotificationPrompt` into `ChatThread.tsx` — render conditionally after first user message
- [x] 4.4 Verify: `npm run build && npm run lint && npm run vibecheck` — component renders, subscription flow works, no TS errors

## 5. End-to-End Verification

- [ ] 5.1 Manual test: Install app on Android Chrome — verify home screen icon, standalone mode, correct Hebrew name
- [ ] 5.2 Manual test: Install app on iOS Safari — verify "Add to Home Screen" works, standalone display
- [ ] 5.3 Manual test: Subscribe to push notifications, send a chat message, switch tabs, verify notification arrives when response completes
- [ ] 5.4 Manual test: Click notification — verify deep link to correct `/chat/{threadId}`
- [ ] 5.5 Manual test: Keep tab focused, send message — verify NO notification appears (smart suppression)
- [ ] 5.6 Manual test: Unsubscribe — verify no further notifications sent
- [ ] 5.7 Run full verification suite: `npm run build && npm run lint && npm run vibecheck && tsc`
