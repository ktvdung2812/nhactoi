import { NativeModule, registerWebModule } from "expo-modules-core";
import type { WindowLayoutInfoEvent } from "./NhactoiWindow.types";

type NhactoiWindowEvents = {
  onWindowLayoutInfo: (event: WindowLayoutInfoEvent) => void;
};

class NhactoiWindowWebModule extends NativeModule<NhactoiWindowEvents> {
  getSnapshot(): null {
    return null;
  }
}

export default registerWebModule(NhactoiWindowWebModule, "NhactoiWindow");
