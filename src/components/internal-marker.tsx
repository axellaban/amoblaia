"use client";
import { useEffect } from "react";
import { markInternal } from "@/lib/analytics";

/** Drawn only for the team: from here on, this browser's sessions are internal. */
export function InternalMarker() {
  useEffect(() => markInternal(), []);
  return null;
}
