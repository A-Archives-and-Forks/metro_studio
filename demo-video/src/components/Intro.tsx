import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { GlowBackground } from "./GlowBackground";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade out at end
  const fadeOut = interpolate(frame, [120, 150], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Logo ring animation
  const ringSpring = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 60, mass: 1.2 },
  });
  const ringScale = interpolate(ringSpring, [0, 1], [0, 1]);
  const ringRotate = interpolate(frame, [0, 150], [0, 45], {
    extrapolateRight: "clamp",
  });

  // Inner M letter
  const letterSpring = spring({
    frame: frame - 12,
    fps,
    config: { damping: 14, stiffness: 120 },
  });

  // Title
  const titleSpring = spring({
    frame: frame - 25,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const titleY = interpolate(titleSpring, [0, 1], [50, 0]);
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

  // Subtitle
  const subSpring = spring({
    frame: frame - 45,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const subY = interpolate(subSpring, [0, 1], [30, 0]);
  const subOpacity = interpolate(subSpring, [0, 1], [0, 1]);

  // Decorative horizontal scan line
  const scanX = interpolate(frame, [10, 80], [-400, 2400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Tagline words stagger
  const tagWords = ["绘制", "·", "布局", "·", "动画", "·", "导出"];

  return (
    <AbsoluteFill style={{ opacity: fadeOut }}>
      <GlowBackground intensity={1} />

      {/* Horizontal scan line */}
      <svg
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
        viewBox="0 0 1920 1080"
      >
        <defs>
          <linearGradient id="scanGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(77,159,255,0)" />
            <stop offset="40%" stopColor="rgba(77,159,255,0.15)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0.3)" />
            <stop offset="60%" stopColor="rgba(244,114,182,0.15)" />
            <stop offset="100%" stopColor="rgba(244,114,182,0)" />
          </linearGradient>
        </defs>
        <rect
          x={scanX - 200}
          y={0}
          width={400}
          height={1080}
          fill="url(#scanGrad)"
        />
      </svg>

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
        <div style={{ position: "relative", width: 120, height: 120, marginBottom: 32 }}>
          {/* Outer ring */}
          <svg
            width={120}
            height={120}
            viewBox="0 0 120 120"
            style={{
              position: "absolute",
              transform: `scale(${ringScale}) rotate(${ringRotate}deg)`,
            }}
          >
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4d9fff" />
                <stop offset="50%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#f472b6" />
              </linearGradient>
            </defs>
            {/* Hexagonal ring */}
            <polygon
              points="60,5 110,30 110,90 60,115 10,90 10,30"
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth={2.5}
              strokeLinejoin="round"
            />
            {/* Inner hex */}
            <polygon
              points="60,20 97,40 97,80 60,100 23,80 23,40"
              fill="none"
              stroke="rgba(77,159,255,0.3)"
              strokeWidth={1}
              strokeLinejoin="round"
            />
          </svg>
          {/* M letter */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 120,
              height: 120,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              transform: `scale(${letterSpring})`,
            }}
          >
            <span
              style={{
                fontSize: 104,
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
            fontSize: 152,
            fontWeight: 700,
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: "-1px",
            background: "linear-gradient(135deg, #4d9fff 0%, #ffffff 50%, #f472b6 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Metro Studio
        </div>

        {/* Subtitle */}
        <div
          style={{
            transform: `translateY(${subY}px)`,
            opacity: subOpacity,
            fontSize: 52,
            color: "rgba(255,255,255,0.6)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            marginTop: 16,
            letterSpacing: "6px",
            textTransform: "uppercase",
          }}
        >
          专业地铁线路图编辑器
        </div>

        {/* Tagline words */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 40,
          }}
        >
          {tagWords.map((word, i) => {
            const wordOpacity = interpolate(
              frame,
              [60 + i * 6, 70 + i * 6],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            const wordY = interpolate(
              spring({
                frame: frame - 60 - i * 6,
                fps,
                config: { damping: 14, stiffness: 120 },
              }),
              [0, 1],
              [15, 0]
            );
            return (
              <span
                key={i}
                style={{
                  opacity: wordOpacity,
                  transform: `translateY(${wordY}px)`,
                  fontSize: 36,
                  fontWeight: word === "·" ? 400 : 600,
                  color: word === "·" ? "rgba(255,255,255,0.3)" : "rgba(77,159,255,0.8)",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  letterSpacing: "2px",
                }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
