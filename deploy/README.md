# 私人学习空间部署

本目录准备的是单实例 Linux 部署。复用已有服务器、域名和 HTTPS，不购买资源。实际服务器与入口尚待确认，不能把本地验证当作已上线。

本轮源代码部署包可用 `python scripts/package-cloud.py` 生成，默认写入 `tmp/lms-private-cloud.zip`，同时生成 SHA-256 校验文件。包内包括当前代码、依赖锁、数据库结构、资料样例和部署脚本；不包括私人学习数据、环境密钥、依赖目录和构建缓存。解压后的 `LMS` 为项目根目录。已有同名包时工具要求更换文件名，避免覆盖。

## 首次部署

1. 在服务器为本项目建立独立目录，保留服务器上已有应用和代理配置。需要 Docker Compose；有现成 HTTPS 反向代理时继续使用它。
2. 把完整代码送到该目录。将 `env.cloud.example` 复制为 `.env.cloud`，填写实际 `APP_URL`（HTTPS）、固定 `PRIVATE_OWNER_EMAIL` 和独立 `BETTER_AUTH_SECRET`。密钥可以用 `openssl rand -hex 32` 生成；AI 密钥仍仅在服务器保存。`.env.cloud` 不进入镜像或 Git。
3. 首次迁移先停止本机 LMS，执行 `python scripts/learning-backup.py backup data ../lms-transfer.tar.gz`。把该归档安全复制到服务器，再用 `python3 scripts/learning-backup.py restore ../lms-transfer.tar.gz deploy/data` 恢复到新目录。也可从空目录建立新学习空间。不要用旧数据库覆盖已经开始使用的云端数据库。
4. 确保 `deploy/data` 由容器的 node 用户（UID 1000）可写。例如仅针对这个已确认目录执行 `chown -R 1000:1000 deploy/data`。保留所有上传文件、识别结果、生成草稿、笔记图片及 OCR 语言文件。
5. 在 `deploy` 目录执行 `docker compose build`，完成后 `docker compose up -d`。应用只绑定服务器本机的 4173 端口；不要把该端口直接开放到互联网。若端口被占用，在 compose 中换宿主端口，并同步反向代理。
6. 执行 `docker compose exec lms node scripts/private-account.mjs`，交互设置至少 12 位的私人密码。公开注册已关闭；页面、数据和原件访问均核验同一账号。重置密码用 `--reset-password`，旧会话同时失效。
7. 将已有 HTTPS 入口反向代理到 `127.0.0.1:4173`，保留代理的 Host 与 Origin。缺少代理时，可将 `Caddyfile` 的域名配置并入服务器的 Caddy；域名 DNS 必须指向该服务器。示例只配置 LMS，不覆盖其他站点。

容器启动仅执行 Prisma 的非破坏性 `db push`；发现需要删数据的变化会停止。旧 Windows 原件路径在完整数据迁入后按文件名改为容器的持久化目录路径；缺少原件时停止启动，避免悄悄丢失资料。

## 备份与恢复

备份期间停止学习服务，确保数据库快照与文件一致；反向代理可继续运行。

```sh
cd deploy
docker compose stop lms
python3 ../scripts/learning-backup.py backup data /srv/lms-backups/learning-YYYYMMDD.tar.gz
docker compose start lms
```

备份包含数据库、原件、识别结果、AI 草稿、笔记图片及聊天附件；包括私人账号的登录数据，不包含环境密钥。备份需存放到只有你能访问的目录，并另存 `.env.cloud`。工具会校验 SQLite 完整性、当前原件引用与每个文件的 SHA-256。

恢复先到全新的空目录，工具拒绝覆盖已有目录：

```sh
python3 scripts/learning-backup.py restore /srv/lms-backups/learning-YYYYMMDD.tar.gz deploy/restored-data
```

校验通过后，停止容器，将 compose 的数据挂载改为经确认的 `./restored-data:/app/data`，设置目录所有权，再启动。原 `data` 目录保留以便回退。安排定期备份时沿用以上停服务、备份、恢复服务的顺序，并定期在独立目录执行恢复校验。

## 上线验收

- 未登录访问 `/` 跳到登录页，`/api/workspace`、原件和笔记图片返回 401；公开注册请求失败。
- 私人账号登录后能阅读原件、识别结果、笔记、聊天和原有作答记录。
- 重启应用后再次核对数据，恢复备份到独立目录后再检查原件与笔记。
- 电脑和手机通过同一 HTTPS 入口登录。正常网络下，另一台设备在三秒轮询后更新；目标五秒内，实际时间取决于网络。
- 断网补记先保留浏览器草稿与图片；回网同步。冲突界面允许保留两稿，旧修订不会覆盖新内容。

SQLite 保持单实例，不启多个副本；所有持久化数据位于 `deploy/data`。不要在生产环境运行演示资料导入或将本机 `.env.local` 打包到镜像。
