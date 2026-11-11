# Pwappy Web E2E Tests

[![Scheduled E2E Tests](https://github.com/pwappy-com/pwappy-web-tests/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/pwappy-com/pwappy-web-tests/actions/workflows/e2e-tests.yml)

このリポジトリは `Pwappy` のE2Eテストを管理しています。
テストはGitHub Actionsによって定期的に実行されます。

## テストの実行範囲

- `npm test`: 既存の実サービス向けテスト。通常設定の5ブラウザが対象で、テスト用アカウントの全アプリ削除スクリプトも従来どおり含みます。
- `npm run test:webmcp -- --headed`: 専用設定・隔離ビルド・空の認証状態でWebMCPテストだけを実行します。通常設定からはこのテスト群を除外しています。
- `npm run test:webmcp:list`: WebMCPテストの一覧表示だけを行います。
- `npm run test:discovery`: 設定とテストを一時ディレクトリへコピーし、通常・CI指定範囲・全削除・WebMCPの収集範囲を `--list` で検証します。実 `.env` / `.auth` はコピーせず、ブラウザ・ログイン・テスト本体は実行しません。

既存CIの `tests/specs/normal` / `tests/specs/premium` と、別ステップの全アプリ削除は変更していません。隔離実行の詳細は [SAFE-RUNNER.md](tests/tools/webmcp/SAFE-RUNNER.md) を参照してください。
