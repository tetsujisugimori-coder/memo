// 接続先はMemo-Nexusの開発・本番URLだけに限定します。
// 開発サーバーのポートや公開URLを変える場合は manifest.json と同時に更新してください。
globalThis.MEMO_NEXUS_CLIPPER_CONFIG = {
  targets: {
    development: "http://localhost:5500/",
    production: "https://tetsujisugimori-coder.github.io/memo/"
  },
  defaultTarget: "development"
};
