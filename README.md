# シナリオレコーダー

Webアプリ上のユーザー操作をChrome拡張で記録し、CodexやPlaywrightへ渡しやすいJSONL操作ログとして保存するMVPです。

## 機能一覧

- Manifest V3のChrome拡張
- popup UIから記録開始、一時停止、再開、停止、クリア、保存
- click、input、select、submit、通常遷移、SPA遷移の記録
- ページ上の文字選択の記録
- `chrome.storage.local` への複数シナリオ保存
- 保存済みシナリオ一覧の表示
- 保存済みシナリオの実行
- シナリオ単位のJSONLエクスポート
- シナリオ単位のJSONエクスポート
- 全シナリオの一括JSONエクスポート
- Playwrightテストコード生成
- シナリオJSON/JSONLのインポート
- 保存済みシナリオの名前、説明、タグ編集
- 互換JSON Schemaのダウンロード
- 対象 origin 設定
- 記録詳細度設定（minimal/context）
- 現在URL、タイトルのassertion追加
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

1. 拡張のpopupを開き、用途に合わせて「Codex向け」または「軽量」を選びます。
2. 「記録開始」を押します。
3. 対象Webページ上でクリック、入力、選択、画面遷移を行います。
4. 必要に応じて「一時停止」「再開」を使います。
5. 「停止して確認」を押します。
6. 必要ならシナリオ名を入力して「保存してJSONLへ進む」を押します。未入力の場合は `yyyy-mm-dd_hh-mm-ss_host-com-path` のように、日時と開始URLから作った名前で保存されます。
7. 「渡す」の「Codex用JSONLをダウンロード」からJSONLを保存します。
8. 必要に応じてJSONやPlaywrightコードもダウンロードします。

保存済みのシナリオは「シナリオ一覧」から個別に実行、JSONLダウンロード、JSONダウンロード、Playwrightダウンロード、編集、削除できます。

## 保存されるJSONL形式

シナリオ単位の主な成果物は `scenario-recorder/jsonl/v1` のJSONLです。1行目はメタ情報、以降はsession、step、assertionの操作ログです。

```jsonl
{"kind":"meta","schemaVersion":"scenario-recorder/jsonl/v1","scenarioSchemaVersion":"scenario-recorder/v1","id":"scenario_xxx","name":"予約作成","createdAt":"2026-06-23T10:00:00.000Z","updatedAt":"2026-06-23T10:05:00.000Z","startUrl":"https://staging.example.com/login","baseUrl":"https://staging.example.com","metadata":{"userAgent":"...","extensionVersion":"0.1.0","recordedBy":"scenario-recorder"}}
{"kind":"session","index":0,"startedAt":"2026-06-23T10:00:00.000Z","stoppedAt":"2026-06-23T10:05:00.000Z"}
{"kind":"step","index":0,"id":"step_xxx","type":"click","timestamp":0,"url":"https://staging.example.com/login","target":{"tagName":"button","selectorCandidates":[]}}
{"kind":"assertion","index":1,"id":"step_yyy","type":"assert","timestamp":1,"url":"https://staging.example.com/dashboard","assertion":{"kind":"url","expected":"https://staging.example.com/dashboard"}}
```

## 互換JSON形式

UI内部と互換エクスポート用のシナリオJSONは `scenario-recorder/v1` です。
popupの「JSON Schema」では、このJSON形式のschemaを保存できます。

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

全シナリオ一括エクスポートは `scenario-recorder/export/v1` です。

```json
{
  "schemaVersion": "scenario-recorder/export/v1",
  "exportedAt": "2026-06-23T10:10:00.000Z",
  "scenarios": []
}
```

## 記録詳細度

popupの「記録の詳細度」で、クリック対象などの保存粒度を選べます。

- `minimal`: 対象要素のselector候補、テキスト、role、id、座標などを保存します。
- `context`: `minimal`に加えて、テーブル行、カード、セクション、フォームなど近い親要素の短い文脈を保存します。CodexにJSONLを渡して「同じ名前のボタンが複数ある画面」を扱う場合に向いています。メールアドレス、電話番号風の値、長いID、OTP風の値は文脈テキスト内でマスクします。

`context`は周辺DOMテキストを保存するため、マスクできない業務情報や個人情報が含まれる可能性があります。必要に応じて対象 origin やマスク対象を調整してください。

## セキュリティ・プライバシー上の注意

- MVPでは開発しやすさのため `host_permissions` に `<all_urls>` を使っています。
- 本番運用では対象 origin に絞るべきです。
- popupの「対象 origin」で録画開始とシナリオ実行の対象 origin を絞れます。
- secret変数を含むPlaywrightコード生成では、対象 origin 設定が必要です。
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
