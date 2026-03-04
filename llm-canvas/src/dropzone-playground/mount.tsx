import { createRoot } from "react-dom/client";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { PlaygroundUI } from "./components/PlaygroundUI.tsx";

const mount: ToolImplementation = (_handle, element) => {
  const root = createRoot(element);
  root.render(<PlaygroundUI />);
  return () => root.unmount();
};

export default mount;
