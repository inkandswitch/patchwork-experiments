// The worker's entry: new Worker(new URL("./worker.js", import.meta.url), { type: "module" }),
// bundled with its imports (automerge-repo among them). See remote.js.
import { serve } from "./serve.js";

serve(self);
