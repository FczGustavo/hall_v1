"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type CompanionMode = "embedded" | "popup";

type HalOpenUrlMessage = {
  type: "HAL_OPEN_URL";
  url: string;
};

function isHalOpenUrlMessage(data: unknown): data is HalOpenUrlMessage {
  if (!data || typeof data !== "object") return false;
  const candidate = data as { type?: unknown; url?: unknown };
  return candidate.type === "HAL_OPEN_URL" && typeof candidate.url === "string";
}

export default function HomePage() {
  const [mode, setMode] = useState<CompanionMode>("embedded");
  const [isWidgetRunning, setIsWidgetRunning] = useState(false);
  const [widgetError, setWidgetError] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserNotice, setBrowserNotice] = useState("");
  const widgetWidth = 430;
  const widgetHeight = 700;
  const [widgetPosition, setWidgetPosition] = useState({ x: 24, y: 120 });
  const dragStartRef = useRef<{ startMouseX: number; startMouseY: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const startX = Math.max(12, window.innerWidth - widgetWidth - 18);
    const startY = Math.max(12, window.innerHeight - widgetHeight - 18);
    setWidgetPosition({ x: startX, y: startY });
  }, [widgetHeight, widgetWidth]);

  useEffect(() => {
    const handleResize = () => {
      const maxX = Math.max(12, window.innerWidth - widgetWidth - 12);
      const maxY = Math.max(12, window.innerHeight - widgetHeight - 12);

      setWidgetPosition((prev) => ({
        x: Math.min(Math.max(12, prev.x), maxX),
        y: Math.min(Math.max(12, prev.y), maxY),
      }));
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [widgetHeight, widgetWidth]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isHalOpenUrlMessage(event.data)) return;

      try {
        const url = new URL(event.data.url);
        const host = url.hostname.toLowerCase();
        const iframeBlockedDomains = [
          "youtube.com",
          "google.com",
          "x.com",
          "twitter.com",
          "whatsapp.com",
          "instagram.com",
        ];

        if (iframeBlockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
          window.open(event.data.url, "_blank", "noopener,noreferrer");
          setBrowserNotice(`Esse site bloqueia iframe (${host}). Abri em nova aba automaticamente.`);
          setIsBrowserOpen(false);
          return;
        }
      } catch {
        // ignore malformed url and try rendering in panel
      }

      setBrowserUrl(event.data.url);
      setBrowserNotice("");
      setIsBrowserOpen(true);
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const halIframeSrc = useMemo(() => "/hal-core?embed=1", []);

  const openPopupMode = () => {
    const popup = window.open(
      "/hal-core",
      "HAL_9000",
      "width=540,height=760,menubar=no,toolbar=no,location=no,status=no,left=50,top=50,resizable=yes,scrollbars=yes",
    );

    if (!popup) {
      setWidgetError("Nao foi possivel abrir o popup. Libere popups para este site.");
      setIsWidgetRunning(false);
      return;
    }

    setWidgetError("");
    setIsWidgetRunning(true);
    popup.focus();
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-zinc-100">
      <div className="pointer-events-auto absolute left-6 top-6 z-20 w-[min(92vw,32rem)] rounded-2xl border border-red-500/20 bg-black/70 p-5 font-[Space_Mono] backdrop-blur-md">
        <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">HAL INTERFACE</p>
        <h1 className="mt-2 text-xl tracking-wide text-red-200">Companion Mode</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Escolha onde o HAL deve rodar: na mesma pagina (widget no canto) ou em popup dedicado.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("embedded");
              setIsWidgetRunning(true);
              setWidgetError("");
            }}
            className={`rounded-md border px-3 py-1 text-sm ${
              mode === "embedded"
                ? "border-lime-500/45 bg-lime-500/20 text-lime-100"
                : "border-zinc-600 bg-zinc-800/60 text-zinc-200"
            }`}
          >
            Widget na mesma pagina
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("popup");
              openPopupMode();
            }}
            className={`rounded-md border px-3 py-1 text-sm ${
              mode === "popup"
                ? "border-cyan-500/45 bg-cyan-500/20 text-cyan-100"
                : "border-zinc-600 bg-zinc-800/60 text-zinc-200"
            }`}
          >
            Popup separado
          </button>
        </div>

        {mode === "popup" && isWidgetRunning ? (
          <p className="mt-3 text-sm text-emerald-300">HAL is running in popup companion mode.</p>
        ) : null}

        {widgetError ? (
          <p className="mt-3 text-sm text-orange-300">{widgetError}</p>
        ) : null}

        {browserNotice ? (
          <p className="mt-2 text-sm text-cyan-300">{browserNotice}</p>
        ) : null}
      </div>

      {mode === "embedded" ? (
        <section
          className="absolute z-30 overflow-hidden rounded-2xl border border-red-500/30 bg-black shadow-[0_0_40px_rgba(220,38,38,0.2)]"
          style={{
            width: `${widgetWidth}px`,
            height: `${widgetHeight}px`,
            left: `${widgetPosition.x}px`,
            top: `${widgetPosition.y}px`,
          }}
        >
          <header
            className="flex h-9 cursor-move items-center justify-between border-b border-zinc-800/90 bg-zinc-950/90 px-3 font-[Space_Mono] text-[11px] uppercase tracking-[0.14em] text-red-200"
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();

              dragStartRef.current = {
                startMouseX: event.clientX,
                startMouseY: event.clientY,
                startX: widgetPosition.x,
                startY: widgetPosition.y,
              };

              const handleMove = (moveEvent: MouseEvent) => {
                const start = dragStartRef.current;
                if (!start) return;

                const nextX = start.startX + (moveEvent.clientX - start.startMouseX);
                const nextY = start.startY + (moveEvent.clientY - start.startMouseY);
                const maxX = Math.max(12, window.innerWidth - widgetWidth - 12);
                const maxY = Math.max(12, window.innerHeight - widgetHeight - 12);

                setWidgetPosition({
                  x: Math.min(Math.max(12, nextX), maxX),
                  y: Math.min(Math.max(12, nextY), maxY),
                });
              };

              const handleUp = () => {
                dragStartRef.current = null;
                window.removeEventListener("mousemove", handleMove);
                window.removeEventListener("mouseup", handleUp);
              };

              window.addEventListener("mousemove", handleMove);
              window.addEventListener("mouseup", handleUp);
            }}
          >
            <p>HAL Companion</p>
            <p className="text-[10px] tracking-[0.1em] text-zinc-400">Arraste para mover</p>
          </header>

          <iframe
            title="HAL Companion"
            src={halIframeSrc}
            allow="microphone; autoplay"
            className="h-[calc(100%-2.25rem)] w-full bg-black"
          />
        </section>
      ) : null}

      {isBrowserOpen ? (
        <section className="absolute left-5 top-5 z-20 h-[78vh] w-[min(62vw,980px)] overflow-hidden rounded-2xl border border-cyan-500/30 bg-zinc-950/90 shadow-[0_0_40px_rgba(6,182,212,0.2)]">
          <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 font-[Space_Mono] text-xs text-cyan-200">
            <p className="truncate">Embedded Web Panel: {browserUrl}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (browserUrl) {
                    window.open(browserUrl, "_blank", "noopener,noreferrer");
                  }
                }}
                className="rounded border border-cyan-500/40 px-2 py-1 text-[11px] text-cyan-100"
              >
                Abrir em nova aba
              </button>
              <button
                type="button"
                onClick={() => setIsBrowserOpen(false)}
                className="rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-200"
              >
                Fechar
              </button>
            </div>
          </header>

          <iframe title="HAL Browser" src={browserUrl} className="h-[calc(78vh-41px)] w-full bg-black" />
        </section>
      ) : null}
    </main>
  );
}
