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

export const SceneTimeline: React.FC = () => {
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

  const shotSpring = spring({
    frame: frame - 10,
    fps,
    config: { damping: 14, stiffness: 80 },
  });
  const shotScale = interpolate(shotSpring, [0, 1], [1.05, 1]);
  const shotOpacity = interpolate(shotSpring, [0, 1], [0, 1]);

  // Timeline progress bar
  const timelineProgress = interpolate(frame, [40, 170], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Year milestones
  const years = [
    { label: "2010", position: 0.1, frame: 50 },
    { label: "2015", position: 0.35, frame: 80 },
    { label: "2020", position: 0.6, frame: 110 },
    { label: "2025", position: 0.85, frame: 140 },
  ];

  // Playhead glow pulse
  const playheadPulse = 0.7 + 0.3 * Math.sin(frame * 0.15);

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <GlowBackground intensity={0.4} />

      <SceneTitle title="时间线动画演示" subtitle="Timeline Animation" />

      {/* Screenshot */}
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 100,
          right: 100,
          bottom: 130,
          borderRadius: 18,
          overflow: "hidden",
          transform: `scale(${shotScale})`,
          opacity: shotOpacity,
          boxShadow:
            "0 0 40px rgba(77,159,255,0.15), 0 0 80px rgba(244,114,182,0.08), 0 20px 60px rgba(0,0,0,0.5)",
          border: "1px solid rgba(77,159,255,0.2)",
        }}
      >
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
          src={staticFile("screenshots/timeline.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>

      {/* Animated timeline bar at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 45,
          left: 140,
          right: 140,
          height: 60,
        }}
      >
        {/* Track background */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 0,
            right: 0,
            height: 4,
            backgroundColor: "rgba(77,159,255,0.15)",
            borderRadius: 2,
          }}
        />
        {/* Progress fill with gradient */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 0,
            width: `${timelineProgress * 100}%`,
            height: 4,
            borderRadius: 2,
            background: "linear-gradient(90deg, #4d9fff, #f472b6)",
            boxShadow: "0 0 12px rgba(77,159,255,0.4), 0 0 24px rgba(244,114,182,0.2)",
          }}
        />
        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            top: 20,
            left: `${timelineProgress * 100}%`,
            width: 20,
            height: 20,
            borderRadius: "50%",
            transform: "translateX(-50%)",
            background: "linear-gradient(135deg, #4d9fff, #f472b6)",
            border: "3px solid #ffffff",
            boxShadow: `0 0 ${12 * playheadPulse}px rgba(77,159,255,0.6), 0 0 ${24 * playheadPulse}px rgba(244,114,182,0.3)`,
          }}
        />

        {/* Year labels */}
        {years.map((year) => {
          const labelSpring = spring({
            frame: frame - year.frame,
            fps,
            config: { damping: 14, stiffness: 120 },
          });
          const labelOpacity = interpolate(labelSpring, [0, 1], [0, 1]);
          const labelY = interpolate(labelSpring, [0, 1], [10, 0]);

          // Vertical tick
          const tickHeight = interpolate(labelSpring, [0, 1], [0, 12]);

          return (
            <React.Fragment key={year.label}>
              {/* Tick mark */}
              <div
                style={{
                  position: "absolute",
                  top: 34,
                  left: `${year.position * 100}%`,
                  width: 1,
                  height: tickHeight,
                  backgroundColor: "rgba(77,159,255,0.4)",
                  transform: "translateX(-0.5px)",
                }}
              />
              {/* Label */}
              <div
                style={{
                  position: "absolute",
                  top: 48,
                  left: `${year.position * 100}%`,
                  transform: `translateX(-50%) translateY(${labelY}px)`,
                  opacity: labelOpacity,
                  fontSize: 18,
                  fontWeight: 600,
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  color: "rgba(255,255,255,0.5)",
                  letterSpacing: "1px",
                }}
              >
                {year.label}
              </div>
              {/* Dot on track */}
              <div
                style={{
                  position: "absolute",
                  top: 26,
                  left: `${year.position * 100}%`,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "#4d9fff",
                  transform: `translateX(-50%) scale(${labelSpring})`,
                  boxShadow: "0 0 6px rgba(77,159,255,0.5)",
                }}
              />
            </React.Fragment>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
