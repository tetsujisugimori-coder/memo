"use strict";

const { randomBytes } = require("node:crypto");

function generateBridgeToken() {
  return randomBytes(32).toString("base64url");
}

if (require.main === module) console.log(generateBridgeToken());

module.exports = { generateBridgeToken };
