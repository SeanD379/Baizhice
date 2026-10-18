# 真实资料生成实施清单

**目标：** 将核对后的逐页文字生成带引用的候选复习材料，由用户选择采用。
**架构：** 复用现有 Section 和 Version，新接口负责来源读取、模型调用、候选持久化与事务采用；不改变原演示接口。
**技术：** Next.js Route Handler、Zod、Node fetch、SQLite/Prisma、Vitest。

- [x] 在 src/lib/generation.test.ts 写来源范围、字数、引用伪造、模型失败和追加保留测试，先确认失败。
- [x] 实现 src/lib/generation.ts 的输入校验与逐页引用核验；src/lib/openai.ts 使用官方 Responses 结构化输出，超时或拒绝不返回候选。
- [x] 实现 src/app/api/generation/route.ts，GET 返回核对页与配置状态，POST 生成预览或采用；生成前后及采用时复核来源，采用时复核 expectedVersionId。
- [x] 实现 src/components/generation-dialog.tsx，提供逐页选择、文字修订、发送确认、候选预览、原文对照与选择采用；接入首页和复习材料。
- [x] 更新真实内容与演示标识，保留练习的演示边界；更新 README 和验收记录。
- [x] 运行 npm test、npm run check、npm run test:extraction、npm run build。使用隔离测试数据验证 API 与浏览器全流程，记录模拟与真实模型的区别。

2026-09-11 收尾：23 项逻辑/接口用例、4 项真实提取用例、类型和构建检查通过；Edge 桌面及 390px 窄屏模拟全流程通过。生产预览启动在 127.0.0.1:4173，实际接口报告 OpenAI 未配置。

待外部条件：用户在 .env.local 配置 API 密钥后，实际调用 OpenAI 并用真实课程资料人工评测。本轮未声称模型效果已验证。

本目录无独立 Git 仓库，继承的是包含其他项目的上层仓库；不提交上层混杂文件。当前按用户授权直接在 LMS 工作目录修改。
