/**
 * Strictly scoped attendance-call interpretation. This is intentionally not a
 * general chatbot and is usable only after a speech runtime supplies a
 * transcript for a persisted voice communication.
 */
import { z } from "zod";

export const attendanceConversationSchema = z.object({
  absenceReasonCategory: z.enum([
    "illness",
    "family_emergency",
    "transport",
    "academic",
    "unknown",
    "other",
  ]),
  explanationStatus: z.enum(["provided", "declined", "unclear"]),
  expectedReturnDate: z.string().date().nullable(),
  followUpRequired: z.boolean(),
  escalationRecommended: z.boolean(),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(500),
});

export type AttendanceConversation = z.infer<typeof attendanceConversationSchema>;

export const unparsedAttendanceConversation = (): AttendanceConversation => ({
  absenceReasonCategory: "unknown",
  explanationStatus: "unclear",
  expectedReturnDate: null,
  followUpRequired: true,
  escalationRecommended: false,
  confidence: 0,
  summary: "Parent response could not be interpreted automatically; faculty review is required.",
});

export async function interpretAttendanceConversation(
  transcript: string,
  language: string,
): Promise<AttendanceConversation> {
  if (!transcript.trim()) return unparsedAttendanceConversation();
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return unparsedAttendanceConversation();

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Interpret only this school attendance absence-call transcript. Do not answer questions, provide advice, or infer facts. Return exactly the requested JSON fields.",
          },
          {
            role: "user",
            content: JSON.stringify({
              language,
              transcript,
              requiredShape: {
                absenceReasonCategory: "illness|family_emergency|transport|academic|unknown|other",
                explanationStatus: "provided|declined|unclear",
                expectedReturnDate: "YYYY-MM-DD or null",
                followUpRequired: "boolean",
                escalationRecommended: "boolean",
                confidence: "number 0 through 1",
                summary: "one concise attendance-only summary",
              },
            }),
          },
        ],
      }),
    });
    if (!response.ok) return unparsedAttendanceConversation();
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return unparsedAttendanceConversation();
    const parsed = attendanceConversationSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : unparsedAttendanceConversation();
  } catch {
    return unparsedAttendanceConversation();
  }
}
