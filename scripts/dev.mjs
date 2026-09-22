import { spawn } from "node:child_process";
const portFlag = process.argv.indexOf("--port");
const clientPort =
  portFlag > -1 ? process.argv[portFlag + 1] : process.env.PORT || "5173";
const children = [
  spawn(
    process.execPath,
    ["--watch", "--env-file-if-exists=.env", "server/index.mjs"],
    {
      stdio: "inherit",
      env: { ...process.env, PORT: process.env.API_PORT || "3100" },
    },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      clientPort,
      "--strictPort",
    ],
    { stdio: "inherit" },
  ),
];
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    children.forEach((p) => p.kill(signal));
    process.exit();
  });
children.forEach((p) =>
  p.on("exit", (code) => {
    if (code) {
      children.forEach((c) => c.kill());
      process.exit(code);
    }
  }),
);
