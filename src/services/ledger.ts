import { ledgerRepo, transactionsRepo } from '../db/repositories';

export const ledgerService = {
  recordSuccessfulPayment(params: {
    userId?: string | null;
    paymentIntentId: string;
    chargeId?: string;
    invoiceId?: string;
    amount: number; // in cents
    fee?: number;    // in cents
    currency: string;
    description: string;
    paymentMethod?: string;
    receiptUrl?: string;
  }) {
    const fee = params.fee !== undefined ? params.fee : Math.round(params.amount * 0.029 + 30);
    const net = params.amount - fee;

    // 1. Record the transaction in the transactions log
    const tx = transactionsRepo.record({
      userId: params.userId,
      stripePaymentIntentId: params.paymentIntentId,
      stripeChargeId: params.chargeId,
      stripeInvoiceId: params.invoiceId,
      amount: params.amount,
      fee,
      netAmount: net,
      currency: params.currency,
      status: 'succeeded',
      paymentMethodType: params.paymentMethod || 'card',
      receiptUrl: params.receiptUrl,
    });

    // 2. Post double-entry bookkeeping records:
    // Debit: stripe_clearing (net cash deposited in Stripe)
    // Debit: stripe_fees_expense (Stripe's processing fee)
    // Credit: subscription_revenue (gross revenue recognized)
    // Total Debits (net + fee) === Total Credits (amount)
    ledgerRepo.recordDoubleEntry([
      {
        transactionId: tx.id,
        entryType: 'cash_settlement',
        account: 'stripe_clearing',
        debit: net,
        credit: 0,
        currency: params.currency,
        description: `Net cash receivable in Stripe balance for ${params.description}`,
      },
      {
        transactionId: tx.id,
        entryType: 'fee_expense',
        account: 'stripe_fees_expense',
        debit: fee,
        credit: 0,
        currency: params.currency,
        description: `Stripe processing fee for ${params.paymentIntentId}`,
      },
      {
        transactionId: tx.id,
        entryType: 'revenue_recognized',
        account: 'subscription_revenue',
        debit: 0,
        credit: params.amount,
        currency: params.currency,
        description: `Gross revenue recognized for ${params.description} (Stripe PI: ${params.paymentIntentId})`,
      },
    ]);

    return tx;
  },

  recordRefund(params: {
    userId?: string | null;
    chargeId: string;
    amount: number;
    currency: string;
    reason?: string;
  }) {
    const tx = transactionsRepo.record({
      userId: params.userId,
      stripeChargeId: params.chargeId,
      amount: params.amount,
      fee: 0,
      netAmount: -params.amount,
      currency: params.currency,
      status: 'refunded',
      paymentMethodType: 'refund',
    });

    ledgerRepo.recordDoubleEntry([
      {
        transactionId: tx.id,
        entryType: 'refund_issued',
        account: 'refund_allowance',
        debit: params.amount,
        credit: 0,
        currency: params.currency,
        description: `Refund deduction for charge ${params.chargeId}: ${params.reason || 'Customer requested refund'}`,
      },
      {
        transactionId: tx.id,
        entryType: 'clearing_deduction',
        account: 'stripe_clearing',
        debit: 0,
        credit: params.amount,
        currency: params.currency,
        description: `Payout balance reduced for refund on charge ${params.chargeId}`,
      },
    ]);

    return tx;
  },

  recordPayout(params: {
    payoutId: string;
    amount: number;
    currency: string;
    bankName?: string;
  }) {
    ledgerRepo.recordDoubleEntry([
      {
        entryType: 'payout_transferred',
        account: 'bank_operating_account',
        debit: params.amount,
        credit: 0,
        currency: params.currency,
        description: `Stripe payout transfer ${params.payoutId} settled to bank (${params.bankName || 'Primary Operating Account'})`,
      },
      {
        entryType: 'payout_cleared',
        account: 'stripe_clearing',
        debit: 0,
        credit: params.amount,
        currency: params.currency,
        description: `Stripe clearing account deducted for payout ${params.payoutId}`,
      },
    ]);
  },
};
