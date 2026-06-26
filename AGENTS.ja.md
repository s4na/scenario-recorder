# リポジトリ指示

## ルール優先度

- このリポジトリで作業するときは、global や親ディレクトリの agent 指示より先に、このリポジトリの `AGENTS.md` に従う。
- global 指示とこのファイルが矛盾する場合、このリポジトリ内の作業ではこのファイルを優先する。

## テスト

- このリポジトリでは、ローカル検証コマンドを実行しない。
- ローカル検証コマンドには、test、lint、typecheck、build、拡張機能検証、ブラウザ自動操作、E2E コマンドを含む。
- CI、lint、unit test、build、拡張機能検証、Chrome拡張E2Eの確認はGitHub Actionsで行う。
