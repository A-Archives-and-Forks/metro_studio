import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

/**
 * Shared glow background with:
 * - Deep blue radial gradient base
 * - Animated hexagonal grid pattern
 * - Flowing metro line network decoration
 * - Blue / pink / white glow accents
 */
export const GlowBackground: React.FC<{
  /** 0-1, controls how much of the background animation has progressed */
  intensity?: number;
}> = ({ intensity = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Hex grid fade in
  const hexOpacity = interpolate(frame, [0, 40], [0, 0.12 * intensity], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Metro network lines grow
  const lineGrow = interpolate(frame, [5, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Glow pulse (subtle breathing)
  const glowPulse = 0.6 + 0.4 * Math.sin(frame * 0.04);

  // Station pulse along lines
  const stationPulse = (delay: number) => {
    const t = (frame - delay) % 90;
    return t >= 0 && t < 30
      ? interpolate(t, [0, 15, 30], [0, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;
  };

  // Generate hexagonal grid points
  const hexSize = 60;
  const hexRows = 12;
  const hexCols = 20;
  const hexPoints: { cx: number; cy: number }[] = [];
  for (let row = 0; row < hexRows; row++) {
    for (let col = 0; col < hexCols; col++) {
      const offsetX = row % 2 === 0 ? 0 : hexSize * 0.866;
      hexPoints.push({
        cx: col * hexSize * 1.732 + offsetX,
        cy: row * hexSize * 1.5,
      });
    }
  }

  // Hex path helper
  const hexPath = (cx: number, cy: number, r: number) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
    }
    return `M${pts.join("L")}Z`;
  };

  // Metro network paths (abstract decorative lines)
  const metroLines = [
    {
      // Blue line — horizontal with kinks
      color: "#4d9fff",
      width: 3,
      points: [
        [-100, 300],
        [200, 300],
        [400, 380],
        [700, 380],
        [900, 300],
        [1200, 300],
        [1500, 380],
        [1800, 380],
        [2020, 300],
      ],
      glowColor: "rgba(77,159,255,0.4)",
    },
    {
      // Pink line — diagonal sweep
      color: "#f472b6",
      width: 3,
      points: [
        [-100, 700],
        [150, 700],
        [350, 620],
        [600, 620],
        [800, 700],
        [1050, 700],
        [1250, 620],
        [1500, 620],
        [1700, 700],
        [2020, 700],
      ],
      glowColor: "rgba(244,114,182,0.35)",
    },
    {
      // White/cyan line — vertical-ish
      color: "#a5f3fc",
      width: 2,
      points: [
        [960, -50],
        [960, 150],
        [880, 300],
        [880, 500],
        [960, 620],
        [960, 800],
        [1040, 950],
        [1040, 1130],
      ],
      glowColor: "rgba(165,243,252,0.3)",
    },
  ];

  // Stations on lines
  const stations = [
    { cx: 200, cy: 300, color: "#4d9fff", delay: 0 },
    { cx: 700, cy: 380, color: "#4d9fff", delay: 20 },
    { cx: 1200, cy: 300, color: "#4d9fff", delay: 40 },
    { cx: 150, cy: 700, color: "#f472b6", delay: 10 },
    { cx: 600, cy: 620, color: "#f472b6", delay: 30 },
    { cx: 1050, cy: 700, color: "#f472b6", delay: 50 },
    { cx: 1500, cy: 620, color: "#f472b6", delay: 15 },
    { cx: 880, cy: 300, color: "#a5f3fc", delay: 25 },
    { cx: 880, cy: 500, color: "#a5f3fc", delay: 45 },
    { cx: 960, cy: 800, color: "#a5f3fc", delay: 5 },
  ];

  const pathD = (pts: number[][]) => {
    return pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`)
      .join(" ");
  };

  // Animated dash offset for flowing effect
  const dashOffset = -frame * 2;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        {/* Radial gradient base — deep blue */}
        <radialGradient id="bgGrad" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#0c1e3a" />
          <stop offset="50%" stopColor="#091428" />
          <stop offset="100%" stopColor="#050a18" />
        </radialGradient>

        {/* Glow filters */}
        <filter id="glowBlue" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glowPink" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glowSoft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="20" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Base gradient */}
      <rect width="1920" height="1080" fill="url(#bgGrad)" />

      {/* Large soft glow orbs */}
      <circle
        cx={480}
        cy={350}
        r={300}
        fill="rgba(59,130,246,0.06)"
        filter="url(#glowSoft)"
        opacity={glowPulse}
      />
      <circle
        cx={1440}
        cy={730}
        r={280}
        fill="rgba(244,114,182,0.05)"
        filter="url(#glowSoft)"
        opacity={glowPulse}
      />
      <circle
        cx={960}
        cy={540}
        r={200}
        fill="rgba(255,255,255,0.03)"
        filter="url(#glowSoft)"
        opacity={0.5 + 0.5 * Math.sin(frame * 0.03 + 1)}
      />

      {/* Hexagonal grid */}
      <g opacity={hexOpacity}>
        {hexPoints.map((h, i) => (
          <path
            key={i}
            d={hexPath(h.cx, h.cy, hexSize * 0.48)}
            fill="none"
            stroke="#4d9fff"
            strokeWidth={0.8}
          />
        ))}
      </g>

      {/* Metro network lines */}
      {metroLines.map((line, i) => {
        const totalLen = 3000; // approximate
        const visibleLen = lineGrow * totalLen;
        return (
          <g key={i}>
            {/* Glow layer */}
            <path
              d={pathD(line.points)}
              fill="none"
              stroke={line.glowColor}
              strokeWidth={line.width + 8}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${visibleLen} ${totalLen}`}
              filter="url(#glowBlue)"
              opacity={0.5 * intensity}
            />
            {/* Main line */}
            <path
              d={pathD(line.points)}
              fill="none"
              stroke={line.color}
              strokeWidth={line.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${visibleLen} ${totalLen}`}
              opacity={0.7 * intensity}
            />
            {/* Flowing dash overlay */}
            <path
              d={pathD(line.points)}
              fill="none"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={1}
              strokeLinecap="round"
              strokeDasharray="8 40"
              strokeDashoffset={dashOffset + i * 200}
              opacity={lineGrow * 0.6}
            />
          </g>
        );
      })}

      {/* Station nodes */}
      {stations.map((s, i) => {
        const appear = spring({
          frame: frame - 20 - s.delay,
          fps,
          config: { damping: 12, stiffness: 120 },
        });
        const r = interpolate(appear, [0, 1], [0, 5]);
        const pulse = stationPulse(s.delay);
        return (
          <g key={i} opacity={lineGrow}>
            {/* Pulse ring */}
            <circle
              cx={s.cx}
              cy={s.cy}
              r={r + pulse * 12}
              fill="none"
              stroke={s.color}
              strokeWidth={1.5}
              opacity={pulse * 0.6}
            />
            {/* Station dot */}
            <circle cx={s.cx} cy={s.cy} r={r} fill={s.color} opacity={0.9} />
            {/* White center */}
            <circle
              cx={s.cx}
              cy={s.cy}
              r={r * 0.4}
              fill="white"
              opacity={appear * 0.8}
            />
          </g>
        );
      })}
    </svg>
  );
};
