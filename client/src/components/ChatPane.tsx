import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';

// Simple markdown-to-HTML: bold (**text**), newlines
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}

interface MessageBubbleProps {
  message: ChatMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="avatar assistant-avatar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#00d478" />
            <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <p
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
          />
        )}
        <span className="msg-time">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {isUser && <div className="avatar user-avatar">You</div>}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="message-row assistant">
      <div className="avatar assistant-avatar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" fill="#00d478" />
          <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="bubble bubble-assistant typing-bubble">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
      </div>
    </div>
  );
}

function HandoffNotice({ reason }: { reason?: string }) {
  return (
    <div className="handoff-notice">
      <div className="handoff-notice-icon">⇗</div>
      <div className="handoff-notice-content">
        <p className="handoff-notice-message">
          I'm connecting you with a Wealthsimple advisor who can help with{' '}
          {reason ? <em>{reason}</em> : 'your situation'}.
          They'll have everything we've discussed so far, so you won't need to repeat anything.
        </p>
      </div>
    </div>
  );
}

interface ChatPaneProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  onSendMessage: (message: string) => void;
  sessionId: string | null;
  isHandedOff?: boolean;
  handoffReason?: string;
}

export function ChatPane({
  messages,
  isLoading,
  error,
  onSendMessage,
  sessionId,
  isHandedOff,
  handoffReason,
}: ChatPaneProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading || !sessionId) return;
    onSendMessage(trimmed);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  const canSend = input.trim().length > 0 && !isLoading && !!sessionId && !isHandedOff;

  return (
    <div className="chat-pane">
      <div className="chat-header">
        <div className="chat-header-info">
          <span className="chat-title">AI Onboarding Agent</span>
          {sessionId && (
            <span className="session-id">Session: {sessionId.slice(0, 8)}…</span>
          )}
        </div>
        <div className={`status-dot ${sessionId ? 'online' : 'offline'}`} />
      </div>

      <div className="message-list">
        {messages.filter((m) => m.visible).map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {isLoading && <TypingIndicator />}
        {isHandedOff && <HandoffNotice reason={handoffReason} />}
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {isHandedOff ? (
        <div className="handoff-waiting">
          <span className="handoff-pulse" />
          Connected to advisor — they have your full conversation history
        </div>
      ) : (
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          disabled={!sessionId || isLoading}
          rows={1}
        />
        <button
          type="submit"
          className={`send-btn ${canSend ? 'active' : ''}`}
          disabled={!canSend}
          aria-label="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      )}
    </div>
  );
}
