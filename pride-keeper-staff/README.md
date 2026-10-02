# PRIDE KEEPER Staff

Отдельный канал обновлений расширения для `forum.pridekeeper.tech`.

## Как теперь выходят обновления

1. Исходники лежат в `pride-keeper-staff/extension/`.
2. Версия меняется одновременно в:
   - `extension/manifest.json`
   - `extension/content.js` (`CONFIG.version`)
   - `update.json`
3. Любой push в `pride-keeper-staff/**` запускает GitHub Actions.
4. Workflow собирает ZIP из папки `extension/`.
5. Rolling release с тегом `latest` перезаписывается свежим архивом:
   `PRIDE_KEEPER_Staff_latest.zip`.
6. Расширение проверяет `update.json` каждые 30 минут.
7. Если версия новее, ZIP может скачаться автоматически в Downloads.

## Важно про Chrome

Распакованное расширение не может безопасно переписать собственные JS-файлы в папке на диске. Поэтому GitHub автоматически доставляет свежий ZIP, но после скачивания остаётся распаковать архив поверх папки расширения и нажать **Reload** в `chrome://extensions/`.

Полностью бесшовные обновления без этого шага требуют публикации через Chrome Web Store или управляемый CRX/update_url.

## Стабильные ссылки

- Update manifest: `https://raw.githubusercontent.com/imvana122008/Kalus/main/pride-keeper-staff/update.json`
- Latest release: `https://github.com/imvana122008/Kalus/releases/tag/latest`
- Latest ZIP: `https://github.com/imvana122008/Kalus/releases/download/latest/PRIDE_KEEPER_Staff_latest.zip`
