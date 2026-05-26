// ============================================================
// Tokento — Merchant Routes
// ============================================================
import { Router, Request, Response, NextFunction } from 'express';
import { merchantService } from '../services/merchant.service';
import { authenticateApiKey, authenticateApiKeyOrB2BSession } from '../middleware/auth.middleware';
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
router.get('/me', authenticateApiKeyOrB2BSession(['merchants:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const merchant = await merchantService.getById(req.merchantId!);
    res.json(merchant);
  } catch (err) { next(err); }
});

// PUT /v1/merchants/me/config
router.put('/me/config', authenticateApiKeyOrB2BSession(['merchants:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateMerchantConfigSchema.parse(req.body);
    const merchant = await merchantService.updateConfig(req.merchantId!, data);
    res.json(merchant);
  } catch (err) { next(err); }
});

// ---- Earn Rules ----
router.post('/me/earn-rules', authenticateApiKeyOrB2BSession(['earn_rules:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateEarnRuleSchema.parse(req.body);
    const rule = await merchantService.createEarnRule(req.merchantId!, data);
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.get('/me/earn-rules', authenticateApiKeyOrB2BSession(['earn_rules:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await merchantService.getEarnRules(req.merchantId!);
    res.json(rules);
  } catch (err) { next(err); }
});

router.put('/me/earn-rules/:ruleId', authenticateApiKeyOrB2BSession(['earn_rules:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = UpdateEarnRuleSchema.parse(req.body);
    const ruleId = Array.isArray(req.params.ruleId) ? req.params.ruleId[0] : req.params.ruleId;
    const rule = await merchantService.updateEarnRule(req.merchantId!, ruleId, data);
    res.json(rule);
  } catch (err) { next(err); }
});

// ---- Tokens & Redemptions ----
router.get('/me/tokens', authenticateApiKeyOrB2BSession(['tokens:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await merchantService.getTokens(req.merchantId!);
    res.json(tokens);
  } catch (err) { next(err); }
});

router.get('/me/redemptions', authenticateApiKeyOrB2BSession(['tokens:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const redemptions = await merchantService.getRedemptions(req.merchantId!);
    res.json(redemptions);
  } catch (err) { next(err); }
});

// ---- API Keys ----
router.post('/me/api-keys', authenticateApiKeyOrB2BSession(['merchants:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateApiKeySchema.parse(req.body);
    const result = await merchantService.createApiKey(req.merchantId!, data);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/me/api-keys', authenticateApiKeyOrB2BSession(['merchants:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = await merchantService.listApiKeys(req.merchantId!);
    res.json(keys);
  } catch (err) { next(err); }
});

router.delete('/me/api-keys/:keyId', authenticateApiKeyOrB2BSession(['merchants:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keyId = Array.isArray(req.params.keyId) ? req.params.keyId[0] : req.params.keyId;
    await merchantService.revokeApiKey(req.merchantId!, keyId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---- Webhooks ----
router.post('/me/webhooks', authenticateApiKeyOrB2BSession(['webhooks:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CreateWebhookEndpointSchema.parse(req.body);
    const endpoint = await webhookService.createEndpoint(req.merchantId!, data);
    res.status(201).json(endpoint);
  } catch (err) { next(err); }
});

router.get('/me/webhooks', authenticateApiKeyOrB2BSession(['webhooks:read']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpoints = await webhookService.listEndpoints(req.merchantId!);
    res.json(endpoints);
  } catch (err) { next(err); }
});

router.delete('/me/webhooks/:endpointId', authenticateApiKeyOrB2BSession(['webhooks:write']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endpointId = Array.isArray(req.params.endpointId) ? req.params.endpointId[0] : req.params.endpointId;
    await webhookService.deleteEndpoint(req.merchantId!, endpointId);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
