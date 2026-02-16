import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

interface SceneTitleProps {
  title: string;
  subtitle: string;
}

export const SceneTitle: React.FC<SceneTitleProps> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });

  const titleX = interpolate(titleSpring, [0, 1], [-60, 0]);
  const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

  const subtitleOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Accent line grows
  const lineHeight = interpolate(
    spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 80 } }),
    [0, 1],
    [0, 56]
  );

  // Glow dot at top of accent line
  const dotOpacity = interpolate(frame, [15, 25], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 44,
        left: 120,
        display: "flex",
        alignItems: "flex-start",
        gap: 18,
        zIndex: 10,
      }}
    >
      {/* Accent line with glow */}
      <div style={{ position: "relative", width: 4, height: 60 }}>
        <div
          style={{
            width: 4,
            height: lineHeight,
            borderRadius: 2,
            background: "linear-gradient(180deg, #4d9fff, #f472b6)",
            boxShadow: "0 0 12px rgba(77,159,255,0.5), 0 0 24px rgba(244,114,182,0.3)",
          }}
        />
        {/* Glow dot */}
        <div
          style={{
            position: "absolute",
            top: -4,
            left: -3,
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: "#4d9fff",
            boxShadow: "0 0 8px #4d9fff, 0 0 16px rgba(77,159,255,0.5)",
            opacity: dotOpacity,
          }}
        />
      </div>
      <div>
        <div
          style={{
            transform: `translateX(${titleX}px)`,
            opacity: titleOpacity,
            fontSize: 48,
            fontWeight: 700,
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "linear-gradient(90deg, #ffffff, #c4deff)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {title}
        </div>
        <div
          style={{
            opacity: subtitleOpacity,
            fontSize: 22,
            fontFamily: "system-ui, -apple-system, sans-serif",
            marginTop: 4,
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "rgba(77,159,255,0.6)",
          }}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
};
