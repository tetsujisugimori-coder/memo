# 静的チェッカー3件の局所修正契約

修正基準HEAD: `544aebbbe57b3a4380e8611af0a5cfbf4ce98328`。以下の契約を実装修正より先に記録する。旧証拠・取得台帳・解析結果の内容を変更せず、MATCHの証明範囲を拡大しない。

## 判定・終了コード（今回の契約）

|入口・条件|判定と理由|終了コード|
|---|---|---|
|saved-index: 必須files欠落 / 空list|UNKNOWN / index-files-missing または index-files-empty|2（不完全）|
|saved-index: decoded indexがobjectでない、filesがlistでない、recordの型・値の形式不正|FAIL / index-shape、index-files-shape、index-record-shape等|1|
|saved-index: recordのfile/digest等の必須情報欠落、実file欠落、独立profile未指定・必須集合の一部欠落|UNKNOWN / index-record-incomplete、unavailable-bytes、index-profile-required、missing-index-file等|2|
|saved-index: 独立profileと矛盾、重複、不正path、実bytes/hash矛盾|FAIL / pinned-index-*、duplicate-or-outside-root、invalid-path、digest-or-size等|1（UNKNOWNが併存してもFAIL優先）|
|saved-index: 独立profileの必須集合と各digestが一致し、全file/raw照合成立|各record MATCH|0（限定された静的照合のみ）|
|receipts: 取得失敗、保存bytesのhash/size一致|UNKNOWN。acquisition=FAILED、contentIntegrity=MATCH|従来どおりbatch終了0。取得対象の真正性MATCHではない|
|receipts: 取得失敗でも保存bytesに明示矛盾|FAIL。acquisition=FAILED、contentIntegrity=FAIL|1|
|receipts: 保存bytes取得不能|UNKNOWN / unavailable-bytes等|従来どおりbatch終了0。欠落を肯定しない|
|receipts: 同一の解決済みpathの別表記 / pinned identity不一致 / root外path|FAIL|1|
|controls: literal期待値との不一致|ok=false|1。全期待一致は0（負対照を実験PASSにしない）|
|外部fileの読取り・JSON構文解析不能|UNKNOWN、errorを出力|既存の2を維持。decoded schema違反のFAILとは分離|

saved-indexの最小schemaは非空`files` listと、その各objectの非空相対`file`、小文字hex64桁の`sha256`または`gzipSha256`。`rawSha256`がある場合はgzipを展開せずメモリで復号してhash照合し、`rawBytes`がある場合は非負整数かつrawSha256必須。複数のcompressed digest主張がある場合は一致必須。未記載の必須情報はUNKNOWN、存在するが型・形式不正の値はFAILとする。

独立profileは`expectations.json`へ固定Git版`592ccb63478d0a23312237d1f736a419c096f5f8`のD/E・F・G indexの必須file集合・digestを保存する。出自のGit blob・index SHA-256も記録する。照合中の入力indexの件数や自己申告だけでは完全性を証明しない。既存配置では親の実験directory名からprofileを選び、移設時はCLIの`--profile`で明示する。未知profileの非空indexはfile単体を照合しても全体UNKNOWNとする。

receiptと期待値は同じpath解決を使い、解決済み絶対pathをhostのcase規則で正規化して重複・pin・必須receipt欠落を照合する。root内symlink aliasも同じキーとし、root外への解決は読取り前に拒否する。portableに解釈を固定するためbackslash、drive/UNC/絶対path、`..`、Windowsのdevice/ADS・末尾dot/spaceを拒否する。`./`と内側の重複slashは同じ相対fileとして扱う。静止したfilesystemを対象とし、同時にsymlinkを変更する攻撃への保証は追加しない。

今回の検証は原資料を再取得しない。原本が失われていればNOT_TESTED。新規tracked fileは追加せず、合成入力・CLI stdout/exit code・hashは別の今回用一時directoryへ保存し、既存一時証拠を上書きしない。

## 修正前の既存記録（歴史的結果、今回の再実測と分離）

自己照合の記録。独立レビューはPR本文の固定HEAD記録と分離する。製品・既存judge/schema/Collector/runner・旧検査器・旧recompute scriptは実行していない。

