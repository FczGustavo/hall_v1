import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

export const maxDuration = 30;

function buildDefaultSystemPrompt(assistantName: string, userName: string) {
  return [
    `Você é ${assistantName}, uma IA avançada, inteligente, lógica, calma e altamente útil.`,
    `Trate o usuário pelo nome ${userName} quando fizer sentido naturalmente.`,
    "Você pode conversar sobre qualquer tema, responder perguntas gerais, ajudar em tarefas técnicas, criativas e do dia a dia.",
    "Sempre responda em português do Brasil, exceto se o usuário pedir outro idioma.",
    "Nunca use emojis.",
    "As respostas serão faladas em voz alta: prefira frases claras, naturais e diretas.",
    "Quando o pedido estiver ambíguo, faça uma pergunta curta para confirmar antes de continuar.",
    "Quando não puder fazer algo, diga variações de: 'Sinto muito, receio que não posso fazer isso.' e ofereça alternativa viável.",
    "Tom: profissional, amigável, confiante e objetivo.",
    "If the user asks to search for a video, play music, or open a website, generate the search URL and output it at the end of your response using the tag [CMD_POPUP: url].",
    "Do not mention the link in your spoken text. Just acknowledge the command and append the tag.",
    "Example: Opening results for you. [CMD_POPUP: https://www.youtube.com/results?search_query=query]",
  ].join(" ");
}

function buildCmdOpenRule() {
  return [
    "If the user asks to search for a video, play music, or open a website, generate the search URL and output it at the end of your response using the tag [CMD_POPUP: url].",
    "Do not mention the link in your spoken text. Just acknowledge the command and append the tag.",
    "Example: Opening results for you. [CMD_POPUP: https://www.youtube.com/results?search_query=query]",
    "Compatibility: if needed, [CMD_OPEN: url] can also be emitted, but prefer [CMD_POPUP: url].",
  ].join(" ");
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const openRouterModel = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
  const appName = process.env.OPENROUTER_APP_NAME ?? "HAL Voice Interface";
  const siteUrl = process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000";
  const assistantName = process.env.OPENROUTER_ASSISTANT_NAME ?? "HAL";
  const userName = process.env.OPENROUTER_USER_NAME ?? "Comandante";
  const defaultSystemPrompt = buildDefaultSystemPrompt(assistantName, userName);
  const customPrompt = process.env.OPENROUTER_SYSTEM_PROMPT?.trim();
  const systemPrompt = customPrompt
    ? `${customPrompt} ${buildCmdOpenRule()}`
    : defaultSystemPrompt;

  if (!apiKey) {
    return new Response(
      "Missing OPENROUTER_API_KEY. Add it to .env.local before starting the server.",
      { status: 500 },
    );
  }

  const openrouter = createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": siteUrl,
      "X-Title": appName,
    },
  });

  const { messages } = (await req.json()) as {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  };

  const result = streamText({
    model: openrouter(openRouterModel),
    messages,
    system: systemPrompt,
    temperature: 0.35,
    maxTokens: 600,
  });

  return result.toDataStreamResponse();
}
