import { db } from './index';
import { v4 as uuidv4 } from 'uuid';

export const eventsRepo = {
  recordReceived(event: {
    id: string;
    type: string;
    livemode?: boolean;
    api_version?: string;
    payload: any;
  }) {
    const existing = db.prepare('SELECT id, status FROM stripe_events WHERE event_id = ?').get(event.id) as { id: string; status: string } | undefined;
    if (existing) {
      return { id: existing.id, isDuplicate: true, status: existing.status };
    }

    const internalId = 'evt_' + uuidv4();
    db.prepare(`
      INSERT INTO stripe_events (id, event_id, event_type, livemode, api_version, payload, status)
      VALUES (?, ?, ?, ?, ?, ?, 'received')
    `).run(
      internalId,
      event.id,
      event.type,
      event.livemode ? 1 : 0,
      event.api_version || null,
      typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload)
    );

    return { id: internalId, isDuplicate: false, status: 'received' };
  },

  markProcessed(eventId: string) {
    db.prepare(`
      UPDATE stripe_events 
      SET status = 'processed', processed_at = CURRENT_TIMESTAMP, error_message = NULL
      WHERE event_id = ?
    `).run(eventId);
  },

  markFailed(eventId: string, errorMessage: string) {
    db.prepare(`
      UPDATE stripe_events 
      SET status = 'failed', processed_at = CURRENT_TIMESTAMP, error_message = ?
      WHERE event_id = ?
    `).run(errorMessage, eventId);
  },

  isProcessed(eventId: string): boolean {
    const row = db.prepare('SELECT status FROM stripe_events WHERE event_id = ?').get(eventId) as { status: string } | undefined;
    return row?.status === 'processed';
  },

  listRecent(limit = 50) {
    return db.prepare(`
      SELECT id, event_id, event_type, livemode, status, error_message, processed_at, received_at, payload
      FROM stripe_events
      ORDER BY received_at DESC
      LIMIT ?
    `).all(limit).map((row: any) => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
  },

  getById(eventId: string) {
    const row = db.prepare('SELECT * FROM stripe_events WHERE event_id = ? OR id = ?').get(eventId, eventId) as any;
    if (!row) return null;
    return {
      ...row,
      payload: JSON.parse(row.payload)
    };
  }
};

export const usersRepo = {
  findById(id: string) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  },

  findByEmail(email: string) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
  },

  findByStripeCustomerId(stripeCustomerId: string) {
    return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(stripeCustomerId) as any;
  },

  createOrUpdateStripeCustomer(userId: string, stripeCustomerId: string) {
    db.prepare(`
      UPDATE users SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(stripeCustomerId, userId);
  },

  createUser(email: string, name: string, stripeCustomerId?: string) {
    const id = 'usr_' + uuidv4().substring(0, 8);
    db.prepare(`
      INSERT INTO users (id, email, name, stripe_customer_id)
      VALUES (?, ?, ?, ?)
    `).run(id, email, name, stripeCustomerId || null);
    return this.findById(id);
  },

  list() {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
  }
};

export const productsRepo = {
  list() {
    return db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY amount ASC').all() as any[];
  },

  findById(id: string) {
    return db.prepare('SELECT * FROM products WHERE id = ? OR stripe_price_id = ?').get(id, id) as any;
  }
};

export const subscriptionsRepo = {
  upsert(sub: {
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    userId?: string | null;
    planId: string;
    planName: string;
    status: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
  }) {
    const existing = db.prepare('SELECT id FROM subscriptions WHERE stripe_subscription_id = ?').get(sub.stripeSubscriptionId) as { id: string } | undefined;
    
    if (existing) {
      db.prepare(`
        UPDATE subscriptions
        SET status = ?, 
            plan_id = ?, 
            plan_name = ?,
            current_period_start = COALESCE(?, current_period_start),
            current_period_end = COALESCE(?, current_period_end),
            cancel_at_period_end = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE stripe_subscription_id = ?
      `).run(
        sub.status,
        sub.planId,
        sub.planName,
        sub.currentPeriodStart || null,
        sub.currentPeriodEnd || null,
        sub.cancelAtPeriodEnd ? 1 : 0,
        sub.stripeSubscriptionId
      );
      return existing.id;
    } else {
      const id = 'sub_' + uuidv4();
      db.prepare(`
        INSERT INTO subscriptions (
          id, user_id, stripe_subscription_id, stripe_customer_id, plan_id, plan_name,
          status, current_period_start, current_period_end, cancel_at_period_end
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        sub.userId || null,
        sub.stripeSubscriptionId,
        sub.stripeCustomerId,
        sub.planId,
        sub.planName,
        sub.status,
        sub.currentPeriodStart || null,
        sub.currentPeriodEnd || null,
        sub.cancelAtPeriodEnd ? 1 : 0
      );
      return id;
    }
  },

  findByCustomerId(customerId: string) {
    return db.prepare('SELECT * FROM subscriptions WHERE stripe_customer_id = ? ORDER BY created_at DESC').all(customerId) as any[];
  },

  listRecent(limit = 20) {
    return db.prepare(`
      SELECT s.*, u.email as user_email, u.name as user_name
      FROM subscriptions s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.updated_at DESC
      LIMIT ?
    `).all(limit) as any[];
  }
};