|対象|結果|限界|
|---|---|---|
|receipt250件|MATCH247、UNKNOWN3、FAIL0、CLI終了0|UNKNOWNはbuilder候補と固定版2pathの404。終了0は全証拠取得成功ではない|
|G独立pin|#423由来のhash/size/run/artifactと一致|他receiptの自己記載hash一致は独立origin認証でない|
|fixture9件|全literal期待値と一致、CLI終了0|合成反例、実Worker実験の成功件数でない|
|不正JSON manifest|UNKNOWN、CLI終了2|解析不能な外部資料を肯定しない|
|保存index|D/E19、F20、G25のfile/gzip/raw hash全一致、各CLI終了0|recorder全観測の完全性とは別|
|元結果ZIPとGit保存raw|D/E・F・Gのresults.jsonがbyte一致|派生analysisをnative直接観測にしない|
|結果source参照|T7四結果+DE/F/Gの7JSON、66参照が記録checkout固定Git objectと一致|PR HEADと実merge checkoutを区別。native binaryへのjoinでない|
|source索引|#403 CAPTURED25件のSHA-256/blob一致|build全体ではない|
|local source manifest|372件+11件のblob/行数不一致0|source-only。new-source-manifestの404を成功件数にしない|
|現在archive|65memberのCRC/hash/ELF静的解析、出力とarchive-inspection一致|現在bytes。依存名は実ロードlibrary実体でない|
|pw_run.sh|現在ZIPと固定Playwright source byte一致|当時cache/条件の一致は未証明|
|観測prefix|D152/E334/F346/G346。内部欠番/重複0、overflow=false|flush/high-waterなし、未受信tailなしとは言えない|
|local有限探索|指定6root対象884fileをhash、ELF/native候補名0|全worktree/外部storage/ZIP内部の全探索ではない|

## 意図的に壊した資料と独立期待値

subjectはfixtures/subjects.json、期待値はexpectations.jsonの別file。3bytesのabc、literal SHA-256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad、synthetic-run-Aを使う。subjectから期待値を再生成しない。

|対照|入力|期待|
|---|---|---|
|valid|正しいpayload/size/hash/run|MATCH|
|missing-file|存在しないfile参照|UNKNOWN、必須receipt欠落もUNKNOWN|
|wrong-run|hash一致のままsynthetic-run-Bへ変更|FAIL（独立identity pin不一致）|
|wrong-digest|digestを0へ変更|FAIL|
|duplicate|同receiptを二重登録|MATCH、FAIL|
|invalid-manifest|receiptsを文字列へ破壊|FAIL（shape）|
|external-unavailable|取得exitCode=1|UNKNOWN|
|outside-root|../outside.txt参照|FAIL、必須receipt欠落UNKNOWN。root外を読まない|
|missing-receipt|空list|UNKNOWN|

## 静的な偽肯定の反例

- 同URLでも旧digest receiptがなければ「現在archive=旧archive」はUNKNOWN。
- bundled/checkout条件不成立で汎用MiniBrowserのみある机上入力では、WPE探索設定だけから実WPEを認定できない。
- 372 sourceが一致しても生成物/config/link/ELFが欠ければB3〜B7はUNKNOWN。
- 親ELF digestがあってもchild/module/Worker/VM世代joinがなければB8はUNKNOWN。
- 1..N連番prefixでも最終high-waterがN+Kか不明ならtailはUNKNOWN。
- terminate戻りだけでnative thread退出/VM entry終端がなければJ2はUNKNOWN。
- 別process/Worker世代でowner/tx1を再利用する入力ではsame-native joinはUNKNOWN。別世代が明示されればその同一性主張はFAIL。

これらは今回実証拠の不一致を観測したという意味ではない。局所MATCHや文書整合をJ2/U-C/条件U/実行承認のPASSへ移送しない。

実CLI stdoutは一時rootのcheck-*.json、checks-all.jsonに保存。再現コマンドはREADMEのF節。[temporary-inventory.json](temporary-inventory.json)に取得・一時fileのsize/hash・削除方針を記録する。checkerは入力を書かず取得fileを実行しない。

J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD。

2026年11月5日 JST

## 今回の実測：RED→GREENと回帰（実装HEAD固定）

