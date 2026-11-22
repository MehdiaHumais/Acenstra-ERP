"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  X,
  RotateCcw,
  Minimize2,
  Users,
  ShoppingBag,
  Package,
  Layers,
  CheckCircle2,
  HelpCircle,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/format";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface LiveStats {
  totalCustomers: number;
  totalOrders: number;
  totalProducts: number;
  totalLots: number;
  activeRecalls: number;
}

const QUICK_PROMPTS = [
  "How does this system work?",
  "What are our latest orders?",
  "Who are our active customers?",
  "Explain FEFO & cold chain",
  "How does SdI invoicing work?",
];

export function ErpChatAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content:
        "Hello! I am your **Ascentra ERP Assistant**.\n\n" +
        "I have real-time access to the database and system workflows. Ask me anything about our **customers**, **orders**, **inventory stock**, or how any specific feature works!",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch live system stats when widget opens or mounts
  const fetchLiveStats = async () => {
    try {
      const res = await fetch("/api/v1/ai/assistant", { credentials: "include" });
      const data = await res.json();
      if (data?.stats) {
        setLiveStats(data.stats);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchLiveStats();
  }, []);

  // Allow the top header to toggle the assistant drawer.
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("ascentra:open-ai", handler);
    return () => window.removeEventListener("ascentra:open-ai", handler);
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchLiveStats();
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading, isOpen]);

  const handleSend = async (textToSend?: string) => {
    const promptText = (textToSend ?? input).trim();
    if (!promptText || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: promptText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/v1/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();

      if (data?.liveStats) {
        setLiveStats(data.liveStats);
      }

      const botReply =
        data?.reply ||
        "I received your request, but could not retrieve a detailed response from the gateway.";

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: botReply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-err-${Date.now()}`,
          role: "assistant",
          content:
            "Sorry, I encountered a temporary connection issue reaching the AI gateway. Please try again.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome-reset",
        role: "assistant",
        content: "Chat cleared. What would you like to know about Ascentra ERP or live orders?",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  };

  // Helper to render simple markdown formatting (bold, bullet points, headers)
  const renderFormattedContent = (content: string) => {
    const lines = content.split("\n");
    return lines.map((line, idx) => {
      let trimmed = line.trim();

      // Headers
      if (trimmed.startsWith("### ")) {
        return (
          <h4 key={idx} className="font-semibold text-sm mt-2 mb-1 text-foreground">
            {trimmed.replace(/^###\s+/, "")}
          </h4>
        );
      }
      if (trimmed.startsWith("## ")) {
        return (
          <h3 key={idx} className="font-bold text-base mt-2.5 mb-1.5 text-foreground">
            {trimmed.replace(/^##\s+/, "")}
          </h3>
        );
      }

      // Bullet points
      const isBullet = trimmed.startsWith("• ") || trimmed.startsWith("* ") || trimmed.startsWith("- ");
      if (isBullet) {
        const text = trimmed.replace(/^[•\*\-]\s+/, "");
        return (
          <div key={idx} className="flex items-start gap-1.5 my-0.5 pl-1 text-xs leading-relaxed">
            <span className="text-primary mt-1 text-[8px]">●</span>
            <div>{renderInlineFormatting(text)}</div>
          </div>
        );
      }

      // Ordered list (e.g. 1. 2.)
      const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (orderedMatch) {
        return (
          <div key={idx} className="flex items-start gap-1.5 my-1 pl-1 text-xs leading-relaxed">
            <span className="font-semibold text-primary min-w-[18px] text-[11px]">{orderedMatch[1]}.</span>
            <div>{renderInlineFormatting(orderedMatch[2])}</div>
          </div>
        );
      }

      // Empty line spacer
      if (!trimmed) {
        return <div key={idx} className="h-1.5" />;
      }

      return (
        <p key={idx} className="my-0.5 text-xs leading-relaxed">
          {renderInlineFormatting(line)}
        </p>
      );
    });
  };

  const renderInlineFormatting = (text: string) => {
    // Process bold **text** and code `code`
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.2 font-mono text-[11px] text-primary">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  return (
    <>
      {/* CHATBOT DRAWER / WINDOW */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 z-50 flex h-[600px] max-h-[calc(100vh-2rem)] w-[430px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          {/* HEADER */}
          <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-[#061222] to-[#1B3A52] px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                <img src="/logo.png" alt="Ascentra Logo" className="h-full w-full object-contain" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold tracking-tight">Ascentra AI Assistant</h3>
                  <span className="inline-flex items-center gap-1 rounded-full border border-marine-steelLight/40 bg-marine-steel/30 px-2 py-0.5 text-[9px] font-semibold text-marine-ice">
                    <span className="h-1.5 w-1.5 rounded-full bg-marine-steelLight animate-pulse" /> Live Grounded
                  </span>
                </div>
                <p className="text-[10px] text-marine-ice/70">
                  Powered by OmniRoute & Real-Time ERP Data
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={clearChat}
                title="Clear conversation"
                className="rounded-md p-1.5 text-white/70 hover:bg-marine-mid/10 hover:text-white transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                title="Close chat"
                className="rounded-md p-1.5 text-white/70 hover:bg-marine-mid/10 hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* LIVE SYSTEM DATA COUNTERS STRIP */}
          {liveStats && (
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3.5 py-1.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1 font-medium">
                <Users className="h-3 w-3 text-primary" /> {liveStats.totalCustomers} Customers
              </span>
              <span className="flex items-center gap-1 font-medium">
                <ShoppingBag className="h-3 w-3 text-primary" /> {liveStats.totalOrders} Orders
              </span>
              <span className="flex items-center gap-1 font-medium">
                <Package className="h-3 w-3 text-primary" /> {liveStats.totalProducts} Products
              </span>
            </div>
          )}

          {/* CHAT MESSAGES SCROLL CONTAINER */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-background/50">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col max-w-[88%]",
                  m.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 shadow-sm text-xs leading-relaxed select-text cursor-text break-words",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-none chat-user-bubble"
                      : "bg-card border border-border text-foreground rounded-bl-none shadow-sm chat-bot-bubble"
                  )}
                >
                  {renderFormattedContent(m.content)}
                </div>
                <span className="mt-1 text-[9px] text-muted-foreground px-1">
                  {m.timestamp}
                </span>
              </div>
            ))}

            {/* TYPING INDICATOR */}
            {isLoading && (
              <div className="mr-auto flex items-center gap-2 rounded-2xl bg-card border border-border px-4 py-2.5 shadow-sm">
                <Bot className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-[11px] text-muted-foreground font-medium">
                  Querying live ERP & OmniRoute...
                </span>
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
                </span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* QUICK PROMPT CHIPS */}
          <div className="border-t border-border bg-card/60 px-3 py-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSend(q)}
                  disabled={isLoading}
                  className="whitespace-nowrap rounded-full border border-border bg-background px-2.5 py-1 text-muted-foreground hover:border-primary hover:text-foreground transition-all hover:bg-muted text-[10px]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* INPUT FORM */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="border-t border-border bg-card p-3 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask how a page works or check orders..."
              disabled={isLoading}
              className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="rounded-xl bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm"
              title="Send message"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
