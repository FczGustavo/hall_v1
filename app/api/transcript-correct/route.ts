import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

export const maxDuration = 20;

type CorrectRequest = {
  text?: string;
  lang?: string;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export async function POST(req: Request) {
  const { text = "", lang = "pt-BR" } = (await req.json()) as CorrectRequest;
  const input = normalizeText(text);

  if (!input) {
    return Response.json({ correctedText: "" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return Response.json({ correctedText: input });
  }

  const model = process.env.STT_CORRECTION_MODEL?.trim() || process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini";
  const siteUrl = process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000";
  const appName = process.env.OPENROUTER_APP_NAME ?? "HAL Voice Interface";

  const openrouter = createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": siteUrl,
      "X-Title": appName,
    },
  });

  try {
    const result = await generateText({
      model: openrouter(model),
      temperature: 0,
      maxTokens: 120,
      prompt: [
        "Você corrige transcrição automática de fala (STT).",
        "Retorne apenas uma frase corrigida no mesmo idioma, sem explicações, sem aspas.",
        "Preserve intenção e contexto do usuário.",
        "Não invente fatos e não mude o significado.",
        `Idioma esperado: ${lang}.`,
        `Transcrição: ${input}`,
      ].join("\n"),
    });

    const corrected = normalizeText(result.text || "");
    return Response.json({ correctedText: corrected || input });
  } catch {
    return Response.json({ correctedText: input });
  }
}
