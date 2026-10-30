// cron 表達式 → 要觸發的 workflow 與輸入
const JOBS = {
  "59 12 * * 1-5": { workflow: "portfolio.yml", inputs: { tasks: "snapshot" } }, // 台北 20:59
  "59 21 * * 1-5": { workflow: "portfolio.yml", inputs: { tasks: "snapshot events brief" } }, // 台北 05:59
};

export default {
  async scheduled(event, env) {
    const job = JOBS[event.cron];
    if (!job) throw new Error(`沒有對應的任務：${event.cron}`);
    const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${job.workflow}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "jteam-cron",
      },
      body: JSON.stringify({ ref: "main", inputs: job.inputs }),
    });
    // 失敗就丟錯，Cloudflare 的 Observability 會記錄；GitHub 自己的 cron 仍是備援
    if (!res.ok) throw new Error(`觸發 ${job.workflow} 失敗：${res.status} ${await res.text()}`);
    console.log(`已觸發 ${job.workflow}（${job.inputs.tasks}）`);
  },
};
