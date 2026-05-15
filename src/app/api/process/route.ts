import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { google } from "googleapis";

export const maxDuration = 60;

const openai = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function googleAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

async function sendEmail(to: string, subject: string, body: string) {
  const gmail = google.gmail({ version: "v1", auth: googleAuth() });
  const raw = Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n")
  ).toString("base64url");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

async function createCalendarEvent(title: string, datetime: string, durationMins = 60, description = "") {
  const calendar = google.calendar({ version: "v3", auth: googleAuth() });
  const start = new Date(datetime);
  const end = new Date(start.getTime() + durationMins * 60000);
  await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });
}

async function createTask(title: string, dueDate?: string, notes?: string) {
  const tasks = google.tasks({ version: "v1", auth: googleAuth() });
  await tasks.tasks.insert({
    tasklist: "@default",
    requestBody: {
      title,
      notes,
      due: dueDate ? new Date(dueDate).toISOString() : undefined,
    },
  });
}

async function addNote(content: string, category = "General") {
  const docId = process.env.GOOGLE_IDEAS_DOC_ID;
  if (!docId) return;
  const docs = google.docs({ version: "v1", auth: googleAuth() });
  const date = new Date().toLocaleDateString("en-AU");
  const text = `\n[${date}] [${category}]\n${content}\n`;
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex = doc.data.body?.content?.at(-1)?.endIndex ?? 1;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [{ insertText: { location: { index: endIndex - 1 }, text } }],
    },
  });
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "send_email",
    description: "Send an email on behalf of the user",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "create_calendar_event",
    description: "Create a Google Calendar event",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        datetime: { type: "string", description: "ISO 8601 datetime" },
        duration_mins: { type: "number" },
        description: { type: "string" },
      },
      required: ["title", "datetime"],
    },
  },
  {
    name: "create_task",
    description: "Create a task/reminder in Google Tasks",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        due_date: { type: "string", description: "ISO 8601 date, optional" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "add_note",
    description:
      "Add a note to the ideas log. Use when user says 'take note this idea' or similar capture-only phrases.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        category: { type: "string", description: "e.g. Business Idea, Personal, Tesla Connect, AROI" },
      },
      required: ["content"],
    },
  },
];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) return NextResponse.json({ error: "No audio file provided" }, { status: 400 });

    // Transcribe
    const transcription = await openai().audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      language: "en",
    });
    const transcript = transcription.text.trim();
    if (!transcript) return NextResponse.json({ error: "Could not transcribe audio" }, { status: 422 });

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-AU", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const timeStr = now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });

    const systemPrompt = `You are a voice assistant for admin@aroi.au. The user has spoken a voice note while driving their Tesla on ${dateStr} at ${timeStr} AEST. The user owns AROI Group, a restaurant group in Australia.

Rules:
- If the user says "take note this idea", "note this", or similar → use add_note only
- Otherwise → determine the best action and execute it using the available tools
- You may call multiple tools if needed
- If the intent is unclear, create a task with the transcript as the title
- After all tool calls are complete, reply with 1–2 plain sentences summarising what you did`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `Voice transcript: "${transcript}"` },
    ];

    const actions: string[] = [];
    let done = false;

    while (!done) {
      const response = await anthropic().messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        done = true;
        const text = response.content.find((b) => b.type === "text");
        if (text?.type === "text") actions.push(text.text);
      } else if (response.stop_reason === "tool_use") {
        const results: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const input = block.input as Record<string, string | number>;
          let result = "";

          try {
            switch (block.name) {
              case "send_email":
                await sendEmail(String(input.to), String(input.subject), String(input.body));
                result = `Email sent to ${input.to}: "${input.subject}"`;
                break;
              case "create_calendar_event":
                await createCalendarEvent(
                  String(input.title),
                  String(input.datetime),
                  Number(input.duration_mins ?? 60),
                  String(input.description ?? "")
                );
                result = `Calendar event created: "${input.title}" at ${input.datetime}`;
                break;
              case "create_task":
                await createTask(String(input.title), input.due_date ? String(input.due_date) : undefined, input.notes ? String(input.notes) : undefined);
                result = `Task created: "${input.title}"`;
                break;
              case "add_note":
                await addNote(String(input.content), String(input.category ?? "General"));
                result = `Note saved [${input.category ?? "General"}]: "${String(input.content).substring(0, 60)}"`;
                break;
            }
          } catch (err) {
            result = `${block.name} failed: ${err instanceof Error ? err.message : "unknown error"}`;
          }

          actions.push(result);
          results.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }

        messages.push({ role: "user", content: results });
      } else {
        done = true;
      }
    }

    // Email summary
    const summary = [
      `Tesla Connect — Voice Summary`,
      `${dateStr} at ${timeStr}`,
      ``,
      `You said:`,
      `"${transcript}"`,
      ``,
      `Actions taken:`,
      ...actions.map((a) => `• ${a}`),
    ].join("\n");

    await sendEmail("admin@aroi.au", `Tesla Connect: ${transcript.substring(0, 60)}`, summary);

    return NextResponse.json({ transcript, actions });
  } catch (err) {
    console.error("[process]", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