実装基準HEADは`544aebbbe57b3a4380e8611af0a5cfbf4ce98328`、修正後の実CLI対象HEADは`c6c92e27ec9a5b46b65eece265bcb250a324fc74`。以下の記録を追加する文書commitの親が修正後実装HEADとなり、checker/fixture/期待値のbytesは変えない。最終提出HEADはPRコメントへ記録する。実装成功と、後から行う子エージェントの独立レビュー成功は別に扱う。

親のdriverが固定Git objectからbefore.py / after.pyを別名で保存して実CLIを起動した。checker自身はsubprocessを起動しない。同じ入力fileとpayload bytesを両版へ渡し、stdout・実終了コードを保存した。P3反例のsubjects.jsonは基準HEADの既存fixtureを今回用rootへ無変換copyしたもので、入力を修正結果に合わせて変えていない。

|反例|修正前の実結果・終了|修正後の実結果・終了|期待との一致|
|---|---|---|---|
|P2-01 `{}`|`[]`、0（RED）|UNKNOWN / index-files-missing、2|GREEN|
|P2-01 `files: []`|`[]`、0（RED）|UNKNOWN / index-files-empty、2|GREEN|
|P2-02 同fileの`./` alias|MATCH / MATCH、0（RED）|MATCH / FAIL、1|GREEN|
|P3-01 exitCode=1かつ保存bytesのdigest/size矛盾|MATCH / UNKNOWN、0（RED）|MATCH / FAIL、1。acquisition=FAILED、contentIntegrity=FAIL|GREEN|

実測の入力・両HEAD・JSON結果・終了コード・stdout hash・期待値・実行環境:

