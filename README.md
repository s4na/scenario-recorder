# シナリオレコーダー

Webアプリ上のユーザー操作をChrome拡張で記録し、Playwrightなどへ変換しやすいJSONシナリオとして保存するMVPです。

## 機能一覧

- Manifest V3のChrome拡張
- popup UIから記録開始、一時停止、再開、停止、クリア、保存
- click、input、select、通常遷移、SPA遷移の記録
- `chrome.storage.local` への複数シナリオ保存
- 保存済みシナリオ一覧の表示
- シナリオ単位のJSONエクスポート
- 全シナリオの一括JSONエクスポート
- password、token、secret、credit card系入力値のマスク

## インストール方法

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

## セキュリティ・プライバシー上の注意

- MVPでは開発しやすさのため `host_permissions` に `<all_urls>` を使っています。
- 本番運用では対象ドメインに絞るべきです。
- 入力値は外部APIへ送信しません。
- 入力値を `console.log` に出力しません。
- password、token、secret、credit card系の入力値は保存前にマスクします。
- URL内の `token`、`code`、`secret` などの秘匿クエリ・ハッシュ値も保存前にマスクします。
- emailやphoneはMVPでは保存対象です。必要に応じて `src/content/masking.ts` でマスク対象を拡張してください。

## 現在の制限

- Playwrightコード生成は行いません。
- JSONL出力は行いません。
- シナリオのインポート、編集UI、チーム共有、クラウド同期はありません。
- スクリーンショット、動画、ネットワークログは保存しません。
- セレクタ候補はMVPとしての推定であり、すべてのWebアプリで一意性を保証するものではありません。

## 今後の拡張案

- JSON Schemaの追加
- Playwrightコード生成
- シナリオ編集UI
- 対象ドメイン設定
- 変数抽出とsecret管理
- assertion記録
- シナリオインポート
