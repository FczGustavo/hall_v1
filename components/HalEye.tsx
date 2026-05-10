"use client";

import { motion } from "framer-motion";

export type HalEyeState = "idle" | "listening" | "speaking";

type HalEyeProps = {
  state: HalEyeState;
  className?: string;
};

type WavePreset = {
  count: number;
  duration: number;
  maxScale: number;
  opacityPeak: number;
  borderClass: string;
};

const variants = {
  idle: {
    scale: [1, 1.025, 1],
    filter: [
      "drop-shadow(0 0 14px rgba(255, 30, 0, 0.45))",
      "drop-shadow(0 0 24px rgba(255, 40, 0, 0.6))",
      "drop-shadow(0 0 14px rgba(255, 30, 0, 0.45))",
    ],
    transition: {
      duration: 2.4,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  listening: {
    scale: [1.02, 1.07, 1.02],
    filter: [
      "drop-shadow(0 0 22px rgba(255, 24, 0, 0.75))",
      "drop-shadow(0 0 34px rgba(255, 44, 0, 0.95))",
      "drop-shadow(0 0 22px rgba(255, 24, 0, 0.75))",
    ],
    transition: {
      duration: 0.75,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
  speaking: {
    scale: [1.02, 1.09, 1.03, 1.1, 1.02],
    filter: [
      "drop-shadow(0 0 18px rgba(255, 45, 0, 0.7))",
      "drop-shadow(0 0 34px rgba(255, 82, 0, 1))",
      "drop-shadow(0 0 20px rgba(255, 66, 0, 0.9))",
      "drop-shadow(0 0 38px rgba(255, 94, 0, 1))",
      "drop-shadow(0 0 18px rgba(255, 45, 0, 0.7))",
    ],
    transition: {
      duration: 0.42,
      repeat: Infinity,
      ease: "linear",
    },
  },
};

const glowColorByState: Record<HalEyeState, string> = {
  idle: "from-red-700/20 via-red-600/30 to-orange-500/15",
  listening: "from-red-700/35 via-red-500/50 to-orange-500/30",
  speaking: "from-red-600/45 via-orange-500/55 to-amber-500/35",
};

const wavePresets: Record<HalEyeState, WavePreset> = {
  idle: {
    count: 2,
    duration: 3,
    maxScale: 1.38,
    opacityPeak: 0.24,
    borderClass: "border-red-500/45",
  },
  listening: {
    count: 3,
    duration: 1.8,
    maxScale: 1.58,
    opacityPeak: 0.38,
    borderClass: "border-red-400/70",
  },
  speaking: {
    count: 4,
    duration: 1.15,
    maxScale: 1.85,
    opacityPeak: 0.52,
    borderClass: "border-orange-400/75",
  },
};

export function HalEye({ state, className }: HalEyeProps) {
  const wave = wavePresets[state];

  return (
    <motion.div
      aria-label={`HAL eye ${state}`}
      role="img"
      className={[
        "relative aspect-square w-56 sm:w-72 md:w-80",
        className ?? "",
      ].join(" ")}
      animate={state}
      variants={variants}
    >
      {Array.from({ length: 4 }).map((_, index) => {
        if (index >= wave.count) return null;

        return (
          <motion.div
            key={`wave-${index}`}
            className={[
              "pointer-events-none absolute inset-[-15%] rounded-full border blur-[0.3px]",
              wave.borderClass,
            ].join(" ")}
            animate={{
              scale: [1, wave.maxScale],
              opacity: [0, wave.opacityPeak, 0],
            }}
            transition={{
              duration: wave.duration,
              repeat: Infinity,
              ease: "easeOut",
              delay: (wave.duration / wave.count) * index,
            }}
          />
        );
      })}

      <div
        className={[
          "absolute -inset-8 rounded-full bg-gradient-radial blur-3xl",
          glowColorByState[state],
        ].join(" ")}
      />

      <div className="absolute inset-0 rounded-full border border-zinc-400/22 bg-black/95 shadow-[inset_0_0_52px_rgba(0,0,0,1)]" />

      <div className="absolute inset-[3.5%] rounded-full border border-zinc-300/18 bg-gradient-to-b from-[#111111] via-[#080808] to-[#020202]" />

      <div className="absolute inset-[7%] rounded-full border border-red-900/35 bg-gradient-radial from-[#3c0505] via-[#1e0203] to-[#120102] shadow-[inset_0_0_40px_rgba(255,35,0,0.18)]" />

      <div className="absolute inset-[11%] rounded-full border border-red-800/25 bg-gradient-radial from-[#4a0a0a] via-[#230304] to-[#110102]" />

      <motion.div
        className="absolute inset-[26%] rounded-full bg-gradient-radial from-[#ff3a30] via-[#d61110] to-[#660406] blur-[0.5px]"
        animate={{ opacity: state === "idle" ? 0.72 : state === "listening" ? 0.9 : 0.96 }}
        transition={{ duration: 0.2 }}
      />

      <motion.div
        className="absolute inset-[35%] rounded-full bg-gradient-radial from-[#ff5a3a] via-[#fc2a1b] to-[#9c0909]"
        animate={{ scale: state === "speaking" ? [1, 1.08, 1] : 1 }}
        transition={{ duration: 0.25, repeat: state === "speaking" ? Infinity : 0 }}
      />

      <div className="absolute inset-[47.5%] rounded-full bg-[#fff5ba] blur-[1px]" />

      <div className="absolute left-[18%] top-[20%] h-[8%] w-[26%] rotate-[-12deg] rounded-full border-t-4 border-white/65 blur-[1px]" />
      <div className="absolute left-[40%] top-[18.5%] h-[7%] w-[20%] rotate-[3deg] rounded-full border-t-4 border-white/78 blur-[1px]" />
      <div className="absolute left-[63%] top-[20%] h-[8%] w-[20%] rotate-[16deg] rounded-full border-t-4 border-white/62 blur-[1px]" />
      <div className="absolute left-[30%] top-[33%] h-[6%] w-[18%] rotate-[-10deg] rounded-full border-t-[3px] border-white/22 blur-[1px]" />
      <div className="absolute left-[52%] top-[33%] h-[6%] w-[16%] rotate-[8deg] rounded-full border-t-[3px] border-white/22 blur-[1px]" />

      <div className="absolute inset-[2.5%] rounded-full border border-zinc-100/14" />
    </motion.div>
  );
}
