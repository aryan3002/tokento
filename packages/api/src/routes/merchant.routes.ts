// ============================================================
// Tokento — Merchant Routes
// ============================================================
import { Router, Request, Response, NextFunction } from 'express';
import { merchantService } from '../services/merchant.service';
import { authenticateApiKey } from '../middleware/auth.middleware';
import { CreateMerchantSchema, UpdateMerchantConfigSchema, CreateEarnRuleSchema, UpdateEarnRuleSchema, CreateApiKeySchema, CreateWebhookEndpointSchema } from '@tokento/shared';
import { webhookService } from '../services/webhook.service';

const router = Router();

// POST /v1/merchants — Register (no auth required for registration)
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateMerchantSchema.parse(req.body);
    const result = await merchantService.create(data);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /v1/merchants/me
router.get('/me', authenticateApiKey(['merchants:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const merchant = await merchantService.getById(req.merchantId!);
    res.json(merchant);
  } catch (err) { next(err); }
});

// PUT /v1/merchants/me/config
router.put('/me/config', authenticateApiKey(['merchants:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateMerchantConfigSchema.parse(req.body);
    const merchant = await merchantService.updateConfig(req.merchantId!, data);
    res.json(merchant);
  } catch (err) { next(err); }
});

// ---- Earn Rules ----
router.post('/me/earn-rules', authenticateApiKey(['earn_rules:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateEarnRuleSchema.parse(req.body);
    const rule = await merchantService.createEarnRule(req.merchantId!, data);
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.get('/me/earn-rules', authenticateApiKey(['earn_rules:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await merchantService.getEarnRules(req.merchantId!);
    res.json(rules);
  } catch (err) { next(err); }
});

router.put('/me/earn-rules/:ruleId', authenticateApiKey(['earn_rules:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateEarnRuleSchema.parse(req.body);
    const rule = await merchantService.updateEarnRule(req.merchantId!, req.params.ruleId, data);
    res.json(rule);
  } catch (err) { next(err); }
});

// ---- Tokens & Redemptions ----
router.get('/me/tokens', authenticateApiKey(['tokens:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await merchantService.getTokens(req.merchantId!);
    res.json(tokens);
  } catch (err) { next(err); }
});

router.get('/me/redemptions', authenticateApiKey(['tokens:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const redemptions = await merchantService.getRedemptions(req.merchantId!);
    res.json(redemptions);
  } catch (err) { next(err); }
});

// ---- API Keys ----
router.post('/me/api-keys', authenticateApiKey(['merchants:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateApiKeySchema.parse(req.body);
    const result = await merchantService.createApiKey(req.merchantId!, data);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/me/api-keys', authenticateApiKey(['merchants:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = await merchantService.listApiKeys(req.merchantId!);
    res.json(keys);
  } catch (err) { next(err); }
});

router.delete('/me/api-keys/:keyId', authenticateApiKey(['merchants:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await merchantService.revokeApiKey(req.merchantId!, req.params.keyId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---- Webhooks ----
router.post('/me/webhooks', authenticateApiKey(['webhooks:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateWebhookEndpointSchema.parse(req.body);
    const endpoint = await webhookService.createEndpoint(req.merchantId!, data);
    res.status(201).json(endpoint);
  } catch (err) { next(err); }
});

router.get('/me/webhooks', authenticateApiKey(['webhooks:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoints = await webhookService.listEndpoints(req.merchantId!);
    res.json(endpoints);
  } catch (err) { next(err); }
});

router.delete('/me/webhooks/:endpointId', authenticateApiKey(['webhooks:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await webhookService.deleteEndpoint(req.merchantId!, req.params.endpointId);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
