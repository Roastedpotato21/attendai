import { createServerFn } from "@tanstack/react-start";
import type {
  AnalyticsDashboardData,
  StudentRiskProfile,
  ClassAIInsight,
  StudentAIInsight,
} from "@/lib/types";
import { mockAiAnalysisService } from "@/lib/services/ai";

/**
 * Executes a prompt against configured LLMs securely on the server.
 * Returns a JSON-parsed object.
 */
async function callLLM(prompt: string): Promise<unknown> {
  const geminiKey = process.env["GEMINI_API_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];

  if (geminiKey) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini API Error: ${res.statusText}`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty response from Gemini");
    return JSON.parse(text) as unknown;
  }

  if (openaiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API Error: ${res.statusText}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenAI");
    return JSON.parse(text) as unknown;
  }

  throw new Error("No AI API keys configured");
}

export const generateClassInsightsServerFn = createServerFn({ method: "POST" })
  .validator((d: AnalyticsDashboardData) => d)
  .handler(async ({ data }) => {
    try {
      const prompt = `
You are an AI assistant analyzing school attendance.
Given the following JSON data of the current analytics dashboard:
${JSON.stringify(data, null, 2)}

Output a JSON object with a single key "insights" containing an array of insights matching this exact TypeScript type:
Array<{
  id: string; // unique string
  type: "summary" | "anomaly" | "trend";
  title: string; // short, engaging
  description: string; // 1-2 sentence explanation
  impact: "high" | "medium" | "low";
}>

Ensure the output is ONLY a valid JSON object with the "insights" key.
`;

      const result = await callLLM(prompt);
      if (
        result &&
        typeof result === "object" &&
        "insights" in result &&
        Array.isArray(result.insights)
      ) {
        return result.insights as ClassAIInsight[];
      }
      throw new Error("Invalid shape returned by AI");
    } catch (e) {
      console.warn(
        "[AI Provider] Failed to fetch real AI insights, falling back to heuristics.",
        e,
      );
      // Fallback to heuristic mock service
      return mockAiAnalysisService.generateClassInsights(data);
    }
  });

export const generateStudentInsightsServerFn = createServerFn({ method: "POST" })
  .validator((d: StudentRiskProfile) => d)
  .handler(async ({ data: profile }) => {
    try {
      const prompt = `
You are an AI assistant analyzing a student's attendance risk profile.
Profile:
${JSON.stringify(profile, null, 2)}

Output a JSON object matching this exact TypeScript type:
{
  "summary": string; // e.g. "AI Profile Analysis for [Name]"
  "riskExplanation": string; // 1-2 sentences explaining why they are at this risk level
  "unusualPatterns": string[]; // Array of strings detailing anomalies
  "recommendedActions": Array<{
     "action": string; // short action title
     "type": "communication" | "intervention" | "meeting"
  }>
}

Ensure the output is ONLY a valid JSON object matching the schema.
`;

      const result = await callLLM(prompt);
      if (
        result &&
        typeof result === "object" &&
        "summary" in result &&
        typeof result.summary === "string" &&
        "recommendedActions" in result &&
        Array.isArray(result.recommendedActions)
      ) {
        return result as unknown as StudentAIInsight;
      }
      throw new Error("Invalid shape returned by AI");
    } catch (e) {
      console.warn(
        "[AI Provider] Failed to fetch real student AI insights, falling back to heuristics.",
        e,
      );
      return mockAiAnalysisService.generateStudentInsights(profile);
    }
  });
