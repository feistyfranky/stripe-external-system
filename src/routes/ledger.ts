import { Router, Request, Response } from 'express';
import { ledgerRepo } from '../db/repositories';

export const ledgerRouter = Router();

// GET /api/ledger/balances - Summary of all double-entry ledger accounts
ledgerRouter.get('/balances', (req: Request, res: Response) => {
  const balances = ledgerRepo.getAccountBalances();
  res.json({ balances });
});

// GET /api/ledger/entries - Chronological journal entries
ledgerRouter.get('/entries', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '50', 10);
  const entries = ledgerRepo.listRecentEntries(limit);
  res.json({ entries });
});
