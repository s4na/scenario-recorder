# シナリオレコーダー

Webアプリ上の作業をChrome拡張で記録し、確認しやすい操作ログとして保存・エクスポートするMVPです。

## 機能一覧

- Manifest V3のChrome拡張
- popup UIから録画開始、保存
- click、input、select、submit、通常遷移、SPA遷移の記録
- ページ上の文字選択の記録
- `chrome.storage.local` への複数記録保存
- 保存済みシナリオ一覧の表示、削除
- シナリオごとのPlaywrightテストコードとJSONLを含むzip取得
- 全シナリオのPlaywrightテストコードとJSONLを含むzip取得
- 録画中の右下ステップオーバーレイ
- 操作対象の周辺コンテキスト記録
- マスク済み入力値からのsecret変数生成
- password、token、secret、credit card系入力値のマスク

## インストール方法

Node.js 22.12.0 以上が必要です。

```bash
npm install
```

## 開発サーバー起動方法

```bash
npm run dev
```

## ビルド方法

```bash
npm run build
```

## Chromeで拡張を読み込む方法

### Releaseから読み込む場合

1. GitHub Releasesから `scenario-recorder-v*.zip` をダウンロードします。
2. zipを展開します。
3. Chromeで `chrome://extensions` を開きます。
4. 右上の「デベロッパー モード」を有効にします。
5. 「パッケージ化されていない拡張機能を読み込む」を押します。
6. 展開したディレクトリを選択します。

GitHubが自動生成する「Source code」zipは開発用ソースです。Chrome拡張として読み込むための `assets/*.js` を含まないため、そのまま読み込まないでください。

### ローカルでビルドして読み込む場合

1. `npm run build` を実行します。
2. Chromeで `chrome://extensions` を開きます。
3. 右上の「デベロッパー モード」を有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」を押します。
5. このリポジトリの `dist` ディレクトリを選択します。

## 使い方

1. 拡張のpopupを開き、「録画開始」を押します。
2. 対象Webページ上でクリック、入力、選択、画面遷移を行います。
3. 作業中はページ右下のオーバーレイで、直近の操作とこれまでのステップを確認できます。
4. 作業が終わったら拡張のpopupに戻り、「保存」を押します。
5. 保存したシナリオは「シナリオ一覧」に追加されます。不要なシナリオは一覧から削除できます。
6. シナリオごとの「zip取得」または「全シナリオをzipで取得」から、PlaywrightテストコードとJSONLを含むzipを保存します。

シナリオ名は日時と開始URLから自動で作られます。

## 保存されるJSONL形式

1記録のzipには、継続実行用のPlaywrightテストコード下書きと、補助情報としての `scenario-recorder/jsonl/v1` JSONLが入ります。JSONLの1行目はメタ情報、以降はsession、step、assertionの操作ログです。

```jsonl
{"kind":"meta","schemaVersion":"scenario-recorder/jsonl/v1","scenarioSchemaVersion":"scenario-recorder/v1","id":"scenario_xxx","name":"予約作成","createdAt":"2026-06-23T10:00:00.000Z","updatedAt":"2026-06-23T10:05:00.000Z","startUrl":"https://staging.example.com/login","baseUrl":"https://staging.example.com","metadata":{"userAgent":"...","extensionVersion":"0.1.0","recordedBy":"scenario-recorder"}}
{"kind":"session","index":0,"startedAt":"2026-06-23T10:00:00.000Z","stoppedAt":"2026-06-23T10:05:00.000Z"}
{"kind":"step","index":0,"id":"step_xxx","type":"click","timestamp":0,"url":"https://staging.example.com/login","target":{"tagName":"button","selectorCandidates":[]}}
{"kind":"assertion","index":1,"id":"step_yyy","type":"assert","timestamp":1,"url":"https://staging.example.com/dashboard","assertion":{"kind":"url","expected":"https://staging.example.com/dashboard"}}
```

## 互換JSON形式

UI内部と互換エクスポート用のシナリオJSONは `scenario-recorder/v1` です。

```json
{
  "schemaVersion": "scenario-recorder/v1",
  "id": "scenario_xxx",
  "name": "予約作成",
  "createdAt": "2026-06-23T10:00:00.000Z",
  "updatedAt": "2026-06-23T10:05:00.000Z",
  "startUrl": "https://staging.example.com/login",
  "baseUrl": "https://staging.example.com",
  "recording": {
    "sessions": []
  },
  "steps": [],
  "metadata": {
    "userAgent": "...",
    "extensionVersion": "0.1.0",
    "recordedBy": "scenario-recorder"
  }
}
```

1記録のエクスポートは `${記録名}.zip` です。zipの中には、同じ記録から生成した `.spec.ts` と `.jsonl` が入ります。Playwrightコードは実行可能な下書き、JSONLはLLMや人間がlocator、周辺コンテキスト、元操作を確認するための補助情報です。

```text
2026-06-25_12-34-56_example-com-login.zip
├── 2026-06-25_12-34-56_example-com-login.spec.ts
└── 2026-06-25_12-34-56_example-com-login.jsonl
```

全記録の一括エクスポートは `scenario-records-yyyyMMdd-hhmmss.zip` です。zipの中には、保存済み記録ごとのディレクトリが作られ、それぞれに `.spec.ts` と `.jsonl` が入ります。

```text
scenario-records-20260625-124000.zip
├── 2026-06-25_12-34-56_example-com-login/
│   ├── 2026-06-25_12-34-56_example-com-login.spec.ts
│   └── 2026-06-25_12-34-56_example-com-login.jsonl
└── 2026-06-25_12-36-10_example-com-booking/
    ├── 2026-06-25_12-36-10_example-com-booking.spec.ts
    └── 2026-06-25_12-36-10_example-com-booking.jsonl
```

## 周辺コンテキスト

記録時は、操作対象のselector候補、テキスト、role、id、座標に加えて、テーブル行、カード、セクション、フォームなど近い要素の短い文脈を標準で保存します。「同じ名前のボタンが複数ある画面」をあとから読み解きやすくするためです。

ページHTML全体、DOMツリー全体、スクリーンショット、CSS、ネットワークログは保存しません。周辺コンテキストは操作対象の近くに限定し、テキスト量にも上限を設けています。メールアドレス、電話番号風の値、長いID、OTP風の値は文脈テキスト内でマスクします。ただし、マスクできない業務情報や個人情報が含まれる可能性はあるため、必要に応じて対象 origin やマスク対象を調整してください。

## セキュリティ・プライバシー上の注意

- MVPでは開発しやすさのため `host_permissions` に `<all_urls>` を使っています。
- 本番運用では対象 origin に絞るべきです。
- 入力値は外部APIへ送信しません。
- 入力値を `console.log` に出力しません。
- password、token、secret、credit card系の入力値は保存前にマスクします。
- URL内の `token`、`code`、`secret` などの秘匿クエリ・ハッシュ値も保存前にマスクします。
- emailやphoneはMVPでは保存対象です。必要に応じて `src/content/masking.ts` でマスク対象を拡張してください。

## 現在の制限

- チーム共有、クラウド同期はありません。
- スクリーンショット、動画、ネットワークログは保存しません。
- セレクタ候補はMVPとしての推定であり、すべてのWebアプリで一意性を保証するものではありません。

## 今後の拡張案

- スクリーンショット保存
- 動画保存
- ネットワークログ保存
- チーム共有
- クラウド同期
- セレクタ候補の一意性検証
