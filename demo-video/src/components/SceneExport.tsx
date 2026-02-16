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

export const SceneExport: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [120, 150], [1, 0], {
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

  // Export format cards
  const formats = [
    {
      label: "PNG",
      desc: "高分辨率图片",
      color: "#4d9fff",
      iconPath: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
      delay: 40,
    },
    {
      label: "MP4",
      desc: "时间线动画视频",
      color: "#f472b6",
      iconPath: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
      delay: 55,
    },
    {
      label: "ZIP",
      desc: "项目数据文件",
      color: "#a5f3fc",
      iconPath: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
      delay: 70,
    },
  ];

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <GlowBackground intensity={0.4} />

      <SceneTitle title="高质量导出" subtitle="Export" />

      {/* Screenshot (left side) */}
      <div
        style={{
          position: "absolute",
          top: 130,
          left: 100,
          right: 420,
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
          src={staticFile("screenshots/export.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </div>

      {/* Export format cards (right side) */}
      <div
        style={{
          position: "absolute",
          top: 200,
          right: 100,
          width: 280,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {formats.map((fmt) => {
          const cardSpring = spring({
            frame: frame - fmt.delay,
            fps,
            config: { damping: 12, stiffness: 120 },
          });
          const cardX = interpolate(cardSpring, [0, 1], [60, 0]);
          const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);

          // Hover-like glow pulse
          const glowIntensity = interpolate(
            spring({
              frame: frame - fmt.delay - 15,
              fps,
              config: { damping: 20, stiffness: 60 },
            }),
            [0, 1],
            [0, 1]
          );

          return (
            <div
              key={fmt.label}
              style={{
                transform: `translateX(${cardX}px)`,
                opacity: cardOpacity,
                background: "rgba(10,20,40,0.7)",
                border: `1px solid ${fmt.color}44`,
                borderRadius: 14,
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                gap: 16,
                backdropFilter: "blur(8px)",
                boxShadow: `0 0 ${20 * glowIntensity}px ${fmt.color}22, inset 0 0 ${10 * glowIntensity}px ${fmt.color}11`,
              }}
            >
              {/* Icon */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: `${fmt.color}18`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width={22}
                  height={22}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={fmt.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={fmt.iconPath} />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: "#ffffff",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                  }}
                >
                  {fmt.label}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    color: "rgba(255,255,255,0.4)",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    marginTop: 2,
                  }}
                >
                  {fmt.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
