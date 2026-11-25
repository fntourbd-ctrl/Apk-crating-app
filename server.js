
const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || "fntourbd-ctrl/Apk-crating-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const WORKFLOW = process.env.GITHUB_WORKFLOW || "build.yml";

const builds = new Map();

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "APK-Creator-Server"
  };
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...ghHeaders(), ...(options.headers || {}) }
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }

  if (!response.ok) {
    const err = new Error(data.message || `GitHub HTTP ${response.status}`);
    err.status = response.status;
    err.details = data.errors || null;
    throw err;
  }

  return { data, status: response.status };
}

function diagnosis(err) {
  const status = err.status;

  if (status === 401)
    return "GitHub Token invalid or expired. Check GITHUB_TOKEN.";

  if (status === 403)
    return "GitHub permission denied. Token needs Actions Read and write permission.";

  if (status === 404)
    return "Repository or workflow not found. Check GITHUB_REPO and workflow filename.";

  if (status === 422)
    return "GitHub rejected the dispatch. Check workflow_dispatch, branch and inputs.";

  return err.message || "Unknown GitHub error";
}

app.get("/", (req, res) => {
  res.json({
    name: "APK Creator Server",
    status: "online",
    repository: REPO,
    branch: BRANCH
  });
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.post("/api/build", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({
        error: "GITHUB_TOKEN is missing on Render."
      });
    }

    const id = crypto.randomUUID();
    const config = req.body.config || req.body;

    const path =
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;

    await github(path, {
      method: "POST",
      body: JSON.stringify({
        ref: BRANCH,
        inputs: {
          id,
          config: JSON.stringify(config)
        }
      })
    });

    builds.set(id, {
      id,
      status: "queued",
      createdAt: Date.now()
    });

    return res.json({
      ok: true,
      id,
      status: "queued",
      message: "GitHub Actions build dispatched."
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: diagnosis(err),
      github_status: err.status || null,
      details: err.details || null
    });
  }
});

app.get("/api/status/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const releases = await github(
      `/repos/${REPO}/releases/tags/build-${encodeURIComponent(id)}`
    );

    const release = releases.data;
    const apk = (release.assets || []).find(asset =>
      asset.name.toLowerCase().endsWith(".apk")
    );

    if (apk) {
      return res.json({
        id,
        status: "done",
        downloadUrl: apk.browser_download_url,
        releaseUrl: release.html_url
      });
    }
  } catch (err) {
    if (err.status !== 404) {
      return res.status(err.status || 500).json({
        error: diagnosis(err),
        github_status: err.status || null
      });
    }
  }

  try {
    const runs = await github(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?branch=${encodeURIComponent(BRANCH)}&per_page=10`
    );

    const run = (runs.data.workflow_runs || []).find(r =>
      Date.now() - new Date(r.created_at).getTime() < 30 * 60 * 1000
    );

    if (run) {
      let status = "building";

      if (run.status === "queued" || run.status === "waiting")
        status = "queued";
      else if (run.status === "completed")
        status = run.conclusion === "success" ? "done" : "failed";

      return res.json({
        id,
        status,
        workflow_status: run.status,
        conclusion: run.conclusion,
        runUrl: run.html_url,
        message: run.conclusion === "failure"
          ? "Workflow failed. Open runUrl to view build logs."
          : undefined
      });
    }

    return res.json({
      id,
      status: "building",
      message: "Waiting for GitHub Actions."
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: diagnosis(err),
      github_status: err.status || null
    });
  }
});

app.get("/api/diagnostics", async (req, res) => {
  try {
    if (!TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "GITHUB_TOKEN missing"
      });
    }

    const repoInfo = await github(`/repos/${REPO}`);

    const workflow = await github(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}`
    );

    return res.json({
      ok: true,
      repository: repoInfo.data.full_name,
      branch: BRANCH,
      workflow: workflow.data.name,
      workflow_state: workflow.data.state,
      workflow_file: WORKFLOW,
      message: "Repository and workflow access verified."
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: diagnosis(err),
      github_status: err.status || null,
      details: err.details || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`APK Creator Server running on ${PORT}`);
});
