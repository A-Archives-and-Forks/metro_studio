import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { GlowBackground } from "./GlowBackground";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Logo hex ring
  const ringSpring = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 60, mass: 1.2 },
  });
  const ringScale = interpolate(ringSpring, [0, 1], [0, 1]);
  const ringRotate = interpolate(frame, [0, 120], [0, -30], {
    extrapolateRight: "clamp",
  });

  // M letter
  const letterSpring = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 120 },
  });

  // Title
  const titleSpring = spring({
    frame: frame - 20,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const titleY = interpolate(titleSpring, [0, 1], [40, 0]);
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

  // GitHub
  const ghSpring = spring({
    frame: frame - 40,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const ghY = interpolate(ghSpring, [0, 1], [20, 0]);
  const ghOpacity = interpolate(ghSpring, [0, 1], [0, 1]);

  // CTA button
  const ctaSpring = spring({
    frame: frame - 60,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const ctaScale = interpolate(ctaSpring, [0, 1], [0.8, 1]);
  const ctaOpacity = interpolate(ctaSpring, [0, 1], [0, 1]);

  // CTA glow pulse
  const ctaPulse = 0.7 + 0.3 * Math.sin(frame * 0.1);

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <GlowBackground intensity={0.8} />

      {/* Center content */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {/* Logo */}
        <div style={{ position: "relative", width: 100, height: 100, marginBottom: 28 }}>
          <svg
            width={100}
            height={100}
            viewBox="0 0 120 120"
            style={{
              position: "absolute",
              transform: `scale(${ringScale}) rotate(${ringRotate}deg)`,
            }}
          >
            <defs>
              <linearGradient id="outroRingGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4d9fff" />
                <stop offset="50%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#f472b6" />
              </linearGradient>
            </defs>
            <polygon
              points="60,5 110,30 110,90 60,115 10,90 10,30"
              fill="none"
              stroke="url(#outroRingGrad)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            <polygon
              points="60,20 97,40 97,80 60,100 23,80 23,40"
              fill="none"
              stroke="rgba(77,159,255,0.25)"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 100,
              height: 100,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              transform: `scale(${letterSpring})`,
            }}
          >
            <span
              style={{
                fontSize: 88,
                fontWeight: 800,
                fontFamily: "system-ui, -apple-system, sans-serif",
                background: "linear-gradient(135deg, #4d9fff, #ffffff, #f472b6)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              M
            </span>
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            transform: `translateY(${titleY}px)`,
            opacity: titleOpacity,
            fontSize: 120,
            fontWeight: 700,
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "linear-gradient(135deg, #4d9fff 0%, #ffffff 50%, #f472b6 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Metro Studio
        </div>

        {/* GitHub */}
        <div
          style={{
            transform: `translateY(${ghY}px)`,
            opacity: ghOpacity,
            fontSize: 40,
            fontFamily: "system-ui, -apple-system, sans-serif",
            marginTop: 24,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="rgba(255,255,255,0.5)">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
          </svg>
          github.com/Ce-daros/railmap
        </div>

        {/* CTA Button */}
        <div
          style={{
            transform: `scale(${ctaScale})`,
            opacity: ctaOpacity,
            marginTop: 44,
            padding: "14px 44px",
            borderRadius: 12,
            background: "linear-gradient(135deg, #4d9fff, #7c6cf0, #f472b6)",
            fontSize: 40,
            fontWeight: 600,
            color: "#ffffff",
            fontFamily: "system-ui, -apple-system, sans-serif",
            boxShadow: `0 0 ${20 * ctaPulse}px rgba(77,159,255,0.4), 0 0 ${40 * ctaPulse}px rgba(244,114,182,0.2), 0 4px 20px rgba(0,0,0,0.3)`,
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          开始创建你的地铁线路图
        </div>
      </div>
    </AbsoluteFill>
  );
};
