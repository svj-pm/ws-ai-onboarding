import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (two levels up from server/src/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import chatRouter from './routes/chat';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
}));

app.use(express.json());

// ─── Request logging (dev only) ───────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api', chatRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 WS AI Onboarding server running on http://localhost:${PORT}`);
  console.log(`   Model: ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'}`);
  console.log(`   API key: ${process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ NOT SET — set ANTHROPIC_API_KEY in .env'}`);
  console.log(`   Env: ${process.env.NODE_ENV || 'development'}\n`);
});
