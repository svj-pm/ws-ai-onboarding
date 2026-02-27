import type { CreateSessionResponse, ChatResponse } from '../types';

const API_BASE = '/api';

export async function createSession(): Promise<CreateSessionResponse> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to create session: ${res.statusText}`);
  }
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  message: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Failed to send message');
  }
  const data: ChatResponse = await res.json();
  console.log('[api] sendMessage response — kycRecord sections:', Object.keys(data.kycRecord).join(', '));
  const kycKeys = Object.keys(data.kycRecord).filter((k) => k !== 'metadata');
  console.log('[api] Populated KYC sections (non-metadata):', kycKeys.length > 0 ? kycKeys.join(', ') : '(none)');
  return data;
}
