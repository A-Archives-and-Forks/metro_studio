import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Intro } from "./Intro";
import { SceneMapEditor } from "./SceneMapEditor";
import { SceneSchematic } from "./SceneSchematic";
import { SceneTimeline } from "./SceneTimeline";
import { SceneExport } from "./SceneExport";
import { Outro } from "./Outro";

// 30fps, 30s = 900 frames total
// Intro:       0-119   (0-4s)
// MapEditor:   90-299  (3-10s)    overlap with intro fade
// Schematic:   270-479 (9-16s)    overlap with editor fade
// Timeline:    450-659 (15-22s)   overlap with schematic fade
// Export:      630-779 (21-26s)   overlap with timeline fade
// Outro:       750-899 (25-30s)   overlap with export fade

export const MetroStudioDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#050a18" }}>
      <Sequence from={0} durationInFrames={150}>
        <Intro />
      </Sequence>
      <Sequence from={120} durationInFrames={210}>
        <SceneMapEditor />
      </Sequence>
      <Sequence from={300} durationInFrames={210}>
        <SceneSchematic />
      </Sequence>
      <Sequence from={480} durationInFrames={210}>
        <SceneTimeline />
      </Sequence>
      <Sequence from={660} durationInFrames={150}>
        <SceneExport />
      </Sequence>
      <Sequence from={780} durationInFrames={120}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
