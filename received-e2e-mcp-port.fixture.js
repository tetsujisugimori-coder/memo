"use strict";
// Preloaded only by E2E child processes, never by the production adapter.
const http = require("node:http");
const original = http.request;
http.request = (options, ...args) => original({ ...options, ...(options.hostname === "127.0.0.1" && options.port === 8791 ? { port: Number(process.env.MEMO_E2E_RECEIVER_PORT) } : {}) }, ...args);
