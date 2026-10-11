# GitHub Pages公開の作業一覧

公開先：hdttnk/gashaan（公開リポジトリ）。
Git初期化・remote・本番base=/gashaan/・Actionsを設定済み。Manifest・Service Workerは未設定。
mainへのpush後、Pages公開元をGitHub Actionsに設定して初回デプロイを確認する。

## 公開前に決めること

- GitHubアカウントとリポジトリ名。既存リポジトリを使う場合はURL。
- ソースコードを公開してよいか。GitHub FreeのPagesは通常公開リポジトリを使用する。
- まずgithub.ioのプロジェクトURLを使うことを推奨。通常のPagesは一般公開になる。

## 実装・設定

1. `.gitignore`（node_modules/dist/.pnpm-store除外）を確認し、Git初期化と初回コミット。
2. GitHubリポジトリを作成し、remoteとmainブランチを設定。
3. `vite.config.ts`を追加し、プロジェクトPagesならbaseを`/<リポジトリ名>/`にする。ユーザーサイトや独自ドメインのルートなら`/`。
4. CIのNode.jsとpnpmを固定。Node.jsはVite7要件を満たす24系を推奨。packageManagerの明示も検討。
5. `.github/workflows/deploy.yml`を追加。PRでは検証のみ、mainへのpushでは公開。手動実行も許可。
6. checkout → pnpm準備 → Node準備 → frozen-lockfileインストール → pnpm test → pnpm build → dist artifact → deploy-pages。
7. GitHubのSettings → PagesでSourceをGitHub Actionsへ変更。公開環境github-pages、必要権限contents:read/pages:write/id-token:write、デプロイ競合制御を設定。
8. 初回push。Actions成功と公開URLのHTTPSを確認。

ビルド成果物のみをPagesへ配信する。distを手作業でソースブランチへコミットしない。
ソースindex.htmlやlocalhost5173を配信する方式ではない。

## 公開URLでの確認

- JS/CSS/SVGに404がない。サブパスのトップを直接開く／再読み込みできる。
- iPhone Safari横画面でパレットから追加・移動・回転・再生・保持・投擲・やりなおし。
- 縦向きになると停止し、案内表示。横へ戻って再生できる。
- ノッチ／ホームインジケーターに主要ボタンが隠れない。
- パレットと開発者パネルは内部だけスクロールでき、ゲーム画面全体はスクロールしない。
- 指のキャンセル・2本目の指・バックグラウンド復帰で保持が残らない。
- Safariのバーの表示変化によるサイズ変更、物体増加時の描画速度・発熱を確認。
- 次のpushで更新できることを確認。

## 後続（初回公開の必須条件ではない）

Manifest・PNGアイコン・apple-touch-iconでホーム画面起動を整える。
オフライン対応はService Workerと更新／キャッシュ世代管理を別途実装する。
公開先のbaseにManifestのstart_url・scope・アイコンURL・SW登録範囲を合わせる。
PWA化と配置の永続保存は別機能。

参考：Vite https://vite.dev/guide/static-deploy.html#github-pages
GitHub https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
