import { getRuntime } from "../../server/runtime.mjs";

// Preserve raw signed webhooks and streaming file uploads. The business API
// applies its own JSON/file limits and authorization to the original stream.
export const config = {
  api: { bodyParser: false, responseLimit: false },
};

export default function handler(req, res) {
  const app = getRuntime();
  // Next adds its own query object (including the catch-all path); Express
  // must parse the real URL so filters and repeated query values stay intact.
  delete req.query;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("finish", done);
      res.off("close", done);
      res.off("error", failed);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = (error) => {
      cleanup();
      reject(error);
    };
    res.once("finish", done);
    res.once("close", done);
    res.once("error", failed);
    app(req, res);
  });
}
