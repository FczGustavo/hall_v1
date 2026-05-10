"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HalEyeState } from "@/components/HalEye";

type VoiceStatus = "idle" | "listening" | "speaking" | "thinking";

type UseVoiceOptions = {
  recognitionLang?: string;
  speechLang?: string;
  pitch?: number;
  rate?: number;
  volume?: number;
  continuous?: boolean;
  interimResults?: boolean;
  preferredVoiceName?: string;
  preferredVoiceHints?: string[];
  externalVoice?: string;
  ttsEngine?: "browser" | "external";
  fallbackToBrowser?: boolean;
  enableVad?: boolean;
  vadThreshold?: number;
  vadHangMs?: number;
};

type BrowserVoice = {
  name: string;
  lang: string;
};

type UseVoiceReturn = {
  status: VoiceStatus;
  eyeState: HalEyeState;
  transcript: string;
  interimTranscript: string;
  utteranceText: string;
  clearUtteranceText: () => void;
  spokenText: string;
  activeVoiceName: string;
  ttsProvider: string;
  browserVoices: BrowserVoice[];
  ttsError: string;
  vadError: string;
  isVoiceDetected: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
  restartListeningHard: () => void;
  setThinking: (value: boolean) => void;
  speak: (text: string) => void;
  cancelSpeech: () => void;
  reset: () => void;
};

type AnySpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          0: { transcript: string };
        }>;
      }) => void)
    | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => AnySpeechRecognition;
    webkitSpeechRecognition?: new () => AnySpeechRecognition;
  }
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const {
    recognitionLang = "pt-BR",
    speechLang = "pt-BR",
    pitch = 0.62,
    rate = 0.82,
    volume = 1,
    continuous = false,
    preferredVoiceName = "",
    preferredVoiceHints = [],
    enableVad = false,
    vadThreshold = 0.028,
    vadHangMs = 320,
  } = options;

  const recognitionRef = useRef<AnySpeechRecognition | null>(null);
  const recognitionActiveRef = useRef(false);
  const recognitionStartingRef = useRef(false);
  const recognitionSessionRef = useRef(0);
  const userStoppedListeningRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const hardRestartTimerRef = useRef<number | null>(null);
  const networkBackoffUntilRef = useRef(0);
  const consecutiveNetworkErrorsRef = useRef(0);
  const lastCooldownLogAtRef = useRef(0);
  const startFailureCooldownUntilRef = useRef(0);
  const speakingRef = useRef(false);
  const thinkingRef = useRef(false);
  const browserUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const vadLastVoiceRef = useRef(0);
  const transcriptAccumRef = useRef("");
  const interimAccumRef = useRef("");

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [spokenText, setSpokenText] = useState("");
  const [activeVoiceName, setActiveVoiceName] = useState("");
  const [ttsProvider, setTtsProvider] = useState("");
  const [browserVoices, setBrowserVoices] = useState<BrowserVoice[]>([]);
  const [ttsError, setTtsError] = useState("");
  const [vadError, setVadError] = useState("");
  const [utteranceText, setUtteranceText] = useState("");
  const clearUtteranceText = useCallback(() => setUtteranceText(""), []);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [sttLastError, setSttLastError] = useState("");
  const [sttBackoffUntil, setSttBackoffUntil] = useState(0);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied" | "prompt">("unknown");
  const [isSupported, setIsSupported] = useState(false);

  const clearRestartTimer = useCallback(() => {
    if (!restartTimerRef.current) return;
    window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  const clearHardRestartTimer = useCallback(() => {
    if (!hardRestartTimerRef.current) return;
    window.clearTimeout(hardRestartTimerRef.current);
    hardRestartTimerRef.current = null;
  }, []);

  const stopListening = useCallback(() => {
    userStoppedListeningRef.current = true;
    clearRestartTimer();
    recognitionStartingRef.current = false;
    recognitionActiveRef.current = false;
    recognitionSessionRef.current += 1;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
    }
  }, [clearRestartTimer]);

  const waitForVoices = useCallback(async () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return [] as SpeechSynthesisVoice[];
    }

    const synth = window.speechSynthesis;
    const initialVoices = synth.getVoices();
    if (initialVoices.length) return initialVoices;

    return await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        synth.removeEventListener("voiceschanged", onVoicesChanged);
        window.clearTimeout(timeoutId);
        resolve(synth.getVoices());
      };

      const onVoicesChanged = () => {
        finish();
      };

      const timeoutId = window.setTimeout(finish, 1200);
      synth.addEventListener("voiceschanged", onVoicesChanged);
    });
  }, []);

  const pickPreferredVoice = useCallback((voices: SpeechSynthesisVoice[]) => {
    if (!voices.length) return null;

    const langKey = speechLang.toLowerCase();

    const exactPreferred = voices.find((voice) => voice.name === preferredVoiceName);
    if (exactPreferred) return exactPreferred;

    const normalizedHints = preferredVoiceHints.map((hint) => hint.trim().toLowerCase()).filter(Boolean);
    if (normalizedHints.length) {
      const byHints = voices.find((voice) => {
        const base = `${voice.name} ${voice.lang}`.toLowerCase();
        return normalizedHints.every((hint) => base.includes(hint));
      });
      if (byHints) return byHints;
    }

    const premiumVoices = voices.filter((voice) => /(natural|online|neural)/i.test(voice.name));
    const premiumLang = premiumVoices.filter((voice) => voice.lang.toLowerCase().startsWith(langKey));

    const masculineKeywords = ["antonio", "david", "mark", "arthur", "christopher", "caio", "male", "mascul"];
    const premiumMasculine = premiumLang.find((voice) => {
      const name = voice.name.toLowerCase();
      return masculineKeywords.some((keyword) => name.includes(keyword));
    });
    if (premiumMasculine) return premiumMasculine;

    if (premiumLang.length) return premiumLang[0];
    if (premiumVoices.length) return premiumVoices[0];

    const langVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith(langKey));
    return langVoice || voices[0];
  }, [preferredVoiceHints, preferredVoiceName, speechLang]);

  const cancelSpeech = useCallback(() => {
    if (typeof window === "undefined") return;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    browserUtteranceRef.current = null;
    speakingRef.current = false;
    setSpokenText("");
    setTtsProvider("");
    setTtsError("");
    setStatus(thinkingRef.current ? "thinking" : "idle");
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !text.trim()) return;

    if (!("speechSynthesis" in window)) {
      setTtsError("Web Speech API indisponivel neste navegador.");
      return;
    }

    const normalizedText = text.replace(/\s+/g, " ").trim();
    if (!normalizedText) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
    }

    setTtsError("");

    void (async () => {
      try {
        const synth = window.speechSynthesis;
        const voices = await waitForVoices();
        const selectedVoice = pickPreferredVoice(voices);

        synth.cancel();
        browserUtteranceRef.current = null;

        const utterance = new SpeechSynthesisUtterance(normalizedText);
        browserUtteranceRef.current = utterance;
        utterance.lang = speechLang || "pt-BR";
        utterance.pitch = pitch;
        utterance.rate = rate;
        utterance.volume = volume;

        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }

        utterance.onstart = () => {
          speakingRef.current = true;
          setSpokenText(normalizedText);
          setActiveVoiceName(selectedVoice?.name || "Web Speech API");
          setTtsProvider("Web Speech API");
          setStatus("speaking");
        };

        utterance.onend = () => {
          speakingRef.current = false;
          browserUtteranceRef.current = null;
          setStatus(thinkingRef.current ? "thinking" : "idle");
        };

        utterance.onerror = () => {
          speakingRef.current = false;
          browserUtteranceRef.current = null;
          setTtsError("Falha ao sintetizar voz no navegador.");
          setStatus(thinkingRef.current ? "thinking" : "idle");
        };

        synth.speak(utterance);
      } catch {
        speakingRef.current = false;
        setTtsError("Falha ao inicializar a voz do navegador.");
        setStatus(thinkingRef.current ? "thinking" : "idle");
      }
    })();
  }, [pickPreferredVoice, pitch, rate, speechLang, volume, waitForVoices]);

  const startListening = useCallback(() => {
    if (!isSupported || typeof window === "undefined") return;

    const now = Date.now();
    if (startFailureCooldownUntilRef.current > now) {
      return;
    }

    if (networkBackoffUntilRef.current > now) {
      if (now - lastCooldownLogAtRef.current > 2000) {
        const waitMs = networkBackoffUntilRef.current - now;
        console.warn(`[HALL STT] aguardando ${Math.ceil(waitMs / 1000)}s para nova tentativa apos erro de rede.`);
        lastCooldownLogAtRef.current = now;
      }
      return;
    }

    if (speakingRef.current) {
      cancelSpeech();
    }

    setTtsError("");

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("SpeechRecognition API nao suportada neste navegador (window.SpeechRecognition/window.webkitSpeechRecognition indisponiveis).");
      return;
    }

    userStoppedListeningRef.current = false;
    clearRestartTimer();

    if (!recognitionRef.current) {
      recognitionRef.current = new SpeechRecognition();
    }

    const recognition = recognitionRef.current;
    const sessionId = recognitionSessionRef.current + 1;
    recognitionSessionRef.current = sessionId;

    if (recognitionActiveRef.current || recognitionStartingRef.current) {
      if (status === "listening") return;

      recognitionActiveRef.current = false;
      recognitionStartingRef.current = false;
      try {
        recognition.stop();
      } catch {
        // no-op
      }
    }

    recognition.lang = recognitionLang || "pt-BR";
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const tryRestartRecognition = () => {
      if (userStoppedListeningRef.current) return;
      if (thinkingRef.current || speakingRef.current) return;
      if (recognitionSessionRef.current !== sessionId) return;
      if (recognitionStartingRef.current || recognitionActiveRef.current) return;

      recognitionStartingRef.current = true;
      try {
        recognition.start();
      } catch (error) {
        recognitionStartingRef.current = false;
        const errorName = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "UnknownError";
        setSttLastError(`start-${errorName}`);

        if (errorName === "InvalidStateError") {
          // Browser is still transitioning recognition state; retry shortly.
          startFailureCooldownUntilRef.current = Date.now() + 700;
          return;
        }

        startFailureCooldownUntilRef.current = Date.now() + 1500;
      }
    };

    recognition.onstart = () => {
      if (recognitionSessionRef.current !== sessionId) return;
      console.info("[HALL STT] reconhecimento iniciado");
      consecutiveNetworkErrorsRef.current = 0;
      networkBackoffUntilRef.current = 0;
      setSttBackoffUntil(0);
      setSttLastError("");
      recognitionStartingRef.current = false;
      recognitionActiveRef.current = true;
      setStatus("listening");
    };

    recognition.onresult = (event) => {
      if (recognitionSessionRef.current !== sessionId) return;
      let finalBuffer = "";
      let interimBuffer = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const textResult = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalBuffer += `${textResult} `;
        } else {
          interimBuffer += textResult;
        }
      }

      if (finalBuffer.trim()) {
        transcriptAccumRef.current = `${transcriptAccumRef.current} ${finalBuffer}`.trim();
        setTranscript((prev) => `${prev} ${finalBuffer}`.trim());
      }

      interimAccumRef.current = interimBuffer.trim();
      setInterimTranscript(interimBuffer.trim());
    };

    recognition.onerror = (event) => {
      if (recognitionSessionRef.current !== sessionId) return;

      const errorCode = event.error || "unknown";
      setSttLastError(errorCode);
      if (errorCode === "no-speech") {
        console.info("[HALL STT] no-speech detectado");
      } else if (errorCode === "network") {
        console.warn("[HALL STT] erro de rede no reconhecimento");
      } else if (errorCode === "aborted") {
        console.info("[HALL STT] reconhecimento abortado");
      } else {
        console.error("Speech Recognition Error:", errorCode);
      }

      recognitionStartingRef.current = false;
      recognitionActiveRef.current = false;
      setStatus(thinkingRef.current ? "thinking" : speakingRef.current ? "speaking" : "idle");

      if (errorCode === "network") {
        consecutiveNetworkErrorsRef.current += 1;
        const backoffMs = Math.min(30000, 2000 * (2 ** (consecutiveNetworkErrorsRef.current - 1)));
        networkBackoffUntilRef.current = Date.now() + backoffMs;
        setSttBackoffUntil(networkBackoffUntilRef.current);
        console.warn("A API de rede do Edge falhou. Verifique as configuracoes de privacidade do navegador.");
        console.warn(`[HALL STT] aplicando backoff de ${Math.ceil(backoffMs / 1000)}s antes de nova tentativa.`);
      }

      if (errorCode === "not-allowed" || errorCode === "service-not-allowed" || errorCode === "audio-capture") {
        userStoppedListeningRef.current = true;
        setMicPermission("denied");
        console.warn("O Edge bloqueou o microfone para reconhecimento de voz. Permita o microfone nas configuracoes do site.");
      }

      if (errorCode === "no-speech" && !userStoppedListeningRef.current) {
        if (networkBackoffUntilRef.current > Date.now()) return;
        console.info("[HALL STT] no-speech detectado, tentando reiniciar automaticamente");
        clearRestartTimer();
        restartTimerRef.current = window.setTimeout(() => {
          tryRestartRecognition();
        }, 550);
      }
    };

    recognition.onend = () => {
      if (recognitionSessionRef.current !== sessionId) return;
      console.info("[HALL STT] reconhecimento encerrado");
      recognitionStartingRef.current = false;
      recognitionActiveRef.current = false;

      if (!continuous) {
        const accumulated = `${transcriptAccumRef.current} ${interimAccumRef.current}`.replace(/\s+/g, " ").trim();
        transcriptAccumRef.current = "";
        interimAccumRef.current = "";

        if (!userStoppedListeningRef.current && accumulated) {
          // Natural speech end with captured text — signal page to submit
          setUtteranceText(accumulated);
          setStatus(thinkingRef.current ? "thinking" : speakingRef.current ? "speaking" : "idle");
          return;
        }

        if (!userStoppedListeningRef.current && !thinkingRef.current && !speakingRef.current) {
          // Natural end with no text (silence) — auto-restart listening
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            if (userStoppedListeningRef.current) return;
            if (recognitionSessionRef.current !== sessionId) return;
            if (thinkingRef.current || speakingRef.current) return;
            tryRestartRecognition();
          }, 200);
          return;
        }
      }

      if (thinkingRef.current) {
        setStatus("thinking");
        return;
      }

      setStatus(speakingRef.current ? "speaking" : "idle");
    };

    recognitionStartingRef.current = true;
    try {
      recognition.start();
    } catch (error) {
      recognitionStartingRef.current = false;
      const errorName = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "UnknownError";
      setSttLastError(`start-${errorName}`);

      if (errorName === "InvalidStateError") {
        startFailureCooldownUntilRef.current = Date.now() + 700;
        console.info("[HALL STT] recognition.start() em transicao de estado; nova tentativa curta.");
        return;
      }

      startFailureCooldownUntilRef.current = Date.now() + 1500;
      console.warn(`[HALL STT] falha ao chamar recognition.start() (${errorName}).`);
    }
  }, [cancelSpeech, clearRestartTimer, continuous, isSupported, recognitionLang, status]);

  const restartListeningHard = useCallback(() => {
    userStoppedListeningRef.current = true;
    clearRestartTimer();
    clearHardRestartTimer();
    recognitionStartingRef.current = false;
    recognitionActiveRef.current = false;
    recognitionSessionRef.current += 1;

    if (recognitionRef.current) {
      recognitionRef.current.onstart = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
      recognitionRef.current = null;
    }

    startFailureCooldownUntilRef.current = 0;
    networkBackoffUntilRef.current = 0;
    consecutiveNetworkErrorsRef.current = 0;
    setSttBackoffUntil(0);
    setSttLastError("");
    setStatus(thinkingRef.current ? "thinking" : speakingRef.current ? "speaking" : "idle");

    hardRestartTimerRef.current = window.setTimeout(() => {
      if (thinkingRef.current || speakingRef.current) return;
      startListening();
    }, 180);
  }, [clearHardRestartTimer, clearRestartTimer, startListening]);

  const setThinking = useCallback((value: boolean) => {
    thinkingRef.current = value;
    if (value) {
      setStatus("thinking");
      return;
    }

    setStatus(speakingRef.current ? "speaking" : "idle");
  }, []);

  const reset = useCallback(() => {
    clearRestartTimer();
    clearHardRestartTimer();
    userStoppedListeningRef.current = true;
    recognitionSessionRef.current += 1;
    recognitionStartingRef.current = false;
    recognitionActiveRef.current = false;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    browserUtteranceRef.current = null;
    setTranscript("");
    setInterimTranscript("");
    setSpokenText("");
    setSttLastError("");
    setSttBackoffUntil(0);
    transcriptAccumRef.current = "";
    interimAccumRef.current = "";
    thinkingRef.current = false;
    speakingRef.current = false;
    setStatus("idle");
  }, [clearHardRestartTimer, clearRestartTimer]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const synth = window.speechSynthesis;
    void synth.getVoices();

    const updateVoices = () => {
      const voices = synth
        .getVoices()
        .map((voice) => ({ name: voice.name, lang: voice.lang }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setBrowserVoices(voices);
    };

    updateVoices();
    synth.addEventListener("voiceschanged", updateVoices);

    return () => {
      synth.removeEventListener("voiceschanged", updateVoices);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(Boolean(SpeechRecognition));

    if (!SpeechRecognition) {
      console.error("SpeechRecognition API nao detectada. Use um navegador compativel com reconhecimento de voz.");
    }

    return () => {
      clearRestartTimer();
      clearHardRestartTimer();
      if (recognitionRef.current) {
        recognitionStartingRef.current = false;
        recognitionActiveRef.current = false;
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
      }

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearHardRestartTimer, clearRestartTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!navigator.permissions?.query) return;

    let mounted = true;
    let permissionStatus: PermissionStatus | null = null;

    void navigator.permissions.query({ name: "microphone" as PermissionName }).then((status) => {
      if (!mounted) return;
      permissionStatus = status;
      setMicPermission(status.state as "granted" | "denied" | "prompt");

      const handleChange = () => {
        if (!mounted) return;
        setMicPermission(status.state as "granted" | "denied" | "prompt");
      };

      status.addEventListener("change", handleChange);

      return () => {
        status.removeEventListener("change", handleChange);
      };
    }).catch(() => {
      // ignore unsupported permissions api behavior
    });

    return () => {
      mounted = false;
      if (permissionStatus) {
        // listener cleanup is handled by the browser on unmount; keep no-op fallback.
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!enableVad) {
      setIsVoiceDetected(false);
      setVadError("");
      return;
    }

    let disposed = false;
    let animationId = 0;
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;

    const tick = (data: Uint8Array) => {
      if (disposed || !analyser) return;

      analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);

      let sumSq = 0;
      for (let i = 0; i < data.length; i += 1) {
        const centered = (data[i] - 128) / 128;
        sumSq += centered * centered;
      }

      const rms = Math.sqrt(sumSq / data.length);
      const now = Date.now();
      setMicLevel((prev) => Math.max(0, Math.min(1, prev * 0.72 + rms * 0.28)));

      if (rms >= vadThreshold) {
        vadLastVoiceRef.current = now;
        setIsVoiceDetected((prev) => (prev ? prev : true));
      } else {
        const elapsed = now - vadLastVoiceRef.current;
        if (elapsed > vadHangMs) {
          setIsVoiceDetected((prev) => (prev ? false : prev));
        }
      }

      animationId = window.requestAnimationFrame(() => tick(data));
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        audioContext = new window.AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.86;

        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        vadLastVoiceRef.current = 0;
        setMicPermission("granted");
        setVadError("");
        animationId = window.requestAnimationFrame(() => tick(data));
      } catch {
        setMicPermission("denied");
        setVadError("VAD indisponivel: permita acesso ao microfone para interrupcao por voz.");
      }
    };

    void start();

    return () => {
      disposed = true;
      if (animationId) {
        window.cancelAnimationFrame(animationId);
      }

      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      if (audioContext) {
        void audioContext.close();
      }

      setIsVoiceDetected(false);
      setMicLevel(0);
    };
  }, [enableVad, vadHangMs, vadThreshold]);

  const eyeState: HalEyeState =
    status === "listening" ? "listening" : status === "speaking" ? "speaking" : "idle";

  return {
    status,
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
  };
}
