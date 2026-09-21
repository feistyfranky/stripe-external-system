import assert from 'assert';
import crypto from 'crypto';
import Stripe from 'stripe';
import { stripeService } from '../src/services/stripe';
import { webhookProcessor } from '../src/services/webhook';
import { initDatabase, db } from '../src/db';
import { eventsRepo, subscriptionsRepo, ledgerRepo, transactionsRepo } from '../src/db/repositories';
import { config } from '../src/config';

console.log('🧪 Starting External System for Stripe Test Suite...\n');

// 1. Initialize DB
initDatabase();

// Clean tables before running test suite to ensure clean, isolated state
db.exec('DELETE FROM ledger_entries; DELETE FROM transactions; DELETE FROM subscriptions; DELETE FROM stripe_events;');

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  // --- TEST 1: Webhook Signature Verification ---
  await test('Signature Verification with HMAC-SHA256', () => {
    const testSecret = 'whsec_test_secret_for_unit_tests';
    const testPayload = JSON.stringify({
      id: 'evt_test_sig_001',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_001', amount: 2500 } },
    });

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${testPayload}`;
    const validSignature = crypto.createHmac('sha256', testSecret).update(signedPayload, 'utf8').digest('hex');
    const header = `t=${timestamp},v1=${validSignature}`;

    // Temporarily set secret
    const originalSecret = config.stripeWebhookSecret;
    config.stripeWebhookSecret = testSecret;

    try {
      const event = stripeService.verifyAndConstructWebhookEvent(testPayload, header);
      assert.strictEqual(event.id, 'evt_test_sig_001');
      assert.strictEqual(event.type, 'payment_intent.succeeded');

      // Invalid signature should fail
      const badHeader = `t=${timestamp},v1=invalid_tampered_signature_hex`;
      assert.throws(() => {
        stripeService.verifyAndConstructWebhookEvent(testPayload, badHeader);
      }, /Signature verification failed/);
    } finally {
      config.stripeWebhookSecret = originalSecret;
    }
  });

  // --- TEST 2: Idempotency & Deduplication ---
  await test('Webhook Ingestion Idempotency (Deduplication)', async () => {
    const uniqueEventId = 'evt_idempotent_' + Date.now();
    const mockEvent: Stripe.Event = {
      id: uniqueEventId,
      object: 'event',
      api_version: '2025-01-27.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_test_idempotent',
          object: 'checkout.session',
          customer: 'cus_idem_001',
          client_reference_id: 'usr_demo_001',
          mode: 'subscription',
        } as any,
      },
      livemode: false,
      pending_webhooks: 1,
      type: 'checkout.session.completed',
    };

    // First arrival: should process
    const firstResult = await webhookProcessor.processEvent(mockEvent);
    assert.strictEqual(firstResult.success, true);
    assert.strictEqual(firstResult.isDuplicate, false);
    assert.strictEqual(eventsRepo.isProcessed(uniqueEventId), true);

    // Second arrival (duplicate retry from Stripe): should detect duplicate
    const secondResult = await webhookProcessor.processEvent(mockEvent);
    assert.strictEqual(secondResult.success, true);
    assert.strictEqual(secondResult.isDuplicate, true);
    assert.match(secondResult.message || '', /idempotent/i);
  });

  // --- TEST 3: Subscription State Machine Sync ---
  await test('Subscription Lifecycle (Created -> Updated -> Canceled)', async () => {
    const subId = 'sub_test_lifecycle_' + Date.now();
    const customerId = 'cus_lifecycle_001';

    // 1. Created
    const createdEvent: Stripe.Event = {
      id: 'evt_sub_create_' + Date.now(),
      object: 'event',
      api_version: '2025-01-27.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subId,
          object: 'subscription',
          customer: customerId,
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702600000,
          items: {
            data: [{ price: { id: 'price_mock_pro_49', nickname: 'Pro Plan' } }],
          },
        } as any,
      },
      livemode: false,
      pending_webhooks: 1,
      type: 'customer.subscription.created',
    };

    await webhookProcessor.processEvent(createdEvent);

    const subs1 = subscriptionsRepo.findByCustomerId(customerId);
    assert.strictEqual(subs1.length, 1);
    assert.strictEqual(subs1[0].status, 'active');
    assert.strictEqual(subs1[0].plan_id, 'price_mock_pro_49');

    // 2. Canceled
    const canceledEvent: Stripe.Event = {
      id: 'evt_sub_cancel_' + Date.now(),
      object: 'event',
      api_version: '2025-01-27.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: subId,
          object: 'subscription',
          customer: customerId,
          status: 'canceled',
        } as any,
      },
      livemode: false,
      pending_webhooks: 1,
      type: 'customer.subscription.deleted',
    };

    await webhookProcessor.processEvent(canceledEvent);

    const subs2 = subscriptionsRepo.findByCustomerId(customerId);
    assert.strictEqual(subs2[0].status, 'canceled');
  });

  // --- TEST 4: Double-Entry Financial Ledger Balancing ---
  await test('Double-Entry Ledger Balancing (Debits = Credits)', async () => {
    const invoiceId = 'in_test_ledger_' + Date.now();
    const invoicePaidEvent: Stripe.Event = {
      id: 'evt_inv_paid_' + Date.now(),
      object: 'event',
      api_version: '2025-01-27.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: invoiceId,
          object: 'invoice',
          amount_paid: 10000, // $100.00
          currency: 'usd',
          customer: 'cus_ledger_001',
          number: 'INV-TEST-001',
          paid: true,
          status: 'paid',
          payment_intent: 'pi_test_inv_001',
        } as any,
      },
      livemode: false,
      pending_webhooks: 1,
      type: 'invoice.paid',
    };

    await webhookProcessor.processEvent(invoicePaidEvent);

    // Verify journal entries balance
    const entries = db.prepare(`
      SELECT SUM(debit) as total_debit, SUM(credit) as total_credit 
      FROM ledger_entries
    `).get() as { total_debit: number; total_credit: number };

    assert(entries.total_debit > 0, 'Debits should be greater than zero');
    assert.strictEqual(
      entries.total_debit,
      entries.total_credit,
      `Double entry ledger invariant violated: Debits (${entries.total_debit}) !== Credits (${entries.total_credit})`
    );
  });

  console.log(`\n-----------------------------------------------------`);
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log(`-----------------------------------------------------\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
