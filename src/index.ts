import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { initDatabase } from './db';
import { webhookRouter } from './routes/webhooks';
import { checkoutRouter } from './routes/checkout';
import { portalRouter } from './routes/portal';
import { eventsRouter } from './routes/events';
import { customersRouter } from './routes/customers';
import { ledgerRouter } from './routes/ledger';
import { simulatorRouter } from './routes/simulator';
import { paymentsRouter } from './routes/payments';

const app = express();

// 1. Initialize SQLite Database
initDatabase();

// 2. Global Middleware
app.use(cors());

// 3. IMPORTANT: Stripe Webhooks REQUIRE raw body for signature verification!
// We apply raw parser ONLY to the webhook route before express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// 4. Standard JSON parser for all other REST endpoints
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Mount API Routers
app.use('/api/checkout', checkoutRouter);
app.use('/api/portal', portalRouter);
app.use('/api/events', eventsRouter);
app.use('/api', customersRouter);
app.use('/api/ledger', ledgerRouter);
app.use('/api/simulator', simulatorRouter);
app.use('/api/payments', paymentsRouter);

// 6. Health & Status endpoint
app.get('/api/health', (req, res) => {
  const isLive = config.stripeSecretKey.startsWith('sk_live_');
  const isTest = config.stripeSecretKey.startsWith('sk_test_');
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stripeMode: isLive ? 'live' : isTest ? 'test' : 'simulation',
    isLive,
    isTest,
    simulatorEnabled: config.simulatorEnabled,
  });
});

// 7. Serve Static Admin / Operations UI
app.use(express.static(path.join(process.cwd(), 'public')));

// 8. Catch-all for SPA fallback
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Start listening locally (when not running as a Vercel serverless function)
if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`
=====================================================
🚀 STRIPE EXTERNAL SYSTEM RUNNING
-----------------------------------------------------
📡 Server URL:         http://localhost:${config.port}
📊 Admin & Test UI:    http://localhost:${config.port}
⚡ Webhook Ingestion:  http://localhost:${config.port}/api/webhooks
🔒 Stripe Mode:        ${config.isStripeConfigured ? 'Connected (Stripe Test/Live API)' : 'Simulation Sandbox (Ready to test)'}
🗄️ Database Path:      ${config.databasePath}
=====================================================
    `);
  });
}

export default app;