```json
{
  "measuredBeforeHead": "544aebbbe57b3a4380e8611af0a5cfbf4ce98328",
  "measuredAfterHead": "c6c92e27ec9a5b46b65eece265bcb250a324fc74",
  "environment": {
    "python": "3.14.7 (tags/v3.14.7:823f032, Aug  5 2026, 10:51:32) [MSC v.1944 64 bit (AMD64)]",
    "platform": "Windows-11-10.0.26300-SP0",
    "linux": "NOT_TESTED: WSL not installed, no tools installed"
  },
  "afterScriptSha256": "5dc49634eceef03488abbe54ce7eaef0dbde3574b489349a88ebe274affb5ea5",
  "cases": [
    {
      "id": "P2-01-empty-object",
      "input": {},
      "inputSha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      "beforeHead": "544aebbbe57b3a4380e8611af0a5cfbf4ce98328",
      "beforeExit": 0,
      "beforeResult": [],
      "beforeStdoutSha256": "a5338d955b09046ec0b16f3a9625b7955c763aae07dc722e474e6078745f932f",
      "beforeMatchesExpected": false,
      "afterHead": "c6c92e27ec9a5b46b65eece265bcb250a324fc74",
      "afterExit": 2,
      "afterResult": [
        {
          "status": "UNKNOWN",
          "reason": "index-files-missing"
        }
      ],
      "afterStdoutSha256": "41ef74a3553c36c934b9319bad1bc6979da33835773df1ca574a8e0a7583a604",
      "expectedStatuses": [
        "UNKNOWN"
      ],
      "expectedExit": 2,
      "sameInput": true,
      "afterMatchesExpected": true
    },
    {
      "id": "P2-01-empty-list",
      "input": {
        "files": []
      },
      "inputSha256": "ccfe9165bef60ef933645186059b1ea0dc25f1f549d4689e062ba1c2ffefc127",
      "beforeHead": "544aebbbe57b3a4380e8611af0a5cfbf4ce98328",
      "beforeExit": 0,
      "beforeResult": [],
      "beforeStdoutSha256": "a5338d955b09046ec0b16f3a9625b7955c763aae07dc722e474e6078745f932f",
      "beforeMatchesExpected": false,
      "afterHead": "c6c92e27ec9a5b46b65eece265bcb250a324fc74",
      "afterExit": 2,
      "afterResult": [
        {
          "status": "UNKNOWN",
          "reason": "index-files-empty"
        }
      ],
      "afterStdoutSha256": "422e2b431291bfbf83dee6e6948b08ad1f159ddb1cb4db6ae34fdd6a65b7eb16",
      "expectedStatuses": [
        "UNKNOWN"
      ],
      "expectedExit": 2,
      "sameInput": true,
      "afterMatchesExpected": true
    },
    {
      "id": "P2-02-alias",
      "input": {
        "receipts": [
          {
            "file": "payload.txt",
            "size": 3,
            "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "runId": "synthetic-run-A"
          },
          {
            "file": "./payload.txt",
            "size": 3,
            "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "runId": "synthetic-run-A"
          }
        ]
      },
      "inputSha256": "b88e7c5b19cc9c39884d665a2e90f884113415f266ab32031a4427edd40a5888",
      "beforeHead": "544aebbbe57b3a4380e8611af0a5cfbf4ce98328",
      "beforeExit": 0,
      "beforeResult": [
        {
          "file": "payload.txt",
          "status": "MATCH",
          "reasons": []
        },
        {
          "file": "./payload.txt",
          "status": "MATCH",
          "reasons": []
        }
      ],
      "beforeStdoutSha256": "f083be619083a04a3a580c87d271c4e3c30ca1c5aa6365b53e48e0e400b93639",
      "beforeMatchesExpected": false,
      "afterHead": "c6c92e27ec9a5b46b65eece265bcb250a324fc74",
      "afterExit": 1,
      "afterResult": [
        {
          "file": "payload.txt",
          "status": "MATCH",
          "reasons": [],
          "acquisition": "SUCCEEDED",
          "contentIntegrity": "MATCH"
        },
        {
          "file": "./payload.txt",
          "status": "FAIL",
          "reasons": [
            "duplicate-or-outside-root"
          ],
          "acquisition": "SUCCEEDED",
          "contentIntegrity": "NOT_CHECKED"
        }
      ],
      "afterStdoutSha256": "630abdfabdf3ff3869da4a603f769f137e4407b85b996f443ceee69610089951",
      "expectedStatuses": [
        "MATCH",
        "FAIL"
      ],
      "expectedExit": 1,
      "sameInput": true,
      "afterMatchesExpected": true
    },
    {
      "id": "P3-01-failed-corrupt",
      "input": {
        "receipts": [
          {
            "file": "payload.txt",
            "size": 3,
            "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "runId": "synthetic-run-A"
          },
          {
            "file": "subjects.json",
            "size": 0,
            "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
            "exitCode": 1
          }
        ]
      },
      "inputSha256": "7d21b1005d3ae85a541b19787fdea62ad5c8d444ed178745218a848c941fb3ca",
      "beforeHead": "544aebbbe57b3a4380e8611af0a5cfbf4ce98328",
      "beforeExit": 0,
      "beforeResult": [
        {
          "file": "payload.txt",
          "status": "MATCH",
          "reasons": []
        },
        {
          "file": "subjects.json",
          "status": "UNKNOWN",
          "reasons": [
            "unavailable-bytes"
          ]
        }
      ],
      "beforeStdoutSha256": "ca71f1c17af6c173c81912f2257df3a059db33a7086a4115a9bad3cd5b5c31aa",
      "beforeMatchesExpected": false,
      "afterHead": "c6c92e27ec9a5b46b65eece265bcb250a324fc74",
      "afterExit": 1,
      "afterResult": [
        {
          "file": "payload.txt",
          "status": "MATCH",
          "reasons": [],
          "acquisition": "SUCCEEDED",
          "contentIntegrity": "MATCH"
        },
        {
          "file": "subjects.json",
          "status": "FAIL",
          "reasons": [
            "digest-or-size"
          ],
          "acquisition": "FAILED",
          "contentIntegrity": "FAIL"
        }
      ],
      "afterStdoutSha256": "f5468e5d8c7d1e126867fdc6c31d06c708b239ed47f098000f92b243ea14b1bc",
      "expectedStatuses": [
        "MATCH",
        "FAIL"
      ],
      "expectedExit": 1,
      "sameInput": true,
      "afterMatchesExpected": true
    }
  ]
}
```

### 回帰・境界

