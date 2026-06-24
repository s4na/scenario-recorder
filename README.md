# シナリオレコーダー

Webアプリ上のユーザー操作をChrome拡張で記録し、Playwrightなどへ変換しやすいJSONシナリオとして保存するMVPです。

## 機能一覧

- Manifest V3のChrome拡張
- popup UIから記録開始、一時停止、再開、停止、クリア、保存
- click、input、select、submit、通常遷移、SPA遷移の記録
- `chrome.storage.local` への複数シナリオ保存
- 保存済みシナリオ一覧の表示
- シナリオ単位のJSONエクスポート
- 全シナリオの一括JSONエクスポート
- JSONLエクスポート
- Playwrightテストコード生成
- シナリオJSONのインポート
- 保存済みシナリオの名前、説明、タグ編集
- JSON Schemaのダウンロード
- 対象ドメイン設定
- 現在URL、タイトルのassertion追加
- マスク済み入力値からのsecret変数生成
- password、token、secret、credit card系入力値のマスク

## インストール方法

Node.js 20.19.0 以上が必要です。

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

1. 拡張のpopupを開き、「記録開始」を押します。
2. 対象Webページ上でクリック、入力、選択、画面遷移を行います。
3. 必要に応じて「一時停止」「再開」を使います。
4. 「停止」を押します。
5. シナリオ名を入力して「保存」を押します。
6. 保存済みシナリオ一覧からJSONをエクスポートします。
7. 必要に応じてJSONLやPlaywrightコードもダウンロードします。

## 保存されるJSON形式

シナリオ単位のJSONは `scenario-recorder/v1` です。

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

保存前の現在の記録をダウンロードする場合は `scenario-recorder/current/v1` です。

```json
{
  "schemaVersion": "scenario-recorder/current/v1",
  "exportedAt": "2026-06-23T10:10:00.000Z",
  "state": {}
}
```

## セキュリティ・プライバシー上の注意

- MVPでは開発しやすさのため `host_permissions` に `<all_urls>` を使っています。
- 本番運用では対象ドメインに絞るべきです。
- popupの「対象ドメイン」で録画開始対象のoriginを絞れます。
- secret変数を含むPlaywrightコード生成では、対象ドメイン設定が必要です。
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
