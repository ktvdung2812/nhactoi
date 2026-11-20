import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";
import type { WindowLayoutInfoEvent } from "./NhactoiWindow.types";

type NhactoiWindowEvents = {
  onWindowLayoutInfo: (event: WindowLayoutInfoEvent) => void;
};

export class NhactoiWindowModule extends NativeModule<NhactoiWindowEvents> {}

export interface NhactoiWindowModule extends NativeModule<NhactoiWindowEvents> {
  /** Returns the latest complete native payload, if a collector has emitted one. */
  getSnapshot(): WindowLayoutInfoEvent | null;
}

/** Optional keeps web and Expo Go usable until a dev build with the native module is installed. */
export default requireOptionalNativeModule<NhactoiWindowModule>(
  "NhactoiWindow",
);