- 既存9対照の入力object・期待値は基準HEADと等価で、前後とも9/9期待一致。旧9対照の期待値を変更したものは0件。追加20対照を含め29/29期待一致。
- 元250 receiptをfile順に全件比較し、247 MATCH / 3 UNKNOWN / 0 FAIL、前後で判定が変わった行は0件。UNKNOWN3件はbuilder-candidate.json、pw-build-path.json、pw-prepare-path.json。保存された404応答本文はcontentIntegrity=MATCHだが、acquisition=FAILED、全体UNKNOWNを維持する。旧reason unavailable-bytesからacquisition-failedへの変更は、取得失敗とbytes取得不能の区別であり、判定昇格ではない。
- 各行の前後比較全文は`C:\Users\tetsu\AppData\Local\Temp\memo-pr425-fix-g0jx0d5n\receipt-status-comparison-250.json`（SHA-256 `281afd417997328619e784dc66b141b42863670a2e771a2f9128373fc828fa59`）。元250fileのsize/hashも別保存し、検証後も変更0件。原資料再取得0、証拠置換0。
- 保存indexの実CLI結果はD/E19、F20、G25すべてMATCH・終了0。固定profileは入力indexでなく指定Git版の19/20/25 file集合・digestから作った。profile出自はexpectations.jsonのsource.commit/path/gitBlob/indexSha256。各indexから1recordだけ除いた独立のメモリ入力は18/19/24 MATCH + missing-index-file UNKNOWNで、不完全な集合を全体MATCHとしない。
- Windows junctionではroot内alias重複、root外junction拒否、case alias重複、junction aliasによるpin不一致検出を実測。root外の合成payload bytesをcheckerが読んでいないことをauditで確認した。
- 通常file symlink作成はWinError1314のためNOT_TESTED。LinuxはWSL未導入・Docker不在のためNOT_TESTED。インストールや昇格による回避は行わない。junction実測を通常symlink/Linuxの実測に算入しない。
- checker ASTのimportはargparse/gzip/hashlib/json/os/pathlib/re/struct/zipfile/zlibのみ。receipts250・controls29・zip・saved-index3系列の計6 CLI経路をPython audit hook下で呼び、network/subprocess/shell/write/mutationの禁止eventは0件。入力読取りとメモリ上のZIP/gzip解析のみ。親driverのCLI起動とchecker内部の操作を区別する。

### 再現コマンドと保存

```powershell
$fixEvidence = 'C:\Users\tetsu\AppData\Local\Temp\memo-pr425-fix-g0jx0d5n'
python -B "$fixEvidence/before.py" saved-index "$fixEvidence/fixtures/P2-01-empty-object.json"
python -B "$fixEvidence/after.py" saved-index "$fixEvidence/fixtures/P2-01-empty-object.json"
python -B "$fixEvidence/after.py" receipts "$fixEvidence/fixtures/P2-02-alias.json" "$fixEvidence/fixtures" "$fixEvidence/control-pins.json"
python -B "$fixEvidence/after.py" receipts "$fixEvidence/fixtures/P3-01-failed-corrupt.json" "$fixEvidence/fixtures" "$fixEvidence/control-pins.json"
python -B design/idb-provenance-inventory/static-check.py controls design/idb-provenance-inventory/fixtures/subjects.json design/idb-provenance-inventory/expectations.json
```

今回用rootは`C:\Users\tetsu\AppData\Local\Temp\memo-pr425-fix-g0jx0d5n`。before-results.json、fixed-head-results.json、before-/fixed-*.stdout.json、receipt-status-comparison-250.json、safety-junction-results.jsonに保存。取得原本は先行rootに残し、新規tracked fileなし。今回一時fileのsize/hash・削除方針は同rootのfix-temporary-inventory.json（SHA-256 `7d254cf5459ed4b7f5c19b8a7233e85d90717300a72955d6860823f9232c8c04`）に記録した。独立レビュー用に保持し、自動削除しない。受入後、junctionを辿らず今回用directoryの絶対pathを確認して削除する方針。

### サブエージェント機能の事前確認

実行環境にはcollaboration.spawn_agent/list_agents/send_message/wait_agentが公開され、list_agentsの実呼出しで応答を確認。local config.tomlのfeatures.multi_agentとagents.max_threadsはNOT_SETであり、その値から利用可否を推定しない。公式の[Subagents資料](https://learn.chatgpt.com/docs/agent-configuration/subagents)は一般の委任説明の参照であり、現在環境での利用成功の証拠は実際の起動・別主体の応答とする。実装後の新規子起動と固定HEADレビュー結果はPRコメント・最終報告へ記録する。

現時点の親実装・Windows静的検証は成立。今回の独立レビューは未実施で、成功とはまだ記録しない。Linuxと通常symlinkの実測を含む総合評価はPARTIAL。

BUILD_BINDING=UNKNOWN / J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD。

2026年11月05日 19:37 JST
