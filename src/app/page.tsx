"use client";

import { useState, useRef } from "react";

type Status = "idle" | "recording" | "processing" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await processAudio(blob);
      };

      mediaRecorder.start();
      setStatus("recording");
    } catch {
      setErrorMsg("Microphone access denied.");
      setStatus("error");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setStatus("processing");
  }

  async function processAudio(blob: Blob) {
    try {
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      const res = await fetch("/api/process", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || data.error) throw new Error(data.error || "Processing failed");

      setTranscript(data.transcript);
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

  const statusLabel: Record<Status, string> = {
    idle: "Tap to record",
    recording: "Recording… tap to stop",
    processing: "Processing…",
    done: "Done — summary sent to your email",
    error: errorMsg || "Something went wrong",
  };

  const btnEmoji =
    status === "processing" ? "⏳" : status === "recording" ? "⏹" : "🎤";

  const btnColor = status === "recording" ? "#ef4444" : "#e31937";

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
      <h1
        style={{
          fontSize: "1.1rem",
          fontWeight: 300,
          letterSpacing: "0.3em",
          opacity: 0.6,
          textTransform: "uppercase",
        }}
      >
        Tesla Connect
      </h1>

      {/* Record button */}
      <button
        onClick={
          status === "idle"
            ? startRecording
            : status === "recording"
            ? stopRecording
            : undefined
        }
        disabled={status === "processing"}
        style={{
          width: 200,
          height: 200,
          borderRadius: "50%",
          border: `3px solid ${btnColor}`,
          background: status === "recording" ? btnColor : "transparent",
          cursor: status === "processing" ? "default" : "pointer",
          fontSize: "4rem",
          transition: "all 0.2s ease",
          boxShadow:
            status === "recording"
              ? `0 0 50px ${btnColor}88`
              : `0 0 20px ${btnColor}33`,
          animation: status === "recording" ? "pulse 1.5s infinite" : "none",
        }}
      >
        {btnEmoji}
      </button>

      <p style={{ opacity: 0.5, fontSize: "1rem", textAlign: "center" }}>
        {statusLabel[status]}
      </p>

      {/* Results */}
      {status === "done" && (
        <div style={{ maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ background: "#1a1a1a", borderRadius: "1rem", padding: "1.25rem" }}>
            <p style={{ opacity: 0.4, fontSize: "0.75rem", marginBottom: "0.5rem" }}>YOU SAID</p>
            <p style={{ fontStyle: "italic", opacity: 0.9, lineHeight: 1.5 }}>"{transcript}"</p>
          </div>

          <div style={{ background: "#1a1a1a", borderRadius: "1rem", padding: "1.25rem" }}>
            <p style={{ opacity: 0.4, fontSize: "0.75rem", marginBottom: "0.75rem" }}>ACTIONS TAKEN</p>
            {actions.map((a, i) => (
              <p key={i} style={{ opacity: 0.8, fontSize: "0.9rem", padding: "0.25rem 0", lineHeight: 1.4 }}>
                • {a}
              </p>
            ))}
          </div>

          <button
            onClick={reset}
            style={{
              padding: "1rem",
              background: "#e31937",
              border: "none",
              borderRadius: "2rem",
              color: "#fff",
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            Record Another
          </button>
        </div>
      )}

      {status === "error" && (
        <button
          onClick={reset}
          style={{
            padding: "0.75rem 2rem",
            background: "transparent",
            border: "1px solid #555",
            borderRadius: "2rem",
            color: "#fff",
            cursor: "pointer",
          }}
        >
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
