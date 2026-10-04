import express from "express";
import { fileURLToPath } from "node:url";
import localClients from "./middleware/localClients.js";
import localHosts from "./middleware/localHosts.js";
import localWrites from "./middleware/localWrites.js";
import syncCors, { relayCors } from "./middleware/syncCors.js";
import backupRouter from "./routes/backup.js";
import cardsRouter from "./routes/cards.js";
import libraryGraphRouter from "./routes/libraryGraph.js";
import relayRouter from "./routes/relay.js";
import statsRouter from "./routes/stats.js";
import syncRouter from "./routes/sync.js";
import tagsRouter from "./routes/tags.js";
import worldbooksRouter from "./routes/worldbooks.js";
import { findListeningAddress } from "./services/listeningPort.js";

const app = express();
const port = process.env.PORT || 3000;
// This computer only unless HOST says otherwise (npm run dev:lan).
const host = process.env.HOST || "127.0.0.1";
const bodyLimit = "10mb";

// First, so a peer outside the local network reaches nothing, files included.
app.use(localClients);
// Then, so a request under an unknown host name reaches nothing either.
app.use(localHosts);
// Before body parsing so sync errors (invalid JSON, 413) stay readable cross-origin.
app.use("/api/sync/v1", syncCors);
app.use("/api/relay/v1", relayCors);
// Before body parsing and uploads so a refused write is never read or stored.
app.use(localWrites);
// Before the JSON parser: a relay file is stored exactly as it was sent.
app.use("/api/relay/v1", relayRouter);
app.use(express.json({ limit: bodyLimit }));
app.use("/avatars", express.static(fileURLToPath(new URL("../data/avatars", import.meta.url))));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

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

function logStartup() {
  console.log(`Tavern Manager server local URL: http://localhost:${port}`);
  console.log(`Tavern Manager server bind host: ${host || "default"}`);
  console.log(`Tavern Manager server port: ${port}`);
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
