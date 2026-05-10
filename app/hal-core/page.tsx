"use client";

import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HalEye } from "@/components/HalEye";
import { useVoice } from "../../hooks/useVoice";

type ReminderItem = {
  id: string;
  text: string;
  dueAt: number | null;
  createdAt: number;
};

type PendingAction = {
  id: string;
  type: "open-site";
  label: string;
  url: string;
  sourceText: string;
};

type AssistantCommandParse = {
  cleanText: string;
  openUrls: string[];
};

function nowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeUrlTarget(target: string) {
  const normalized = target
    .toLowerCase()
    .replace(/\bponto\b/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  const cleaned = normalized
    .replace(/^(do|da|de|para|pro|pra)\s+/i, "")
    .replace(/^(o|a|os|as)\s+/i, "")
    .replace(/^(site|pagina|página)\s+(do|da|de)?\s*/i, "")
    .trim();

  const known: Record<string, string> = {
    youtube: "https://www.youtube.com",
    github: "https://github.com",
    google: "https://www.google.com",
    gmail: "https://mail.google.com",
    whatsapp: "https://web.whatsapp.com",
    "whatsapp web": "https://web.whatsapp.com",
    linkedin: "https://www.linkedin.com",
    x: "https://x.com",
    twitter: "https://x.com",
  };

  if (known[cleaned]) return known[cleaned];

  for (const [key, value] of Object.entries(known)) {
    if (cleaned.includes(key)) {
      return value;
    }
  }

  if (/^https?:\/\//i.test(target)) return target;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(cleaned)) return `https://${cleaned}`;
  return "";
}

function normalizeForMatch(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWakeCommand(rawText: string, wakeWord: string) {
  const text = normalizeForMatch(rawText);
  const wake = normalizeForMatch(wakeWord);
  if (!text || !wake) {
    return { detected: false, command: "" };
  }

  const tokens = text.split(" ").filter(Boolean);
  const wakeTokens = wake.split(" ").filter(Boolean);
  const wakeSequence = wakeTokens.join(" ");

  for (let i = 0; i <= tokens.length - wakeTokens.length; i += 1) {
    const slice = tokens.slice(i, i + wakeTokens.length).join(" ");
    if (slice !== wakeSequence) continue;

    const command = tokens.slice(i + wakeTokens.length).join(" ").trim();
    return { detected: true, command };
  }

  return { detected: false, command: "" };
}

function parseReminderIntent(text: string) {
  const lower = text.toLowerCase();
  if (!/(lembrete|lembre|lembrar)/.test(lower)) return null;

  const base = text
    .replace(/^(por favor,?\s*)?/i, "")
    .replace(/^(me\s+)?lembre(\s+me)?\s*(de)?\s*/i, "")
    .replace(/^(crie|criar|adicione|adicionar)\s+(um\s+)?lembrete\s*(de)?\s*/i, "")
    .trim();

  if (!base) return null;

  let dueAt: number | null = null;
  let reminderText = base;
  const durationMatch = base.match(/\b(?:daqui\s+a|em)\s+(\d{1,3})\s*(min|minuto|minutos|h|hora|horas)\b/i);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    const ms = unit.startsWith("h") || unit.startsWith("hora") ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
    dueAt = Date.now() + ms;
    reminderText = base.replace(durationMatch[0], "").trim();
  }

  reminderText = reminderText.replace(/[.,;:]+$/g, "").trim();
  if (!reminderText) return null;

  return { reminderText, dueAt };
}

function parseAssistantCommands(text: string): AssistantCommandParse {
  const openUrls: string[] = [];
  const cmdRegex = /\[(?:CMD_OPEN|CMD_POPUP):\s*(https?:\/\/[^\]\s]+)\s*\]/gi;

  const cleanText = text.replace(cmdRegex, (_full, url: string) => {
    openUrls.push(url.trim());
    return "";
  }).replace(/\s+/g, " ").trim();

  return {
    cleanText,
    openUrls,
  };
}

function readNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sensitivityToVadThreshold(sensitivity: number) {
  const clamped = clamp(sensitivity, 0, 100);
  const minThreshold = 0.02;
  const maxThreshold = 0.075;
  const mapped = maxThreshold - (clamped / 100) * (maxThreshold - minThreshold);
  return Number(mapped.toFixed(3));
}

function sensitivityToVadHangMs(sensitivity: number) {
  const clamped = clamp(sensitivity, 0, 100);
  const minHangMs = 260;
  const maxHangMs = 760;
  return Math.round(maxHangMs - (clamped / 100) * (maxHangMs - minHangMs));
}

function vadThresholdToSensitivity(vadThreshold: number) {
  const minThreshold = 0.02;
  const maxThreshold = 0.075;
  const clamped = clamp(vadThreshold, minThreshold, maxThreshold);
  const ratio = (maxThreshold - clamped) / (maxThreshold - minThreshold);
  return Math.round(clamp(ratio * 100, 0, 100));
}

function getConnectionHint(rawMessage: string) {
  const msg = rawMessage.toLowerCase();

  if (msg.includes("missing openrouter_api_key")) {
    return "Configure OPENROUTER_API_KEY no .env.local e reinicie o servidor.";
  }

  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return "Chave OpenRouter invalida. Gere outra chave e atualize OPENROUTER_API_KEY.";
  }

  if (msg.includes("403") || msg.includes("forbidden")) {
    return "Acesso negado pela OpenRouter. Verifique permissoes da conta e do modelo.";
  }

  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) {
    return "Limite de uso atingido. Aguarde ou ajuste seu plano/cota na OpenRouter.";
  }

  if (msg.includes("model") && (msg.includes("not found") || msg.includes("invalid"))) {
    return "Modelo invalido em OPENROUTER_MODEL. Escolha um modelo existente na OpenRouter.";
  }

  if (msg.includes("fetch failed") || msg.includes("network")) {
    return "Falha de rede. Verifique internet, firewall e proxy local.";
  }

  if (msg.includes("external tts failed") || msg.includes("elevenlabs")) {
    return "Falha no TTS externo. Verifique TTS_PROVIDER, ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID.";
  }

  return "Falha inesperada na conexao com a IA. Confira os logs do servidor para detalhes.";
}

