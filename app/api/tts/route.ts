import { tts } from "edge-tts/out/index.js";

type TTSRequest = {
  text: string;
  lang?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toEdgeRate(value: number) {
  const percent = Math.round((value - 1) * 100);
  const limited = Math.min(100, Math.max(-50, percent));
  return `${limited >= 0 ? "+" : ""}${limited}%`;
}

function toEdgePitch(value: number) {
  const hz = Math.round((value - 1) * 100);
  const limited = Math.min(80, Math.max(-80, hz));
  return `${limited >= 0 ? "+" : ""}${limited}Hz`;
}

function defaultVoiceByLang(lang: string) {
  const normalized = lang.toLowerCase();
  if (normalized.startsWith("pt-br")) return "pt-BR-AntonioNeural";
  return "en-US-ChristopherNeural";
}

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json()) as TTSRequest;
  const text = body.text?.trim();
  const lang = body.lang?.trim() || "pt-BR";
  const rate = clamp(body.rate ?? 0.96, 0.25, 4);
  const pitch = clamp(body.pitch ?? 1, 0.5, 2);

  if (!text) {
    return new Response("Missing text for TTS", { status: 400 });
  }

  const voice = body.voice?.trim() || process.env.TTS_VOICE?.trim() || defaultVoiceByLang(lang);

  try {
    const audioBuffer = await tts(text, {
      voice,
      rate: toEdgeRate(rate),
      pitch: toEdgePitch(pitch),
      volume: "+0%",
    });

    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-TTS-Provider": "Edge TTS",
        "X-TTS-Voice": voice,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Edge TTS error";
    return new Response(`Edge TTS error: ${message}`, { status: 502 });
  }
}
