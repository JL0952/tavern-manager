import express from "express";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import localClients from "./middleware/localClients.js";
import localHosts from "./middleware/localHosts.js";
import localWrites from "./middleware/localWrites.js";
import managerPage, { defaultPageDirectory } from "./middleware/managerPage.js";
import requirePassword from "./middleware/requirePassword.js";
import syncCors, { isLocalNetworkAddress, loginCors, relayCors } from "./middleware/syncCors.js";
import authRouter from "./routes/auth.js";
import backupRouter from "./routes/backup.js";
import cardsRouter from "./routes/cards.js";
import libraryGraphRouter from "./routes/libraryGraph.js";
import relayRouter from "./routes/relay.js";
import statsRouter from "./routes/stats.js";
import syncRouter from "./routes/sync.js";
import tagsRouter from "./routes/tags.js";
import worldbooksRouter from "./routes/worldbooks.js";
import { findListeningAddress } from "./services/listeningPort.js";
import { managerAuth } from "./services/managerAuth.js";

const app = express();
const port = process.env.PORT || 3000;
// Every network interface unless HOST names one; other devices still need
// the Manager password.
const host = process.env.HOST || "";
const bodyLimit = "10mb";
const pageIndex = join(defaultPageDirectory, "index.html");

// First, so a peer outside the local network reaches nothing, files included.
app.use(localClients);
// Then, so a request under an unknown host name reaches nothing either.
app.use(localHosts);
// The page holds the password form, so no other site may frame it.
app.use((_request, response, next) => {
  response.set({ "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" });
  next();
});
// Before body parsing so sync errors (invalid JSON, 413) stay readable cross-origin.
app.use("/api/sync/v1", syncCors);
app.use("/api/relay/v1", relayCors);
app.use("/api/auth/login", loginCors);
// Before body parsing and uploads so a refused write is never read or stored.
app.use(localWrites);
// The page's own files, open to a device that has not signed in yet.
app.use(managerPage);
// Before body parsing and uploads, like localWrites.
app.use(requirePassword);
// Before the JSON parser: a relay file is stored exactly as it was sent.
app.use("/api/relay/v1", relayRouter);
app.use(express.json({ limit: bodyLimit }));
app.use("/avatars", express.static(fileURLToPath(new URL("../data/avatars", import.meta.url))));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/backup", backupRouter);
app.use("/api/library-graph", libraryGraphRouter);
app.use("/api/stats", statsRouter);
app.use("/api/sync/v1", syncRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/worldbooks", worldbooksRouter);

app.use((error, _request, response, _next) => {
  if (error?.type === "entity.too.large") {
    return response.status(413).json({
      error: "Request body too large.",
      limit: bodyLimit,
    });
  }

  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return response.status(400).json({ error: "Request body contains invalid JSON." });
  }

  console.error("Express error:", error);
  return response.status(500).json({ error: "Unexpected server error." });
});

// The IPv4 addresses other devices can type to reach this computer.
function networkUrls() {
  return Object.values(networkInterfaces()).flat()
    .filter((entry) => entry?.family === "IPv4" && !entry.internal && isLocalNetworkAddress(entry.address))
    .map(({ address }) => `http://${address}:${port}`);
}

async function logStartup() {
  console.log(`Tavern Manager: http://localhost:${port}`);

  if (!host) {
    const passwordNote = (await managerAuth.hasPassword())
      ? "with the Manager password"
      : "after you set a password in Manager (Password button)";
    for (const url of networkUrls()) console.log(`On other devices ${passwordNote}: ${url}`);
  }

  if (!existsSync(pageIndex)) {
    console.log("The Manager page is not built here: npm start builds it, npm run dev serves it on port 5173.");
  }
}

function refuseBusyPort(detail) {
  console.error(
    `Tavern Manager cannot start: port ${port} is already in use${detail}. ` +
      "Another Tavern Manager may still be running; stop it, then start again.",
  );
  process.exit(1);
}

// Two servers on one port would each get only some of the requests (macOS
// lets an IPv4 and an IPv6 server share it), so never start beside another.
const busyAddress = await findListeningAddress(port);

if (busyAddress) {
  refuseBusyPort(` (${busyAddress} answers)`);
}

const server = host ? app.listen(port, host, logStartup) : app.listen(port, logStartup);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    refuseBusyPort("");
  }

  throw error;
});