export const transactionsRepo = {
  record(tx: {
    userId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    stripeInvoiceId?: string | null;
    amount: number;
    fee?: number;
    netAmount?: number;
    currency?: string;
    status: string;
    paymentMethodType?: string;
    receiptUrl?: string | null;
  }) {
    const id = 'txn_' + uuidv4();
    const fee = tx.fee || Math.round(tx.amount * 0.029 + 30); // Standard Stripe 2.9% + 30c estimate if not provided
    const net = tx.netAmount !== undefined ? tx.netAmount : (tx.amount - fee);
    const currency = tx.currency || 'usd';

    db.prepare(`
      INSERT INTO transactions (
        id, user_id, stripe_payment_intent_id, stripe_charge_id, stripe_invoice_id,
        amount, fee, net_amount, currency, status, payment_method_type, receipt_url
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tx.userId || null,
      tx.stripePaymentIntentId || null,
      tx.stripeChargeId || null,
      tx.stripeInvoiceId || null,
      tx.amount,
      fee,
      net,
      currency,
      tx.status,
      tx.paymentMethodType || 'card',
      tx.receiptUrl || null
    );

    return { id, amount: tx.amount, fee, netAmount: net, currency };
  },

  listRecent(limit = 50) {
    return db.prepare(`
      SELECT t.*, u.email as user_email
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC
      LIMIT ?
    `).all(limit) as any[];
  }
};

export const ledgerRepo = {
  recordDoubleEntry(entries: Array<{
    transactionId?: string | null;
    entryType: string;
    account: string;
    debit: number;
    credit: number;
    currency: string;
    description: string;
  }>) {
    const insert = db.prepare(`
      INSERT INTO ledger_entries (id, transaction_id, entry_type, account, debit, credit, currency, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((rows: typeof entries) => {
      for (const row of rows) {
        insert.run(
          'ledg_' + uuidv4(),
          row.transactionId || null,
          row.entryType,
          row.account,
          row.debit,
          row.credit,
          row.currency,
          row.description
        );
      }
    });

    transaction(entries);
  },

  getAccountBalances() {
    return db.prepare(`
      SELECT 
        account,
        currency,
        SUM(debit) as total_debit,
        SUM(credit) as total_credit,
        (SUM(debit) - SUM(credit)) as net_balance
      FROM ledger_entries
      GROUP BY account, currency
    `).all() as any[];
  },

  listRecentEntries(limit = 50) {
    return db.prepare(`
      SELECT * FROM ledger_entries ORDER BY created_at DESC LIMIT ?
    `).all(limit) as any[];
  }
};

export const paymentMethodsRepo = {
  create(method: {
    userId?: string | null;
    paymentMethodId: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    cardholderName?: string | null;
    isDefault?: boolean;
  }) {
    const id = 'pm_rec_' + uuidv4();
    db.prepare(`
      INSERT INTO payment_methods (
        id, user_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, cardholder_name, is_default
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      method.userId || null,
      method.paymentMethodId,
      method.brand,
      method.last4,
      method.expMonth,
      method.expYear,
      method.cardholderName || null,
      method.isDefault !== false ? 1 : 0
    );
    return id;
  },

  findByUserId(userId: string) {
    return db.prepare('SELECT * FROM payment_methods WHERE user_id = ? ORDER BY created_at DESC').all(userId) as any[];
  },

  list(limit = 50) {
    return db.prepare(`
      SELECT pm.*, u.email as user_email, u.name as user_name
      FROM payment_methods pm
      LEFT JOIN users u ON pm.user_id = u.id
      ORDER BY pm.created_at DESC
      LIMIT ?
    `).all(limit) as any[];
  }
};

