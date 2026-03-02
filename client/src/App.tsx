import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatPane } from './components/ChatPane';
import { ComplianceRecord } from './components/ComplianceRecord';
import { createSession, sendMessage } from './api/chat';
import type { ChatMessage, KycRecord, SuitabilityAssessment, SessionMetrics } from './types';

const EMPTY_KYC: KycRecord = {
  metadata: {
    record_id: '',
    created_at: '',
    updated_at: '',
    conversation_id: '',
    agent_version: '1.0.0',
    completion_status: 'in_progress',
    escalation_flags: [],
  },
};

const EMPTY_SUITABILITY: SuitabilityAssessment = {};

const EMPTY_METRICS: SessionMetrics = {
  mode: 'unknown',
  totalTurns: 0,
  phase1Turns: 0,
  phase2Turns: 0,
  phase3Turns: 0,
  extractionSuccessCount: 0,
  extractionRetryCount: 0,
  enforceOneQuestionTrims: 0,
  fieldsPerTurn: [],
  avgResponseLatency: 0,
  turnLatencies: [],
  guardrailAlerts: [],
};

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [kycRecord, setKycRecord] = useState<KycRecord>(EMPTY_KYC);
  const [suitabilityAssessment, setSuitabilityAssessment] = useState<SuitabilityAssessment>(EMPTY_SUITABILITY);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics>(EMPTY_METRICS);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isHandedOff, setIsHandedOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  async function startSession() {
    const response = await createSession();
    setSessionId(response.sessionId);
    setKycRecord(response.kycRecord);
    setSuitabilityAssessment(response.suitabilityAssessment);
    if (response.sessionMetrics) setSessionMetrics(response.sessionMetrics);
    setMessages([
      {
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString(),
        visible: true,
      },
    ]);
  }

  // Start a session on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    startSession().catch((err) => {
      setError('Failed to start a session. Is the server running on port 3001?');
      console.error(err);
    });
  }, []);

  const handleNewConversation = useCallback(async () => {
    if (isLoading || isResetting) return;
    setIsResetting(true);
    // Brief pause for fade-out
    await new Promise((resolve) => setTimeout(resolve, 200));
    setMessages([]);
    setKycRecord(EMPTY_KYC);
    setSuitabilityAssessment(EMPTY_SUITABILITY);
    setSessionMetrics(EMPTY_METRICS);
    setIsHandedOff(false);
    setError(null);
    try {
      await startSession();
    } catch (err) {
      setError('Failed to start a new session.');
      console.error(err);
    } finally {
      setIsResetting(false);
    }
  }, [isLoading, isResetting]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!sessionId || isLoading) return;

      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        visible: true,
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      try {
        const response = await sendMessage(sessionId, text);
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: response.message,
          timestamp: new Date().toISOString(),
          visible: true,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        console.log('[App] Setting kycRecord:', JSON.stringify(response.kycRecord, null, 2));
        console.log('[App] Setting suitabilityAssessment:', JSON.stringify(response.suitabilityAssessment, null, 2));
        setKycRecord(response.kycRecord);
        setSuitabilityAssessment(response.suitabilityAssessment);
        if (response.sessionMetrics) setSessionMetrics(response.sessionMetrics);
        if (response.handoff) setIsHandedOff(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, isLoading]
  );

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="header-brand">
          <svg className="ws-logo" width="24" height="24" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="#00d478" />
            <path d="M10 20l6 8 14-16" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="brand-name">Wealthsimple</span>
          <span className="brand-tag">AI Onboarding</span>
        </div>
        <div className="header-actions">
          <button
            className="btn-new-conversation"
            onClick={handleNewConversation}
            disabled={isLoading || isResetting}
            title="Reset and start a new conversation"
          >
            ↺ New Conversation
          </button>
          <span className="header-note">Prototype — FINTRAC / CSA NI 31-103 compliance demo</span>
        </div>
      </header>

      <main className={`app-main${isResetting ? ' resetting' : ''}`}>
        <ChatPane
          messages={messages}
          isLoading={isLoading}
          error={error}
          onSendMessage={handleSendMessage}
          sessionId={sessionId}
          isHandedOff={isHandedOff}
          handoffReason={kycRecord.metadata.handoff_reason}
        />
        <ComplianceRecord
          kycRecord={kycRecord}
          suitabilityAssessment={suitabilityAssessment}
          sessionMetrics={sessionMetrics}
        />
      </main>
    </div>
  );
}
