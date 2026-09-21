import { Router, Request, Response } from 'express';
import { eventsRepo } from '../db/repositories';
import { webhookProcessor } from '../services/webhook';

export const eventsRouter = Router();

// GET /api/events - List recent Stripe webhook events
eventsRouter.get('/', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '50', 10);
  const events = eventsRepo.listRecent(limit);
  res.json({ events, count: events.length });
});

// GET /api/events/:id - Get specific event details
eventsRouter.get('/:id', (req: Request, res: Response): void => {
  const eventId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const event = eventsRepo.getById(eventId);
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }
  res.json({ event });
});

// POST /api/events/:id/replay - Replay/reprocess an event through the webhook engine
eventsRouter.post('/:id/replay', async (req: Request, res: Response): Promise<void> => {
  const eventId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const eventRecord = eventsRepo.getById(eventId);
  if (!eventRecord) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  try {
    // Re-route the event
    await webhookProcessor.routeEvent(eventRecord.payload);
    eventsRepo.markProcessed(eventRecord.event_id);
    res.json({ success: true, message: `Event ${eventRecord.event_id} replayed successfully` });
  } catch (err: any) {
    eventsRepo.markFailed(eventRecord.event_id, err.message);
    res.status(500).json({ error: `Replay failed: ${err.message}` });
  }
});
