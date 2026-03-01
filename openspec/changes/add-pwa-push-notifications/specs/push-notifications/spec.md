## ADDED Requirements

### Requirement: Push Subscription Storage
The system SHALL store Web Push subscriptions in a `push_subscriptions` Convex table. Each subscription record SHALL contain the user identifier (Clerk ID or guest session ID), the push endpoint URL, encryption keys (`p256dh` and `auth`), and a creation timestamp. The table SHALL support multiple subscriptions per user (one per device) and SHALL be indexed by user ID.

#### Scenario: Subscription saved for authenticated user
- **WHEN** an authenticated user subscribes to push notifications
- **THEN** a record is created in `push_subscriptions` with their Clerk user ID, the push endpoint, and encryption keys

#### Scenario: Subscription saved for guest user
- **WHEN** a guest user subscribes to push notifications
- **THEN** a record is created in `push_subscriptions` with their guest session ID as the user identifier

#### Scenario: Multiple devices per user
- **WHEN** the same user subscribes from two different devices
- **THEN** two separate subscription records exist for that user ID, each with a unique endpoint

#### Scenario: Subscription removed on unsubscribe
- **WHEN** a user unsubscribes from push notifications
- **THEN** the corresponding subscription record is deleted from `push_subscriptions`

### Requirement: VAPID Key Configuration
The system SHALL use VAPID (Voluntary Application Server Identification) keys for Web Push authentication. The public key SHALL be available as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client-accessible) and the private key as `VAPID_PRIVATE_KEY` (server-only). Both SHALL be documented in `.env.example`.

#### Scenario: VAPID keys configured
- **WHEN** the server starts with valid `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` environment variables
- **THEN** the `web-push` library is configured with these keys and can send push notifications

#### Scenario: Missing VAPID keys graceful fallback
- **WHEN** VAPID environment variables are not set
- **THEN** push notification sending is silently skipped (no errors thrown), and the client-side subscription UI is hidden

### Requirement: Push Notification on Chat Completion
The system SHALL send a Web Push notification when a chat stream completes (in the `onFinish` callback of `app/api/chat/route.ts`). The notification SHALL include the thread ID for deep linking. The push send SHALL be non-blocking (fire-and-forget) and SHALL NOT delay or break the chat response.

#### Scenario: Notification sent on stream completion
- **WHEN** a chat stream completes via `onFinish` and the user has an active push subscription
- **THEN** a push notification is sent to all of the user's subscribed devices with a Hebrew message indicating the answer is ready

#### Scenario: No notification if no subscription
- **WHEN** a chat stream completes but the user has no push subscriptions in Convex
- **THEN** no push notification is sent and no error occurs

#### Scenario: Push send failure does not break chat
- **WHEN** `web-push.sendNotification()` throws an error (e.g., expired endpoint)
- **THEN** the error is logged but the chat response is not affected

#### Scenario: Stale subscription cleanup
- **WHEN** `web-push.sendNotification()` returns a 410 Gone status
- **THEN** the stale subscription is automatically deleted from the `push_subscriptions` table

### Requirement: Smart Notification Suppression
The service worker SHALL check whether the user has a focused browser window on the same origin before showing a notification. If a focused window exists, the notification SHALL be suppressed. Notifications SHALL use `tag: "chat-{threadId}"` to prevent duplicate notifications for the same thread.

#### Scenario: Notification suppressed when tab is focused
- **WHEN** a push event arrives and the user has a focused window on the app
- **THEN** no notification is displayed

#### Scenario: Notification shown when tab is not focused
- **WHEN** a push event arrives and no focused window exists on the app origin
- **THEN** a notification is displayed with the chat response message

#### Scenario: Duplicate notifications replaced via tag
- **WHEN** two push events arrive for the same thread ID before the user interacts
- **THEN** only the latest notification is shown (the earlier one is replaced)

### Requirement: Notification Deep Linking
When a user clicks a push notification, the service worker SHALL open or focus the app at `/chat/{threadId}` corresponding to the thread that triggered the notification.

#### Scenario: Notification click opens chat thread
- **WHEN** the user clicks a push notification with thread data
- **THEN** the browser opens or focuses a window/tab at `/chat/{threadId}`

#### Scenario: Notification click focuses existing tab
- **WHEN** the user clicks a notification and an existing tab is open on the app
- **THEN** that tab is focused and navigated to the correct thread URL instead of opening a new tab

### Requirement: Client-Side Push Subscription Management
The system SHALL provide a `usePushSubscription` React hook that handles service worker registration, push subscription creation/removal, and persistence to Convex. The hook SHALL expose the current subscription state, a `subscribe` function, and an `unsubscribe` function.

#### Scenario: Hook provides subscription state
- **WHEN** the hook is used in a component
- **THEN** it returns `{ isSupported, isSubscribed, subscribe, unsubscribe }` where `isSupported` reflects browser capability and `isSubscribed` reflects current subscription status

#### Scenario: Subscribe creates push subscription
- **WHEN** `subscribe()` is called
- **THEN** the browser prompts for notification permission (if not already granted), creates a `PushSubscription` via `PushManager`, and saves it to Convex

### Requirement: Notification Permission Prompt
The system SHALL display a contextual, dismissible Hebrew-language prompt encouraging users to enable notifications. The prompt SHALL appear after the user sends their first message (not on initial page load). Dismissal SHALL be persisted to `localStorage` to prevent re-showing.

#### Scenario: Prompt shown after first message
- **WHEN** the user sends their first chat message and has not dismissed the prompt
- **THEN** a notification prompt banner appears below the chat input in Hebrew

#### Scenario: Prompt not shown on first visit
- **WHEN** the user visits the app for the first time without sending a message
- **THEN** no notification prompt is displayed

#### Scenario: Prompt dismissal persisted
- **WHEN** the user dismisses the notification prompt
- **THEN** the dismissal is saved to `localStorage` and the prompt is not shown again
