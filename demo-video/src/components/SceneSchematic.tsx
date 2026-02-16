import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Img,
  staticFile,
} from "remotion";
import { GlowBackground } from "./GlowBackground";
import { SceneTitle } from "./SceneTitle";

export const SceneSchematic: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [180, 210], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Screenshot entrance with scale
  const shotSpring = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const shotScale = interpolate(shotSpring, [0, 1], [0.92, 1]);
  const shotOpacity = interpolate(shotSpring, [0, 1], [0, 1]);

  // "Magic wand" radial burst at frame ~50
  const burstFrame = frame - 50;
  const burstRadius = interpolate(burstFrame, [0, 30], [0, 400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const burstOpacity = interpolate(burstFrame, [0, 8, 30], [0, 0.6, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Grid lines appearing (schematic layout visualization)
  const gridProgress = interpolate(frame, [60, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Schematic line segments animating in
  const schematicLines = [
    { x1: 200, y1: 400, x2: 1500, y2: 400, color: "#4d9fff", delay: 70 },
    { x1: 300, y1: 600, x2: 1400, y2: 600, color: "#f472b6", delay: 85 },
    { x1: 850, y1: 150, x2: 850, y2: 750, color: "#a5f3fc", delay: 100 },
  ];

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <GlowBackground intensity={0.4} />

      <SceneTitle title="一键生成示意图" subtitle="Auto Schematic Layout" />

      {/* Screenshot */}
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 100,
          right: 100,
          bottom: 50,
          borderRadius: 18,
          overflow: "hidden",
          transform: `scale(${shotScale})`,
          opacity: shotOpacity,
          boxShadow:
            "0 0 40px rgba(77,159,255,0.15), 0 0 80px rgba(244,114,182,0.08), 0 20px 60px rgba(0,0,0,0.5)",
          border: "1px solid rgba(77,159,255,0.2)",
        }}
      >
        {/* Gradient top bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, #4d9fff, #f472b6, #4d9fff)",
            opacity: 0.8,
            zIndex: 2,
          }}
        />

        <Img
          src={staticFile("screenshots/schematic.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />

        {/* Radial burst overlay */}
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
          viewBox="0 0 1720 900"
        >
          <defs>
            <radialGradient id="burstGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(77,159,255,0.4)" />
              <stop offset="60%" stopColor="rgba(244,114,182,0.15)" />
              <stop offset="100%" stopColor="rgba(77,159,255,0)" />
            </radialGradient>
            <filter id="schemaGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Burst circle */}
          <circle
            cx={860}
            cy={450}
            r={burstRadius}
            fill="none"
            stroke="url(#burstGrad)"
            strokeWidth={3}
            opacity={burstOpacity}
          />
          {/* Inner burst */}
          <circle
            cx={860}
            cy={450}
            r={burstRadius * 0.6}
            fill="none"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1.5}
            opacity={burstOpacity * 0.7}
          />

          {/* Grid lines */}
          {[200, 350, 500, 650].map((y, i) => (
            <line
              key={`h-${i}`}
              x1={80}
              y1={y}
              x2={interpolate(gridProgress, [0, 1], [80, 1640])}
              y2={y}
              stroke="#4d9fff"
              strokeWidth={0.8}
              opacity={0.12 * gridProgress}
              strokeDasharray="6 10"
            />
          ))}
          {[300, 550, 800, 1050, 1300].map((x, i) => (
            <line
              key={`v-${i}`}
              x1={x}
              y1={80}
              x2={x}
              y2={interpolate(gridProgress, [0, 1], [80, 820])}
              stroke="#4d9fff"
              strokeWidth={0.8}
              opacity={0.12 * gridProgress}
              strokeDasharray="6 10"
            />
          ))}

          {/* Schematic line segments */}
          {schematicLines.map((line, i) => {
            const lineProgress = interpolate(
              frame,
              [line.delay, line.delay + 30],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            return (
              <g key={i}>
                {/* Glow */}
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={interpolate(lineProgress, [0, 1], [line.x1, line.x2])}
                  y2={interpolate(lineProgress, [0, 1], [line.y1, line.y2])}
                  stroke={line.color}
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.3}
                  filter="url(#schemaGlow)"
                />
                {/* Main */}
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={interpolate(lineProgress, [0, 1], [line.x1, line.x2])}
                  y2={interpolate(lineProgress, [0, 1], [line.y1, line.y2])}
                  stroke={line.color}
                  strokeWidth={3}
                  strokeLinecap="round"
                  opacity={0.7}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </AbsoluteFill>
  );
};
