# External System for Stripe Integration (Stripe Bridge)

A production-grade external backend and operations portal designed to integrate enterprise systems, databases, and billing workflows with Stripe.

---

## 🌟 Key Features

1. **Zero Data Loss Webhook Ingestion Pipeline**:
   - Cryptographic HMAC-SHA256 signature verification (`stripe-signature`) with raw request body preservation.
   - Built-in event deduplication and strict **idempotency guarantees**.
   - Full audit event logging with one-click **event replay** capability.

2. **Customer & Subscription State Synchronization**:
   - Maps internal users to Stripe Customer IDs (`cus_...`).
   - Reconciles subscription lifecycle events (`customer.subscription.created`, `updated`, `deleted`).
   - Dynamic tier management (Starter, Pro, Enterprise).

3. **Double-Entry Financial Ledger & ERP Reconciliation**:
   - Automated double-entry bookkeeping for every transaction, fee, refund, and payout.
   - Real-time balance sheet (`stripe_clearing`, `subscription_revenue`, `stripe_fees_expense`, `refund_allowance`, `bank_operating_account`).
   - Invariant: `Total Debits == Total Credits` guaranteed.

4. **Built-in Interactive Operations Portal & Simulator**:
   - Modern web dashboard to monitor live webhook traffic, inspect raw JSON payloads, inspect subscription statuses, and manage checkout sessions.
   - Integrated **Stripe Webhook Event Simulator** allowing full offline/sandbox testing without requiring live Stripe credentials.

5. **Stripe CLI Forwarding Ready**:
   - Ready to bind directly with the official Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks`).

---

## 🏗️ Architecture

```
                                  STRIPE CLOUD
        [Stripe Checkout / Elements]           [Webhook Dispatcher]
                    │                                    │
                    │ (Redirect)                         │ (Signed HTTP POST)
                    ▼                                    ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                 EXTERNAL SYSTEM (THIS SERVER)               │
       │                                                             │
       │   POST /api/webhooks  ──► HMAC-SHA256 Signature Validator   │
       │                                     │                       │
       │                                     ▼                       │
       │                          Idempotency Check & Log            │
       │                                     │                       │
       │            ┌────────────────────────┼────────────────────┐  │
       │            ▼                        ▼                    ▼  │
       │    Subscription Sync         Checkout Sync         Ledger   │
       │    (Tier status,            (Map customer,       (Post debits│
       │     period timestamps)       assign user)         & credits)│
       │            │                        │                    │  │
       │            └────────────────────────┼────────────────────┘  │
       │                                     ▼                       │
       │                        SQLite ACID Store (WAL Mode)         │
       └─────────────────────────────────────┬───────────────────────┘
                                             │
                                             ▼
                             OPERATIONS & DEV PORTAL (UI)
                 (Live Event Stream, Replay, Trial Balance, Simulator)
```

---

## 🚀 Quickstart

### 1. Installation

```bash
# Clone or navigate to the directory
cd c:\Users\USER\OneDrive\Desktop\stripe

# Install dependencies
npm install
```

### 2. Configuration (`.env`)

Configure your `.env` file (copied from `.env.example`):

```ini
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:3000
DATABASE_PATH=./data/stripe_system.db

# Optional: Add your Stripe Test Keys when ready
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Enables offline testing simulator
SIMULATOR_ENABLED=true
```

### 3. Start the Server

```bash
# Development mode with live reload
npm run dev

# Or production build & start
npm run build
npm start
```

Open your browser to:
👉 **`http://localhost:3000`** to view the **Operations Portal & Simulator**.

---

## 🧪 Automated Testing

Run the full end-to-end unit and integration test suite:

```bash
npm test
```

Verified test coverage:
- ✅ HMAC-SHA256 Signature Verification (Positive & Tampered payload tests)
- ✅ Webhook Ingestion Idempotency & Deduplication
- ✅ Subscription Lifecycle State Machine (`created` ➔ `updated` ➔ `canceled`)
- ✅ Double-Entry Accounting Balancing (`Debits == Credits`)

---

## 📡 API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/webhooks` | Stripe webhook receiver (requires raw body + `stripe-signature`) |
| `POST` | `/api/checkout/create-session` | Creates a Stripe Checkout Session for a user |
| `POST` | `/api/portal/create-session` | Creates a Stripe Customer Billing Portal session |
| `GET`  | `/api/events` | Lists audited Stripe webhook events |
| `POST` | `/api/events/:id/replay` | Replays a stored webhook through the processing engine |
| `GET`  | `/api/subscriptions` | Lists synchronized customer subscriptions |
| `GET`  | `/api/users` | Lists local users and their mapped Stripe customer IDs |
| `GET`  | `/api/products` | Lists active subscription products & pricing |
| `GET`  | `/api/ledger/balances` | Returns trial balance sheet across all double-entry accounts |
| `GET`  | `/api/ledger/entries` | Returns chronological journal entries |
| `POST` | `/api/simulator/trigger-event` | Generates and processes simulated Stripe lifecycle events |
| `GET`  | `/api/health` | Healthcheck and Stripe connection mode status |

---

## 🔌 Connecting to Stripe CLI (Live Forwarding)

To forward real events from your Stripe account to this external system:

```bash
# 1. Login to Stripe CLI
stripe login

# 2. Forward events to local endpoint
stripe listen --forward-to localhost:3000/api/webhooks

# 3. Trigger test events in a separate terminal
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger invoice.paid
```
