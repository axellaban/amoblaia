import React from "react";
import { Composition } from "remotion";
import { AmoblaiaVideo, TOTAL } from "./amoblaia/Video";

const FPS = 30;
export const Root: React.FC = () => (
  <>
    <Composition id="amoblaia-horizontal" component={AmoblaiaVideo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    <Composition id="amoblaia-vertical" component={AmoblaiaVideo} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
  </>
);
