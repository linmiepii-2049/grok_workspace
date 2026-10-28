// jteam-offload Workflow：把成品從 R2 搬到 Google Drive
// 每一步都會自動重試；Drive 的 md5 與大小和 D1 一致才刪 R2，否則保留 R2、狀態退回 r2
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  deleteFile,
  DriveAuthError,
  ensureFolder,
  startUpload,
  uploadEmpty,
  uploadRange,
} from "./gdrive.js";

// Drive 規定分段大小要是 256 KiB 的倍數；32 MiB 一段，單步驟在逾時內完成綽綽有餘
const CHUNK = 32 * 1024 * 1024;
const NET_RETRY = {
  retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
  timeout: "15 minutes",
};
const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// 縮圖寬度：手機雙欄格子約 180pt，2x 螢幕 360px，取 480 留餘裕
const THUMB_WIDTH = 480;
const THUMBABLE = /^image\/(png|jpeg|webp|gif|avif)/;

const driveName = (row) => {
  const file = row.path.split("/").pop();
  if (row.versions <= 1) return file;
  const dot = file.lastIndexOf(".");
  return dot > 0
    ? `${file.slice(0, dot)} (v${row.version})${file.slice(dot)}`
    : `${file} (v${row.version})`;
};

export class OffloadWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { jobId, artifactIds } = event.payload;
    const db = this.env.DB;
    await step.do("start", () =>
      db
        .prepare(`UPDATE offload_jobs SET status = 'running' WHERE id = ?`)
        .bind(jobId)
        .run()
        .then(() => null),
    );

    for (const id of artifactIds) {
      try {
        await this.offloadOne(step, id);
        await step.do(`ok-${id}`, () =>
          db
            .prepare(
              `UPDATE offload_jobs SET done_count = done_count + 1 WHERE id = ?`,
            )
            .bind(jobId)
            .run()
            .then(() => null),
        );
      } catch (e) {
        const message = `#${id}：${e.message.replace(/^\w*Error: /, "")}`.slice(0, 500);
        await step.do(`revert-${id}`, async () => {
          await db.batch([
            db
              .prepare(
                `UPDATE artifacts SET storage = 'r2' WHERE id = ? AND storage = 'offloading'`,
              )
              .bind(id),
            db
              .prepare(
                `UPDATE offload_jobs SET failed_count = failed_count + 1, error = COALESCE(error || char(10), '') || ? WHERE id = ?`,
              )
              .bind(message, jobId),
          ]);
          return null;
        });
      }
    }

    await step.do("finish", () =>
      db
        .prepare(
          `UPDATE offload_jobs SET status = CASE WHEN failed_count > 0 THEN 'failed' ELSE 'done' END, finished_at = ${now} WHERE id = ?`,
        )
        .bind(jobId)
        .run()
        .then(() => null),
    );
  }

  async offloadOne(step, id) {
    const env = this.env;
    const row = await step.do(`load-${id}`, async () => {
      const r = await env.DB.prepare(
        `SELECT a.id, a.kind, a.path, a.version, a.content_type, a.size, a.md5, a.r2_key, a.storage, p.slug,
                (SELECT COUNT(*) FROM artifacts b WHERE b.project_id = a.project_id AND b.path = a.path) AS versions
         FROM artifacts a JOIN projects p ON p.id = a.project_id WHERE a.id = ?`,
      )
        .bind(id)
        .first();
      if (!r) throw new NonRetryableError("成品不存在");
      if (r.storage !== "offloading" || !r.r2_key)
        throw new NonRetryableError(`狀態不是搬移中（${r.storage}）`);
      return r;
    });

    const guard = async (fn) => {
      try {
        return await fn();
      } catch (e) {
        // 授權失效重試也沒用，直接失敗
        if (e instanceof DriveAuthError) throw new NonRetryableError(e.message);
        throw e;
      }
    };

    const folderId = await step.do(`folder-${id}`, NET_RETRY, () =>
      guard(() => ensureFolder(env, `JTeam/${row.slug}/${row.kind}`)),
    );
    const session = await step.do(`session-${id}`, NET_RETRY, () =>
      guard(() =>
        startUpload(env, {
          name: driveName(row),
          mimeType: row.content_type.split(";")[0],
          size: row.size,
          parentId: folderId,
        }),
      ),
    );

    let file = null;
    if (row.size === 0) {
      file = await step.do(`chunk-${id}-0`, NET_RETRY, () =>
        uploadEmpty(session),
      );
    } else {
      const readRange = async (offset, length) => {
        const obj = await env.BUCKET.get(row.r2_key, {
          range: { offset, length },
        });
        if (!obj) throw new NonRetryableError("R2 上找不到檔案");
        return obj.body;
      };
      for (
        let start = 0, n = 0;
        start < row.size && !file;
        start += CHUNK, n++
      ) {
        const end = Math.min(start + CHUNK, row.size) - 1;
        const res = await step.do(`chunk-${id}-${n}`, NET_RETRY, () =>
          uploadRange(env, session, readRange, start, end, row.size),
        );
        if (res.done) file = res.file;
      }
    }
    if (!file) throw new Error("上傳結束但 Drive 沒有回傳檔案資訊");

    await step.do(`verify-${id}`, async () => {
      if (file.md5Checksum !== row.md5 || Number(file.size) !== row.size) {
        await guard(() => deleteFile(env, file.id));
        throw new NonRetryableError(
          `Drive 檔案不一致（md5 ${file.md5Checksum} ≠ ${row.md5}），已保留 R2`,
        );
      }
      return null;
    });

    // 圖片留一張縮圖在 R2，瀏覽頁仍可預覽；失敗不影響搬移
    const thumbKey = await step.do(`thumb-${id}`, async () => {
      if (
        row.kind !== "image" ||
        !THUMBABLE.test(row.content_type) ||
        !env.IMAGES
      )
        return null;
      try {
        const obj = await env.BUCKET.get(row.r2_key);
        const out = await env.IMAGES.input(obj.body)
          .transform({ width: THUMB_WIDTH })
          .output({ format: "image/webp", quality: 70 });
        const key = `thumbs/${row.id}.webp`;
        await env.BUCKET.put(key, out.response().body, {
          httpMetadata: { contentType: "image/webp" },
        });
        return key;
      } catch (e) {
        console.warn(`縮圖失敗 #${row.id}：${e.message}`);
        return null;
      }
    });

    // 先改 D1 再刪 R2：中途失敗頂多在 R2 留下多餘的檔案，不會出現 D1 指向不存在的檔案
    await step.do(`commit-${id}`, async () => {
      await env.DB.prepare(
        `UPDATE artifacts SET storage = 'gdrive', gdrive_file_id = ?, gdrive_url = ?, offloaded_at = ${now}, thumb_key = ?, r2_key = NULL
         WHERE id = ? AND storage = 'offloading'`,
      )
        .bind(file.id, file.webViewLink, thumbKey, id)
        .run();
      await env.BUCKET.delete(row.r2_key);
      return null;
    });
  }
}
