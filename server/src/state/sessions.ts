import { v4 as uuidv4 } from 'uuid';
import type { Session, KycRecord, SuitabilityAssessment } from '../types';

// In-memory store — sufficient for a prototype
const sessions = new Map<string, Session>();

export function createSession(): Session {
  const id = uuidv4();
  const now = new Date().toISOString();

  const kycRecord: KycRecord = {
    metadata: {
      record_id: uuidv4(),
      created_at: now,
      updated_at: now,
      conversation_id: id,
      agent_version: '1.0.0',
      completion_status: 'in_progress',
      escalation_flags: [],
    },
  };

  const suitabilityAssessment: SuitabilityAssessment = {};

  const session: Session = {
    id,
    messages: [],
    kycRecord,
    suitabilityAssessment,
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function updateSession(id: string, updates: Partial<Session>): Session | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;

  const updated: Session = {
    ...session,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  sessions.set(id, updated);
  return updated;
}

/**
 * Deep-merges a partial update object into the current record.
 * Arrays are replaced (not appended), objects are deep-merged.
 * Escalation flags are the exception — they are accumulated via a separate helper.
 */
export function deepMerge<T>(target: T, source: unknown): T {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source as T;
  }

  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };

  for (const key of Object.keys(source as object)) {
    const sourceVal = (source as Record<string, unknown>)[key];
    const targetVal = result[key];

    if (sourceVal === null || sourceVal === undefined) continue;

    if (Array.isArray(sourceVal)) {
      result[key] = sourceVal; // Replace arrays outright
    } else if (
      typeof sourceVal === 'object' &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as object, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result as T;
}
