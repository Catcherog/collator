#!/usr/bin/env node
/**
 * FAMP Smoke Counter Harness
 *
 * FAMP-CONTRACT-ADOPTION-GATE-01-R1-FIX-R3 / RF-R3-01
 *
 * 用途：Docker 冒烟测试时，包装 collator buildApp() 返回的 service 实例，
 *       计数 task_save / review_create / pre_write_call / candidate_persisted /
 *       customer_writer_call，通过独立 HTTP 端点 :9999/smoke/counters 暴露。
 *
 * 激活方式：docker-compose.yml 中 collator 服务 command 覆盖为
 *           ["node", "scripts/famp-smoke-counter.mjs"]
 *           并通过 volume mount 注入此文件。
 *
 * 安全约束（RF-R3-01 "不得新增无保护的生产调试接口"）：
 *   - 此文件不修改生产源码（app.ts / ingestion-service.ts 等不变）。
 *   - 此文件不在生产 Dockerfile CMD 中引用（生产 CMD 仍为
 *     ["node", "dist/server/app.js"]）。
 *   - 此文件仅在 smoke compose 中通过 volume mount + command 覆盖激活。
 *   - 计数 HTTP server 监听独立端口 9999，与生产端口 8787 隔离。
 */

import http from 'node:http';

const counters = {
  task_save: 0,
  review_create: 0,
  pre_write_call: 0,
  pre_write_success: 0,
  pre_write_error: 0,
  candidate_persisted: 0,
  customer_writer_call: 0,
};

// 1. 启动计数查询 server (端口 9999)
const counterServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/smoke/counters') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(counters, null, 2));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

counterServer.listen(9999, '0.0.0.0', () => {
  console.log('[smoke-counter] counter endpoint listening on :9999');
});

// 2. 加载 collator app（不会触发 main()，因为 import.meta.url !== process.argv[1]）
const appModule = await import('../dist/server/app.js');
const { app, config, service, repository, reviewRepository } = await appModule.buildApp();

// 3. Patch repository.save — 计数所有 task 持久化 + candidate 持久化
const originalSave = repository.save.bind(repository);
repository.save = async function (task) {
  counters.task_save++;
  if (task && task.raw_candidate) {
    counters.candidate_persisted++;
  }
  return originalSave(task);
};

// 4. Patch reviewRepository.create — 计数 review 创建
const originalCreate = reviewRepository.create.bind(reviewRepository);
reviewRepository.create = async function (review) {
  counters.review_create++;
  return originalCreate(review);
};

// 5. Patch preWriteClient.callPreWrite — 计数 PRE_WRITE 调用（成功/失败）
//    service.preWriteClient 是 TypeScript private，但运行时可访问。
const preWriteClient = service.preWriteClient;
if (preWriteClient) {
  const originalCallPreWrite = preWriteClient.callPreWrite.bind(preWriteClient);
  preWriteClient.callPreWrite = async function (candidate) {
    counters.pre_write_call++;
    try {
      const result = await originalCallPreWrite(candidate);
      counters.pre_write_success++;
      return result;
    } catch (e) {
      counters.pre_write_error++;
      throw e;
    }
  };
} else {
  console.error('[smoke-counter] WARNING: service.preWriteClient is undefined');
}

// 6. Patch customerRecordWriter.write — 计数飞书业务写入调用
//    adoptCandidateV1 不调用此方法，但计数以证明无副作用。
const customerRecordWriter = service.customerRecordWriter;
if (customerRecordWriter) {
  const originalWrite = customerRecordWriter.write.bind(customerRecordWriter);
  customerRecordWriter.write = async function (req) {
    counters.customer_writer_call++;
    return originalWrite(req);
  };
}

// 7. 启动 collator fastify server（复制 main() 逻辑）
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info('[smoke-counter] collator server started with smoke counters enabled');
