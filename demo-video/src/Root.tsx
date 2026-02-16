import React from "react";
import { Composition } from "remotion";
import { MetroStudioDemo } from "./components/MetroStudioDemo";

const FPS = 30;
const DURATION_SECONDS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MetroStudioDemo"
      component={MetroStudioDemo}
      durationInFrames={FPS * DURATION_SECONDS}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
