import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const dbDir = path.dirname(config.databasePath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: Database.Database = new Database(config.databasePath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      stripe_customer_id TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      stripe_product_id TEXT UNIQUE,
      stripe_price_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      amount INTEGER NOT NULL, -- in cents
      currency TEXT NOT NULL DEFAULT 'usd',
      interval TEXT NOT NULL DEFAULT 'month', -- month, year, one_time
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      livemode INTEGER NOT NULL DEFAULT 0,
      api_version TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received', -- received, processed, failed, skipped
      error_message TEXT,
      processed_at DATETIME,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_stripe_events_event_id ON stripe_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_stripe_events_status ON stripe_events(status);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      stripe_subscription_id TEXT UNIQUE NOT NULL,
      stripe_customer_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      status TEXT NOT NULL, -- active, past_due, canceled, incomplete, trialing
      current_period_start DATETIME,
      current_period_end DATETIME,
      cancel_at_period_end INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      stripe_payment_intent_id TEXT,
      stripe_charge_id TEXT,
      stripe_invoice_id TEXT,
      amount INTEGER NOT NULL, -- in cents
      fee INTEGER DEFAULT 0,
      net_amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      status TEXT NOT NULL, -- succeeded, pending, failed, refunded
      payment_method_type TEXT,
      receipt_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_payment_intent ON transactions(stripe_payment_intent_id);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      transaction_id TEXT,
      entry_type TEXT NOT NULL, -- payment, fee, refund, payout, adjustment
      account TEXT NOT NULL, -- e.g. stripe_clearing, revenue, stripe_fees, accounts_receivable, bank
      debit INTEGER NOT NULL DEFAULT 0, -- cents
      credit INTEGER NOT NULL DEFAULT 0, -- cents
      currency TEXT NOT NULL DEFAULT 'usd',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_transaction ON ledger_entries(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account);

    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      stripe_payment_method_id TEXT UNIQUE NOT NULL,
      brand TEXT NOT NULL,
      last4 TEXT NOT NULL,
      exp_month INTEGER NOT NULL,
      exp_year INTEGER NOT NULL,
      cardholder_name TEXT,
      is_default INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id);
  `);

  // Seed default sample tiers / products if empty
  const count = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
  if (count.count === 0) {
    const insertProduct = db.prepare(`
      INSERT INTO products (id, stripe_product_id, stripe_price_id, name, description, amount, currency, interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertProduct.run(
      'prod_starter',
      'prod_mock_starter_001',
      'price_mock_starter_19',
      'Starter Tier',
      'Essential features for small teams and individual creators',
      1900,
      'usd',
      'month'
    );

    insertProduct.run(
      'prod_pro',
      'prod_mock_pro_002',
      'price_mock_pro_49',
      'Pro Tier',
      'Advanced automation, unlimited team members, and priority support',
      4900,
      'usd',
      'month'
    );

    insertProduct.run(
      'prod_enterprise',
      'prod_mock_enterprise_003',
      'price_mock_enterprise_199',
      'Enterprise Tier',
      'Custom integrations, dedicated SLA, audit logging, and ERP sync',
      19900,
      'usd',
      'month'
    );
  }

  // Seed default demo user if empty
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    db.prepare(`
      INSERT INTO users (id, email, name, stripe_customer_id)
      VALUES (?, ?, ?, ?)
    `).run(
      'usr_demo_001',
      'demo.developer@example.com',
      'Alex Mercer',
      'cus_mock_alex_001'
    );
  }
}
