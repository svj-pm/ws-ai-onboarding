import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  createSession,
  getSession,
  updateSession,
} from '../state/sessions';
import { chat, applyExtraction, INITIAL_GREETING } from '../services/claude';
import type { ChatRequest, ChatMessage } from '../types';

const router = Router();

// Counts filled leaf values in a record (strings, numbers, booleans, non-empty arrays).
// Used to track cumulative extraction progress across turns.
function countLeafFields(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  if (Array.isArray(obj)) return obj.length > 0 ? 1 : 0;
  if (typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).reduce(
      (sum: number, v) => sum + countLeafFields(v),
      0
    );
  }
  if (typeof obj === 'string') return obj.length > 0 ? 1 : 0;
  return 1; // number or boolean
}

// ─── POST /api/sessions ───────────────────────────────────────────────────────
// Creates a new conversation session and returns the agent's opening message.

router.post('/sessions', (_req: Request, res: Response) => {
  const session = createSession();

  const initialMessage: ChatMessage = {
    role: 'assistant',
    content: INITIAL_GREETING,
    timestamp: new Date().toISOString(),
    visible: true,
  };

  updateSession(session.id, { messages: [initialMessage] });

  res.json({
    sessionId: session.id,
    message: INITIAL_GREETING,
    kycRecord: session.kycRecord,
    suitabilityAssessment: session.suitabilityAssessment,
  });
});

// ─── POST /api/chat/:sessionId ────────────────────────────────────────────────
// Sends a user message, gets an AI response, and returns the updated records.

router.post('/chat/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { message } = req.body as ChatRequest;

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const userMsg: ChatMessage = {
    role: 'user',
    content: message.trim(),
    timestamp: new Date().toISOString(),
    visible: true,
  };

  const updatedMessages = [...session.messages, userMsg];

  try {
    const { assistantMessage, extraction, rawResponse, extractionFound } = await chat(
      session.messages,
      message.trim()
    );

    console.log(
      `[chat route] kyc sections after extraction: [${Object.keys(extraction.kyc_updates).join(', ') || 'none'}]`
    );

    const { kycRecord, suitabilityAssessment } = applyExtraction(
      session.kycRecord,
      session.suitabilityAssessment,
      extraction
    );

    if (extractionFound) {
      const kycFields = countLeafFields(kycRecord);
      const suitFields = countLeafFields(suitabilityAssessment);
      console.log(
        `[chat route] Extraction OK — KYC: ${kycFields} fields, Suitability: ${suitFields} fields, Total: ${kycFields + suitFields}`
      );
    }

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: assistantMessage,
      timestamp: new Date().toISOString(),
      visible: true,
    };

    updateSession(sessionId, {
      messages: [...updatedMessages, assistantMsg],
      kycRecord,
      suitabilityAssessment,
      lastRawResponse: rawResponse,
    });

    res.json({
      message: assistantMessage,
      kycRecord,
      suitabilityAssessment,
      sessionId,
    });
  } catch (err) {
    console.error('[chat route] Error calling Claude:', err);
    res.status(500).json({
      error: 'Failed to get a response from the AI agent. Please try again.',
    });
  }
});

// ─── GET /api/sessions/:sessionId ─────────────────────────────────────────────
// Returns the current session state (for reconnection).

router.get('/sessions/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    sessionId: session.id,
    messages: session.messages.filter((m) => m.visible),
    kycRecord: session.kycRecord,
    suitabilityAssessment: session.suitabilityAssessment,
  });
});

// ─── GET /api/sessions/:sessionId/debug ───────────────────────────────────────
// Returns the raw last Claude response (before parsing) + full session state.
// Useful for diagnosing extraction failures.

router.get('/sessions/:sessionId/debug', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = getSession(sessionId);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const raw = session.lastRawResponse ?? null;
  const extractionBlockMatch = raw?.match(/<extraction>([\s\S]*?)<\/extraction>/);

  res.json({
    sessionId: session.id,
    messageCount: session.messages.length,
    lastRawResponse: raw,
    lastExtractionBlock: extractionBlockMatch ? extractionBlockMatch[1].trim() : null,
    hasExtractionBlock: extractionBlockMatch !== null && extractionBlockMatch !== undefined,
    kycRecord: session.kycRecord,
    suitabilityAssessment: session.suitabilityAssessment,
  });
});

export default router;
