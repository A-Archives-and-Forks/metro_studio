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

export const SceneMapEditor: React.FC = () => {
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

  // Screenshot entrance
  const shotSpring = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const shotScale = interpolate(shotSpring, [0, 1], [1.08, 1]);
  const shotOpacity = interpolate(shotSpring, [0, 1], [0, 1]);

  // Cursor drawing animation
  const cursorX = interpolate(frame, [60, 150], [550, 1150], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorY = interpolate(frame, [60, 100, 150], [380, 520, 420], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorOpacity = interpolate(frame, [55, 60, 155, 165], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Station dots
  const stations = [
    { x: 600, y: 400, frame: 70 },
    { x: 780, y: 480, frame: 90 },
    { x: 950, y: 500, frame: 110 },
    { x: 1100, y: 440, frame: 130 },
  ];

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <GlowBackground intensity={0.5} />

      <SceneTitle title="在真实地图上绘制线路" subtitle="Map Editor" />

      {/* Screenshot container with glow border */}
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
        {/* Glass top bar */}
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
          src={staticFile("screenshots/editor.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />

        {/* Overlay: animated drawing */}
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
            <filter id="stationGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Connecting lines between stations */}
          {stations.map((dot, i) => {
            if (i === 0) return null;
            const prev = stations[i - 1];
            const progress = interpolate(
              frame,
              [dot.frame - 12, dot.frame],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            return (
              <line
                key={`line-${i}`}
                x1={prev.x}
                y1={prev.y}
                x2={interpolate(progress, [0, 1], [prev.x, dot.x])}
                y2={interpolate(progress, [0, 1], [prev.y, dot.y])}
                stroke="#4d9fff"
                strokeWidth={3}
                strokeLinecap="round"
                filter="url(#stationGlow)"
                opacity={0.9}
              />
            );
          })}

          {/* Station dots */}
          {stations.map((dot, i) => {
            const s = spring({
              frame: frame - dot.frame,
              fps,
              config: { damping: 10, stiffness: 200 },
            });
            const r = interpolate(s, [0, 1], [0, 7]);
            const pulseR = interpolate(s, [0, 1], [0, 18]);
            const pulseOp = interpolate(s, [0.5, 1], [0.6, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            return (
              <g key={i}>
                {/* Pulse ring */}
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={pulseR}
                  fill="none"
                  stroke="#4d9fff"
                  strokeWidth={2}
                  opacity={pulseOp}
                />
                {/* Glow */}
                <circle
                  cx={dot.x}
                  cy={dot.y}
                  r={r + 4}
                  fill="rgba(77,159,255,0.3)"
                  filter="url(#stationGlow)"
                />
                {/* Dot */}
                <circle cx={dot.x} cy={dot.y} r={r} fill="#4d9fff" />
                <circle cx={dot.x} cy={dot.y} r={r * 0.4} fill="white" opacity={0.9} />
              </g>
            );
          })}
        </svg>

        {/* Cursor */}
        <div
          style={{
            position: "absolute",
            left: `${(cursorX / 1720) * 100}%`,
            top: `${(cursorY / 900) * 100}%`,
            opacity: cursorOpacity,
            transform: "translate(-2px, -2px)",
            filter: "drop-shadow(0 0 4px rgba(255,255,255,0.5))",
          }}
        >
          <svg width={24} height={24} viewBox="0 0 24 24">
            <path d="M5 3l14 8-7 2-3 7z" fill="white" stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  );
};
