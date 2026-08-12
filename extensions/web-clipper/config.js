// 接続先はMemo-Nexusの開発・本番URLだけに限定します。
// 開発サーバーのポートや公開URLを変える場合は manifest.json と同時に更新してください。
globalThis.MEMO_NEXUS_CLIPPER_CONFIG = {
  distributionChannel: "unpacked-development",
  distributions: {
    "unpacked-development": { label: "ローカル開発版", defaultTarget: "development" },
    "edge-store": { label: "Edgeアドオン版", defaultTarget: "production" }
  },
  targets: {
    development: "http://127.0.0.1:5500/",
    production: "https://tetsujisugimori-coder.github.io/memo/"
  },
  storage: {
    targetKey: "memoNexusClipperTargetEnvironment",
    reloadAttemptKey: "memoNexusClipperReloadAttempt"
  },
  updates: {
    "unpacked-development": {
      development: {
        strategy: "local-manifest",
        manifestUrl: "http://127.0.0.1:5500/extensions/web-clipper/manifest.json"
      },
      production: { strategy: "none" }
    },
    "edge-store": {
      development: { strategy: "browser-managed" },
      production: { strategy: "browser-managed" }
    }
  }
};
