// 接続先はMemo-Nexusの開発・本番URLだけに限定します。
// 開発サーバーのポートや公開URLを変える場合は manifest.json と同時に更新してください。
globalThis.MEMO_NEXUS_CLIPPER_CONFIG = {
  targets: {
    development: "http://127.0.0.1:5500/",
    production: "https://tetsujisugimori-coder.github.io/memo/"
  },
  defaultTarget: "development",
  storage: {
    targetKey: "memoNexusClipperTargetEnvironment",
    reloadAttemptKey: "memoNexusClipperReloadAttempt"
  },
  updates: {
    development: {
      strategy: "local-manifest",
      manifestUrl: "http://127.0.0.1:5500/extensions/web-clipper/manifest.json"
    },
    production: { strategy: "browser-managed" }
  }
};
