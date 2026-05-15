"use client";

import { useState, useRef, useEffect } from "react";

type Status = "idle" | "listening" | "processing" | "done" | "error";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (!("SpeechRecognition" in window) && !("webkitSpeechRecognition" in window)) {
      setSupported(false);
    }
  }, []);

  function startListening() {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMsg("Speech recognition not supported in this browser.");
      setStatus("error");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-AU";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;

    recognition.onresult = async (e) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      setStatus("processing");
      await process(text);
    };

    recognition.onerror = (e) => {
      setErrorMsg(`Mic error: ${e.error}`);
      setStatus("error");
    };

    recognition.onend = () => {
      if (status === "listening") setStatus("idle");
    };

    recognition.start();
    setStatus("listening");
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setStatus("processing");
  }

  async function process(text: string) {
    try {
      const res = await fetch(`${BACKEND}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed");
      setActions(data.actions);
      setStatus("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  function reset() {
    setStatus("idle");
    setTranscript("");
    setActions([]);
    setErrorMsg("");
  }

  const isListening = status === "listening";
  const isProcessing = status === "processing";
  const btnColor = isListening ? "#ef4444" : "#e31937";
  const btnEmoji = isProcessing ? "⏳" : isListening ? "⏹" : "🎤";

  const statusLabel: Record<Status, string> = {
    idle: supported ? "Tap to speak" : "Not supported in this browser",
    listening: "Listening… tap to stop",
    processing: "Processing…",
    done: "Done — summary sent to your email",
    error: errorMsg || "Something went wrong",
  };

  return (
    <main
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        gap: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.1rem", fontWeight: 300, letterSpacing: "0.3em", opacity: 0.6, textTransform: "uppercase" }}>
        Tesla Connect
      </h1>

      <button
        onClick={isListening ? stopListening : status === "idle" ? startListening : undefined}
        disabled={isProcessing || !supported}
        style={{
          width: 200,
          height: 200,
          borderRadius: "50%",
          border: `3px solid ${btnColor}`,
          background: isListening ? btnColor : "transparent",
          cursor: isProcessing || !supported ? "default" : "pointer",
          fontSize: "4rem",
          transition: "all 0.2s ease",
          boxShadow: isListening ? `0 0 50px ${btnColor}88` : `0 0 20px ${btnColor}33`,
          animation: isListening ? "pulse 1.5s infinite" : "none",
        }}
      >
        {btnEmoji}
      </button>

      <p style={{ opacity: 0.5, fontSize: "1rem", textAlign: "center", maxWidth: 300 }}>
        {statusLabel[status]}
      </p>

      {status === "done" && (
        <div style={{ maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1a1a1a", borderRadius: "1rem", padding: "1.25rem" }}>
            <p style={{ opacity: 0.4, fontSize: "0.75rem", marginBottom: "0.5rem" }}>YOU SAID</p>
            <p style={{ fontStyle: "italic", opacity: 0.9, lineHeight: 1.5 }}>"{transcript}"</p>
          </div>
          <div style={{ background: "#1a1a1a", borderRadius: "1rem", padding: "1.25rem" }}>
            <p style={{ opacity: 0.4, fontSize: "0.75rem", marginBottom: "0.75rem" }}>ACTIONS TAKEN</p>
            {actions.map((a, i) => (
              <p key={i} style={{ opacity: 0.8, fontSize: "0.9rem", padding: "0.25rem 0", lineHeight: 1.4 }}>• {a}</p>
            ))}
          </div>
          <button onClick={reset} style={{ padding: "1rem", background: "#e31937", border: "none", borderRadius: "2rem", color: "#fff", fontSize: "1rem", cursor: "pointer" }}>
            Record Another
          </button>
        </div>
      )}

      {status === "error" && (
        <button onClick={reset} style={{ padding: "0.75rem 2rem", background: "transparent", border: "1px solid #555", borderRadius: "2rem", color: "#fff", cursor: "pointer" }}>
          Try Again
        </button>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 50px #ef444488; }
          50% { box-shadow: 0 0 80px #ef4444cc; }
        }
      `}</style>
    </main>
  );
}