export default function HomePage() {
  const [isEmbeddedMode, setIsEmbeddedMode] = useState(false);
  const sttLang = process.env.NEXT_PUBLIC_STT_LANG ?? process.env.NEXT_PUBLIC_VOICE_LANG ?? "pt-BR";
  const ttsLang = process.env.NEXT_PUBLIC_TTS_LANG ?? process.env.NEXT_PUBLIC_VOICE_LANG ?? "pt-BR";
  const voicePitch = readNumberEnv(process.env.NEXT_PUBLIC_TTS_PITCH, 0.62);
  const voiceRate = readNumberEnv(process.env.NEXT_PUBLIC_TTS_RATE, 0.82);
  const voiceVolume = readNumberEnv(process.env.NEXT_PUBLIC_TTS_VOLUME, 1);
  const ttsEngine = process.env.NEXT_PUBLIC_TTS_ENGINE === "browser" ? "browser" : "external";
  const ttsFallback = process.env.NEXT_PUBLIC_TTS_FALLBACK === "true";
  const sttAutoCorrectByDefault = process.env.NEXT_PUBLIC_STT_AUTO_CORRECT !== "false";
  const wakeWordEnabledByDefault = process.env.NEXT_PUBLIC_WAKE_WORD_ENABLED !== "false";
  const wakeTolerantMode = process.env.NEXT_PUBLIC_WAKE_TOLERANT === "true";
  const wakeWord = process.env.NEXT_PUBLIC_WAKE_WORD?.trim() || "hall";
  const wakeWindowMs = readNumberEnv(process.env.NEXT_PUBLIC_WAKE_WORD_WINDOW_MS, 300000);
  const vadEnabled = process.env.NEXT_PUBLIC_VAD_ENABLED !== "false";
  const vadInterrupt = process.env.NEXT_PUBLIC_VAD_INTERRUPT !== "false";
  const vadThresholdEnv = readNumberEnv(process.env.NEXT_PUBLIC_VAD_THRESHOLD, 0.045);
  const vadHangMsEnv = readNumberEnv(process.env.NEXT_PUBLIC_VAD_HANG_MS, 520);
  const sttSensitivityDefault = clamp(
    readNumberEnv(
      process.env.NEXT_PUBLIC_STT_SENSITIVITY,
      vadThresholdToSensitivity(vadThresholdEnv),
    ),
    0,
    100,
  );
  const executorMode = process.env.NEXT_PUBLIC_EXECUTOR_MODE !== "false";
  const preferredVoiceName = process.env.NEXT_PUBLIC_TTS_VOICE_NAME ?? "";
  const defaultAiVoice = process.env.NEXT_PUBLIC_TTS_AI_VOICE ?? process.env.NEXT_PUBLIC_TTS_VOICE_NAME ?? "pt-BR-AntonioNeural";
  const preferredVoiceHints = (process.env.NEXT_PUBLIC_TTS_VOICE_HINTS ?? "")
    .split(",")
    .map((hint) => hint.trim())
    .filter(Boolean);

  const [voiceEngine, setVoiceEngine] = useState<"browser" | "external">(ttsEngine);
  const [interactionMode, setInteractionMode] = useState<"handsfree" | "push">("handsfree");
  const [browserVoiceName, setBrowserVoiceName] = useState(preferredVoiceName);
  const [aiVoice, setAiVoice] = useState(defaultAiVoice);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [wakeArmedUntil, setWakeArmedUntil] = useState(0);
  const [wakeNoticeUntil, setWakeNoticeUntil] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [requireActionConfirmation, setRequireActionConfirmation] = useState(executorMode);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(wakeWordEnabledByDefault);
  const [runtimeApiKey, setRuntimeApiKey] = useState("");
  const [runtimeModel, setRuntimeModel] = useState(openRouterModelFromEnvFallback());
  const [runtimeAiStyle, setRuntimeAiStyle] = useState("Responda de forma natural e direta, menos polida, com frases curtas e objetivas.");
  const [sttAutoCorrectEnabled, setSttAutoCorrectEnabled] = useState(sttAutoCorrectByDefault);
  const [sttSensitivity, setSttSensitivity] = useState(sttSensitivityDefault);
  const [showRuntimeKey, setShowRuntimeKey] = useState(false);

  const runtimeVadThreshold = useMemo(() => {
    if (!vadEnabled) return vadThresholdEnv;
    return sensitivityToVadThreshold(sttSensitivity);
  }, [sttSensitivity, vadEnabled, vadThresholdEnv]);

  const runtimeVadHangMs = useMemo(() => {
    if (!vadEnabled) return vadHangMsEnv;
    return sensitivityToVadHangMs(sttSensitivity);
  }, [sttSensitivity, vadEnabled, vadHangMsEnv]);

  function openRouterModelFromEnvFallback() {
    return process.env.OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite";
  }

  const {
    status: chatStatus,
    messages,
    append,
    error,
    stop,
  } = useChat({
    api: "/api/chat",
    headers: {
      "x-openrouter-api-key": runtimeApiKey,
      "x-openrouter-model": runtimeModel,
      "x-runtime-style": runtimeAiStyle,
    },
    onFinish: (message: { content?: string }) => {
      if (typeof message?.content === "string" && message.content.trim()) {
        setFinishedAssistantText(message.content);
      }
    },
  });

  const {
    status: voiceStatus,
    eyeState,
    transcript,
    interimTranscript,
    utteranceText,
    clearUtteranceText,
    spokenText,
    activeVoiceName,
    ttsProvider,
    browserVoices,
    ttsError,
    vadError,
    isVoiceDetected,
    isSupported,
    startListening,
    stopListening,
    restartListeningHard,
    setThinking,
    speak,
    cancelSpeech,
    reset,
  } = useVoice({
    recognitionLang: sttLang,
    speechLang: ttsLang,
    pitch: voicePitch,
    rate: voiceRate,
    volume: voiceVolume,
    continuous: false,
    interimResults: true,
    preferredVoiceName: browserVoiceName,
    preferredVoiceHints,
    externalVoice: aiVoice,
    ttsEngine: voiceEngine,
    fallbackToBrowser: ttsFallback,
    enableVad: vadEnabled,
    vadThreshold: runtimeVadThreshold,
    vadHangMs: runtimeVadHangMs,
  });

  const aiVoiceOptions = [
    "pt-BR-AntonioNeural",
    "pt-BR-FranciscaNeural",
    "en-US-ChristopherNeural",
    "en-US-JennyNeural",
  ];

  const transcriptRef = useRef("");
  const interimRef = useRef("");
  const pttPressedRef = useRef(false);
  const queuedVoicePromptRef = useRef<string>("");
  const submitVoicePromptRef = useRef<(text?: string) => Promise<void>>(async () => {});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasQueuedVoicePrompt, setHasQueuedVoicePrompt] = useState(false);
  const lastSpokenAssistantRef = useRef("");
  const [finishedAssistantText, setFinishedAssistantText] = useState("");

  const latestAssistantText = useMemo(() => {
    const assistant = [...messages].reverse().find((message) => message.role === "assistant");
    return typeof assistant?.content === "string" ? assistant.content : "";
  }, [messages]);

  const parsedAssistant = useMemo(() => parseAssistantCommands(latestAssistantText), [latestAssistantText]);
  const assistantDisplayText = parsedAssistant.cleanText || latestAssistantText;

  const latestUserText = useMemo(() => {
    const user = [...messages].reverse().find((message) => message.role === "user");
    return typeof user?.content === "string" ? user.content : "";
  }, [messages]);

  const isChatBusy = chatStatus === "submitted" || chatStatus === "streaming";

  const iaChannelStatus = chatStatus === "submitted"
    ? "enviado para IA"
    : chatStatus === "streaming"
      ? "recebendo resposta"
      : chatStatus === "error"
        ? "erro (aguardando reenvio)"
      : "pronto";

  const dispatchOpenUrl = useCallback((url: string) => {
    if (typeof window === "undefined") return;

    if (isEmbeddedMode && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "HAL_OPEN_URL", url }, window.location.origin);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }, [isEmbeddedMode]);

  const connectionHint = useMemo(() => {
    if (!error) return "";
    return getConnectionHint(error.message || "");
  }, [error]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setIsEmbeddedMode(params.get("embed") === "1");
  }, []);

  const executePendingAction = useCallback((action: PendingAction) => {
    if (action.type === "open-site") {
      dispatchOpenUrl(action.url);
      return `Acao executada com sucesso: ${action.label}.`;
    }

    return "Acao pendente nao reconhecida.";
  }, [dispatchOpenUrl]);

  const confirmPendingAction = useCallback(async () => {
    if (!pendingAction) return;
    const executionNote = executePendingAction(pendingAction);
    setPendingAction(null);
    await append({ role: "user", content: `confirmar acao\n\n[SISTEMA: ${executionNote}]` });
  }, [append, executePendingAction, pendingAction]);

  const cancelPendingAction = useCallback(async () => {
    if (!pendingAction) return;
    const canceledLabel = pendingAction.label;
    setPendingAction(null);
    await append({ role: "user", content: `cancelar acao\n\n[SISTEMA: Acao cancelada pelo usuario: ${canceledLabel}.]` });
  }, [append, pendingAction]);

  const autoCorrectTranscript = useCallback(async (rawText: string) => {
    const cleanText = rawText.replace(/\s+/g, " ").trim();
    if (!cleanText) return "";
    if (!sttAutoCorrectEnabled || cleanText.length < 5) return cleanText;

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 450);
      const response = await fetch("/api/transcript-correct", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openrouter-api-key": runtimeApiKey,
          "x-openrouter-model": runtimeModel,
        },
        signal: controller.signal,
        body: JSON.stringify({
          text: cleanText,
          lang: sttLang,
        }),
      });
      window.clearTimeout(timeout);

      if (!response.ok) return cleanText;
      const data = (await response.json()) as { correctedText?: string };
      const corrected = (data.correctedText || "").replace(/\s+/g, " ").trim();
      return corrected || cleanText;
    } catch {
      return cleanText;
    }
  }, [runtimeApiKey, runtimeModel, sttAutoCorrectEnabled, sttLang]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedWakeMode = window.localStorage.getItem("hal-wakeword-enabled");
      if (savedWakeMode === "true" || savedWakeMode === "false") {
        setWakeWordEnabled(savedWakeMode === "true");
      }

      const savedRuntimeKey = window.localStorage.getItem("hal-runtime-openrouter-key");
      if (savedRuntimeKey) {
        setRuntimeApiKey(savedRuntimeKey);
      }

      const savedRuntimeModel = window.localStorage.getItem("hal-runtime-openrouter-model");
      if (savedRuntimeModel) {
        setRuntimeModel(savedRuntimeModel);
      }

      const savedRuntimeStyle = window.localStorage.getItem("hal-runtime-ai-style");
      if (savedRuntimeStyle) {
        setRuntimeAiStyle(savedRuntimeStyle);
      }

      const savedAutoCorrect = window.localStorage.getItem("hal-stt-autocorrect");
      if (savedAutoCorrect === "true" || savedAutoCorrect === "false") {
        setSttAutoCorrectEnabled(savedAutoCorrect === "true");
      }

      const savedSensitivity = Number(window.localStorage.getItem("hal-stt-sensitivity"));
      if (Number.isFinite(savedSensitivity)) {
        setSttSensitivity(clamp(savedSensitivity, 0, 100));
      }

      const savedExecutorMode = window.localStorage.getItem("hal-executor-confirm");
      if (savedExecutorMode === "true" || savedExecutorMode === "false") {
        setRequireActionConfirmation(savedExecutorMode === "true");
      }

      const saved = window.localStorage.getItem("hal-reminders");
      if (!saved) return;
      const parsed = JSON.parse(saved) as ReminderItem[];
      if (Array.isArray(parsed)) {
        setReminders(parsed);
      }
    } catch {
      // ignore corrupted local storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hal-reminders", JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hal-executor-confirm", String(requireActionConfirmation));
  }, [requireActionConfirmation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hal-wakeword-enabled", String(wakeWordEnabled));
  }, [wakeWordEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (runtimeApiKey.trim()) {
      window.localStorage.setItem("hal-runtime-openrouter-key", runtimeApiKey.trim());
    } else {
      window.localStorage.removeItem("hal-runtime-openrouter-key");
    }
  }, [runtimeApiKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (runtimeModel.trim()) {
      window.localStorage.setItem("hal-runtime-openrouter-model", runtimeModel.trim());
    }
  }, [runtimeModel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hal-runtime-ai-style", runtimeAiStyle);
  }, [runtimeAiStyle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hal-stt-autocorrect", String(sttAutoCorrectEnabled));
  }, [sttAutoCorrectEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("hal-stt-sensitivity", String(sttSensitivity));
  }, [sttSensitivity]);

  useEffect(() => {
    if (!reminders.length) return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const due = reminders.filter((item) => item.dueAt && item.dueAt <= now);
      if (!due.length) return;

      for (const item of due) {
        speak(`Lembrete: ${item.text}`);
      }

      setReminders((prev) => prev.filter((item) => !item.dueAt || item.dueAt > now));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [reminders, speak]);

  const enrichWithAgentActions = useCallback(async (rawContent: string) => {
    const original = rawContent.replace(/\s+/g, " ").trim();

    const openMatch = original.match(/\b(?:abra|abrir|open)\b\s+(?:o\s+|a\s+|site\s+)?([^\n]+)/i);
    if (openMatch && typeof window !== "undefined") {
      const target = openMatch[1].trim();
      const url = normalizeUrlTarget(target);
      if (url) {
        const action: PendingAction = {
          id: nowId(),
          type: "open-site",
          label: `abrir ${url}`,
          url,
          sourceText: original,
        };

        if (requireActionConfirmation) {
          setPendingAction(action);
          return `${original}\n\n[SISTEMA: Acao sensivel detectada (${action.label}). Nao execute ainda. Peca confirmacao do usuario com a frase "confirmar acao" ou "cancelar acao".]`;
        }

        const executionNote = executePendingAction(action);
        return `${original}\n\n[SISTEMA: ${executionNote} Responda em uma frase curta.]`;
      }
    }

    const reminderIntent = parseReminderIntent(original);
    if (reminderIntent) {
      const reminder: ReminderItem = {
        id: nowId(),
        text: reminderIntent.reminderText,
        dueAt: reminderIntent.dueAt,
        createdAt: Date.now(),
      };

      setReminders((prev) => [reminder, ...prev].slice(0, 30));

      const dueText = reminder.dueAt
        ? ` para ${new Date(reminder.dueAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        : " sem horario definido";

      return `${original}\n\n[SISTEMA: Ação executada: lembrete criado: "${reminder.text}"${dueText}. Responda confirmando o lembrete.]`;
    }

    const searchMatch = original.match(/(?:pesquise|pesquisar|procure|buscar|busque)\s+(?:na\s+web\s+|na\s+internet\s+|sobre\s+)?(.+)/i);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      if (!query) return original;

      try {
        const response = await fetch("/api/web-search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) return original;
        const data = (await response.json()) as {
          query?: string;
          results?: Array<{ title: string; snippet: string; url: string }>;
        };

        const snippets = (data.results || [])
          .slice(0, 4)
          .map((item, index) => `${index + 1}. ${item.title} - ${item.snippet} (${item.url})`)
          .join("\n");

        if (!snippets) return original;

        return `${original}\n\n[SISTEMA: Resultados de busca web para "${query}":\n${snippets}\nUse os resultados acima como contexto factual inicial e cite fontes quando fizer sentido.]`;
      } catch {
        return original;
      }
    }

    return original;
  }, [executePendingAction, requireActionConfirmation, setReminders]);

  const handleOpenSiteAction = useCallback(async (rawContent: string) => {
    const original = rawContent.replace(/\s+/g, " ").trim();
    const openMatch = original.match(/\b(?:abra|abrir|open)\b\s+(?:o\s+|a\s+|site\s+)?([^\n]+)/i);
    if (!openMatch) return false;

    const target = openMatch[1].trim();
    const url = normalizeUrlTarget(target);
    if (!url) return false;

    const action: PendingAction = {
      id: nowId(),
      type: "open-site",
      label: `abrir ${url}`,
      url,
      sourceText: original,
    };

    if (requireActionConfirmation) {
      setPendingAction(action);
      speak(`Comando entendido. Acao pendente: ${action.label}. Diga confirmar acao ou cancelar acao.`);
      return true;
    }

    const executionNote = executePendingAction(action);
    await append({ role: "user", content: `${original}\n\n[SISTEMA: ${executionNote} Responda em uma frase curta.]` });
    return true;
  }, [append, executePendingAction, requireActionConfirmation, speak]);

  const isWakeArmed = wakeArmedUntil > Date.now();
  const isWakeNoticeVisible = wakeNoticeUntil > Date.now();

  const resolveWakeWordContent = useCallback((rawContent: string) => {
    const content = rawContent.replace(/\s+/g, " ").trim();
    if (!wakeWordEnabled || interactionMode !== "handsfree") {
      return { shouldSend: true, normalizedContent: content };
    }

    if (isWakeArmed) {
      return { shouldSend: true, normalizedContent: content };
    }

    const wakeResult = extractWakeCommand(content, wakeWord);
    if (!wakeResult.detected) {
      return { shouldSend: false, normalizedContent: "" };
    }

    setWakeArmedUntil(Date.now() + wakeWindowMs);
    setWakeNoticeUntil(Date.now() + 3500);

    const escapedWake = wakeWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rawWakeRegex = new RegExp(`\\b${escapedWake}\\b[,:;.!?\\s]*(.*)$`, "i");
    const rawWakeMatch = content.match(rawWakeRegex);
    const rawCommand = (rawWakeMatch?.[1] || "").trim();

    if (rawCommand) {
      return { shouldSend: true, normalizedContent: rawCommand };
    }

    if (wakeResult.command) {
      return { shouldSend: true, normalizedContent: wakeResult.command };
    }

    if (wakeTolerantMode) {
      // Optional tolerant mode for users who prefer fewer wake-word repetitions.
      const tokenCount = content.split(" ").filter(Boolean).length;
      if (tokenCount >= 4 && content.length >= 16) {
        setWakeArmedUntil(Date.now() + wakeWindowMs);
        setWakeNoticeUntil(Date.now() + 2500);
        return { shouldSend: true, normalizedContent: content };
      }
    }

    return { shouldSend: false, normalizedContent: "" };
  }, [interactionMode, isWakeArmed, wakeTolerantMode, wakeWord, wakeWordEnabled, wakeWindowMs]);

  const submitVoicePrompt = useCallback(async (contentOverride?: string) => {
    const rawContent = (contentOverride ?? transcriptRef.current ?? interimRef.current)
      .replace(/\s+/g, " ")
      .trim();
    if (!rawContent) return;

    if (isSubmitting) {
      queuedVoicePromptRef.current = rawContent;
      setHasQueuedVoicePrompt(true);
      return;
    }

    if (isChatBusy) {
      queuedVoicePromptRef.current = rawContent;
      setHasQueuedVoicePrompt(true);
      stop();
      return;
    }

    const { shouldSend, normalizedContent } = resolveWakeWordContent(rawContent);
    if (!shouldSend || !normalizedContent) {
      queuedVoicePromptRef.current = "";
      setHasQueuedVoicePrompt(false);
      reset();
      return;
    }

    queuedVoicePromptRef.current = "";
    setHasQueuedVoicePrompt(false);
    setIsSubmitting(true);
    stopListening();
    reset();
    try {
      const correctedContent = await autoCorrectTranscript(normalizedContent);

      const openHandled = await handleOpenSiteAction(correctedContent);
      if (openHandled) {
        return;
      }

      if (pendingAction) {
        const normalized = normalizeForMatch(correctedContent);
        const wantsConfirm = /\b(confirmar|confirma|confirmo|pode executar|executar|sim)\b/.test(normalized);
        const wantsCancel = /\b(cancelar|cancela|cancele|nao|não|pare)\b/.test(normalized);

        if (wantsCancel) {
          const canceledLabel = pendingAction.label;
          setPendingAction(null);
          await append({ role: "user", content: `${correctedContent}\n\n[SISTEMA: Acao pendente cancelada pelo usuario: ${canceledLabel}.]` });
          return;
        }

        if (wantsConfirm) {
          const executionNote = executePendingAction(pendingAction);
          setPendingAction(null);
          await append({ role: "user", content: `${correctedContent}\n\n[SISTEMA: ${executionNote}]` });
          return;
        }

        await append({
          role: "user",
          content: `${correctedContent}\n\n[SISTEMA: Existe uma acao pendente (${pendingAction.label}). Peca confirmacao explicita: "confirmar acao" ou "cancelar acao".]`,
        });
        return;
      }

      const enrichedContent = await enrichWithAgentActions(correctedContent);
      await append({ role: "user", content: enrichedContent });
    } finally {
      setIsSubmitting(false);
    }
  }, [append, autoCorrectTranscript, enrichWithAgentActions, executePendingAction, handleOpenSiteAction, isChatBusy, isSubmitting, pendingAction, reset, resolveWakeWordContent, stop, stopListening]);

  // Keep ref to always call latest submitVoicePrompt from utterance effect
  submitVoicePromptRef.current = submitVoicePrompt;

  // When speech ends naturally (continuous=false), submit the captured utterance
  useEffect(() => {
    if (!utteranceText) return;
    const text = utteranceText;
    clearUtteranceText();
    void submitVoicePromptRef.current(text);
  }, [utteranceText, clearUtteranceText]);

  useEffect(() => {
    if (isChatBusy) return;
    if (isSubmitting) return;

    const queued = queuedVoicePromptRef.current.trim();
    if (!queued) return;

    queuedVoicePromptRef.current = "";
    setHasQueuedVoicePrompt(false);
    void submitVoicePrompt(queued);
  }, [isChatBusy, isSubmitting, submitVoicePrompt]);

  useEffect(() => {
    if (!wakeArmedUntil) return;
    const remainingMs = wakeArmedUntil - Date.now();
    if (remainingMs <= 0) {
      setWakeArmedUntil(0);
      return;
    }

    const timer = window.setTimeout(() => {
      setWakeArmedUntil(0);
    }, remainingMs + 20);

    return () => {
      window.clearTimeout(timer);
    };
  }, [wakeArmedUntil]);

  useEffect(() => {
    if (!wakeNoticeUntil) return;
    const remainingMs = wakeNoticeUntil - Date.now();
    if (remainingMs <= 0) {
      setWakeNoticeUntil(0);
      return;
    }

    const timer = window.setTimeout(() => {
      setWakeNoticeUntil(0);
    }, remainingMs + 20);

    return () => {
      window.clearTimeout(timer);
    };
  }, [wakeNoticeUntil]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    interimRef.current = interimTranscript;
  }, [interimTranscript]);

  useEffect(() => {
    const isThinking = chatStatus === "submitted" || chatStatus === "streaming";
    setThinking(isThinking);
  }, [chatStatus, setThinking]);

  useEffect(() => {
    if (!finishedAssistantText) return;
    if (lastSpokenAssistantRef.current === finishedAssistantText) return;

    const parsed = parseAssistantCommands(finishedAssistantText);
    for (const url of parsed.openUrls) {
      dispatchOpenUrl(url);
    }

    lastSpokenAssistantRef.current = finishedAssistantText;
    speak(parsed.cleanText || finishedAssistantText);
  }, [dispatchOpenUrl, finishedAssistantText, speak]);

  useEffect(() => {
    if (isChatBusy) return;
    if (!latestAssistantText) return;
    if (lastSpokenAssistantRef.current === latestAssistantText) return;

    const parsed = parseAssistantCommands(latestAssistantText);
    for (const url of parsed.openUrls) {
      dispatchOpenUrl(url);
    }

    lastSpokenAssistantRef.current = latestAssistantText;
    speak(parsed.cleanText || latestAssistantText);
  }, [dispatchOpenUrl, isChatBusy, latestAssistantText, speak]);

  // Handsfree: restart listening whenever idle and not busy
  useEffect(() => {
    if (interactionMode !== "handsfree") return;

    const coordinator = window.setInterval(() => {
      if (isChatBusy || isSubmitting) return;
      if (isSupported && voiceStatus === "idle") {
        startListening();
      }
    }, 300);

    return () => {
      window.clearInterval(coordinator);
    };
  }, [
    interactionMode,
    isChatBusy,
    isSubmitting,
    isSupported,
    startListening,
    voiceStatus,
  ]);

  useEffect(() => {
    if (!vadEnabled || !vadInterrupt) return;
    if (interactionMode !== "handsfree") return;
    if (voiceStatus !== "speaking") return;
    if (!isVoiceDetected) return;

    cancelSpeech();
    startListening();
  }, [cancelSpeech, interactionMode, isVoiceDetected, startListening, vadEnabled, vadInterrupt, voiceStatus]);

  useEffect(() => {
    if (interactionMode !== "push") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        cancelSpeech();
        if (!isChatBusy) {
          startListening();
        }
        return;
      }

      if (event.code !== "Space" || event.repeat) return;

      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) {
        return;
      }

      event.preventDefault();
      pttPressedRef.current = true;
      cancelSpeech();
      startListening();
    };

    const handleKeyUp = async (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();

      if (!pttPressedRef.current) return;
      pttPressedRef.current = false;

      stopListening();
      await new Promise((resolve) => setTimeout(resolve, 180));
      await submitVoicePrompt();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [cancelSpeech, interactionMode, isChatBusy, startListening, stopListening, submitVoicePrompt]);

  const currentUserLine = `${transcript}${interimTranscript ? ` ${interimTranscript}` : ""}`.trim();
  const hudStatus = isSupported
    ? ttsError
      ? "Falha de voz"
      : isSubmitting
        ? "Enviando"
          : hasQueuedVoicePrompt
            ? "Fila de envio"
        : voiceStatus === "listening"
          ? "Escutando"
          : chatStatus === "submitted"
            ? "Processando"
            : chatStatus === "streaming"
              ? "Respondendo"
              : voiceStatus === "speaking"
                ? "Falando"
                : "Pronto"
    : "Sem suporte";

  const hudHint = voiceStatus === "speaking"
    ? vadInterrupt
      ? "Interromper: fale por cima, ESC ou clique no olho."
      : "Interromper: ESC ou clique no olho."
    : interactionMode === "handsfree"
      ? wakeWordEnabled
        ? isWakeArmed
          ? "Wake ativa: ouvindo sem repetir a palavra-chave."
          : `Diga \"${wakeWord}\" uma vez para ativar por 5 minutos (ou fale uma frase completa direto).`
        : "Modo livre: fale e pause por 0,8s para enviar."
      : "Push-to-talk: segure ESPACO para falar.";

  return (
    <main className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black px-6">
      <button
        type="button"
        aria-label={interactionMode === "handsfree" ? "Toggle microphone" : "Hold to talk"}
        className="group relative rounded-full"
        onMouseDown={
          interactionMode === "push"
            ? () => {
                pttPressedRef.current = true;
                cancelSpeech();
                startListening();
              }
            : undefined
        }
        onMouseUp={
          interactionMode === "push"
            ? async () => {
                if (!pttPressedRef.current) return;
                pttPressedRef.current = false;
                stopListening();
                await submitVoicePrompt();
              }
            : undefined
        }
        onClick={
          interactionMode === "handsfree"
            ? () => {
                if (voiceStatus === "listening") {
                  stopListening();
                  return;
                }

                cancelSpeech();
                startListening();
              }
            : undefined
        }
      >
        <HalEye state={eyeState} className="transition-opacity group-hover:opacity-95" />
      </button>

      <div className="pointer-events-auto absolute bottom-5 right-5 flex max-h-[85vh] w-[min(92vw,29rem)] flex-col overflow-y-auto rounded-2xl border border-red-500/20 bg-black/70 p-4 font-[Space_Mono] text-[13px] text-zinc-200 backdrop-blur-md scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-700 sm:bottom-6 sm:right-6 sm:p-5">
        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">HAL INTERFACE</p>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            Conversa
            <select
              value={interactionMode}
              onChange={(event) => setInteractionMode(event.target.value as "handsfree" | "push")}
              className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
            >
              <option value="handsfree">Livre (sem segurar)</option>
              <option value="push">Push-to-talk</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            Motor de Voz
            <select
              value={voiceEngine}
              onChange={(event) => setVoiceEngine(event.target.value as "browser" | "external")}
              className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
            >
              <option value="external">Edge Neural (API)</option>
              <option value="browser">Web Speech API</option>
            </select>
          </label>

          {voiceEngine === "external" ? (
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Voz da IA
              <select
                value={aiVoice}
                onChange={(event) => setAiVoice(event.target.value)}
                className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
              >
                {aiVoiceOptions.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Voz Web
              <select
                value={browserVoiceName}
                onChange={(event) => setBrowserVoiceName(event.target.value)}
                className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
              >
                <option value="">Automatica</option>
                {browserVoices.map((voice) => (
                  <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <p className="mt-2 min-h-[2.2rem] text-sm leading-relaxed text-zinc-300">
          {isSupported
            ? currentUserLine || (interactionMode === "handsfree" ? "Fale livremente. Clique no olho para pausar/retomar." : "Segure ESPACO para falar")
            : "Este navegador nao suporta reconhecimento de voz"}
        </p>
        <p className="mt-2 min-h-[2.2rem] text-sm leading-relaxed text-orange-200/95">
          {spokenText || assistantDisplayText}
        </p>

        <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-red-300/80">Estado: {hudStatus}</p>
        <p className="mt-1 text-[11px] text-zinc-400">{hudHint}</p>

        {error ? (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/8 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-red-300">ERRO DE CONEXAO</p>
            <p className="mt-1 text-xs leading-relaxed text-red-200">{connectionHint}</p>
            <p className="mt-1 truncate text-[11px] text-red-300/85">{error.message}</p>
          </div>
        ) : null}

        {ttsError ? (
          <div className="mt-3 rounded-xl border border-orange-500/35 bg-orange-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-orange-200">ERRO TTS</p>
            <p className="mt-1 text-xs leading-relaxed text-orange-100/90">{ttsError}</p>
          </div>
        ) : null}

        {vadError ? (
          <div className="mt-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-amber-200">VAD</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/90">{vadError}</p>
          </div>
        ) : null}

        {isWakeNoticeVisible ? (
          <div className="mt-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-200">WAKE WORD</p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-100/90">
              Entendi. Estou ouvindo agora e a wake word fica ativa por 5 minutos.
            </p>
          </div>
        ) : null}

        <details className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/45 p-2">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-zinc-500">Status detalhado</summary>
          <div className="mt-1 space-y-0.5">
            <p className="truncate text-[11px] text-cyan-300">IA: {iaChannelStatus}{hasQueuedVoicePrompt ? " · mensagem em fila" : ""}</p>
            <p className="truncate text-[11px] text-zinc-400">Motor: {ttsProvider || (voiceEngine === "external" ? "Edge TTS" : "Web Speech API")}</p>
            <p className="truncate text-[11px] text-zinc-400">Voz: {activeVoiceName || "Padrao do sistema"}</p>
            <p className="truncate text-[11px] text-zinc-400">Wake: {wakeWordEnabled ? wakeWord : "off"} {isWakeArmed ? "(ativa)" : ""}</p>
            <p className="truncate text-[11px] text-zinc-400">VAD: {vadEnabled ? (isVoiceDetected ? "voz" : "silencio") : "off"} · sens. {sttSensitivity}%</p>
            <p className="mt-1 truncate text-[11px] text-zinc-400">Enviado: {latestUserText || "(nenhum)"}</p>
            <p className="truncate text-[11px] text-orange-200/80">Recebido: {assistantDisplayText || "(aguardando)"}</p>
          </div>
        </details>

        <details className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/45 p-2">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.16em] text-zinc-500">Painel de Configuracao</summary>
          <div className="mt-2 space-y-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              OpenRouter API Key (runtime)
              <div className="flex gap-2">
                <input
                  type={showRuntimeKey ? "text" : "password"}
                  value={runtimeApiKey}
                  onChange={(event) => setRuntimeApiKey(event.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => setShowRuntimeKey((prev) => !prev)}
                  className="rounded-md border border-zinc-600 bg-zinc-800/70 px-2 py-1 text-[11px] text-zinc-200"
                >
                  {showRuntimeKey ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Modelo
              <input
                type="text"
                value={runtimeModel}
                onChange={(event) => setRuntimeModel(event.target.value)}
                placeholder="google/gemini-3.1-flash-lite"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
              />
            </label>

            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Estilo da IA
              <textarea
                value={runtimeAiStyle}
                onChange={(event) => setRuntimeAiStyle(event.target.value)}
                rows={3}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[12px] normal-case tracking-normal text-zinc-100"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSttAutoCorrectEnabled((prev) => !prev)}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  sttAutoCorrectEnabled
                    ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                    : "border-zinc-500/40 bg-zinc-700/35 text-zinc-200"
                }`}
              >
                Auto-correcao STT: {sttAutoCorrectEnabled ? "ON" : "OFF"}
              </button>
            </div>

            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Sensibilidade de escuta ({sttSensitivity}%)
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={sttSensitivity}
                onChange={(event) => {
                  setSttSensitivity(clamp(Number(event.target.value), 0, 100));
                }}
                className="w-full accent-cyan-400"
              />
              <p className="text-[11px] normal-case tracking-normal text-zinc-400">
                0 = anti-ruido (menos falso positivo) | 100 = capta ate fala baixa.
              </p>
            </label>
          </div>
        </details>

        {pendingAction ? (
          <div className="mt-3 rounded-xl border border-cyan-500/35 bg-cyan-500/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">MODO EXECUTOR</p>
            <p className="mt-1 text-xs leading-relaxed text-cyan-100/90">Acao pendente: {pendingAction.label}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void confirmPendingAction();
                }}
                className="rounded-md border border-cyan-400/45 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-100"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => {
                  void cancelPendingAction();
                }}
                className="rounded-md border border-zinc-500/40 bg-zinc-700/35 px-2 py-1 text-[11px] text-zinc-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/45 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextValue = !requireActionConfirmation;
                setRequireActionConfirmation(nextValue);

                if (!nextValue && pendingAction) {
                  const executionNote = executePendingAction(pendingAction);
                  setPendingAction(null);
                  void append({ role: "user", content: `confirmacao desativada\n\n[SISTEMA: ${executionNote}]` });
                }
              }}
              className={`rounded-md border px-2 py-1 text-[11px] ${
                requireActionConfirmation
                  ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                  : "border-lime-500/45 bg-lime-500/20 text-lime-100"
              }`}
            >
              Confirmacao de acoes: {requireActionConfirmation ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={() => {
                setWakeWordEnabled((prev) => !prev);
              }}
              className={`rounded-md border px-2 py-1 text-[11px] ${
                wakeWordEnabled
                  ? "border-emerald-500/45 bg-emerald-500/20 text-emerald-100"
                  : "border-zinc-500/40 bg-zinc-700/35 text-zinc-200"
              }`}
            >
              Wake word: {wakeWordEnabled ? "ON" : "OFF"}
            </button>
            <span className="text-[11px] text-zinc-500">Lembretes: {reminders.length}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
