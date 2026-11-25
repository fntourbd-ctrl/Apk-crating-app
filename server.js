const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || "fntourbd-ctrl/Url-to-apk-app";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const WORKFLOW = process.env.GITHUB_WORKFLOW || "build.yml";

const GH = "https://api.github.com";

async function github(path, options = {}) {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is missing");

  const response = await fetch(`${GH}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

app.get("/", (req, res) => {
  res.send("APK Forge API online");
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.get("/api/diagnostics", async (req, res) => {
  try {
    const repo = await github(`/repos/${REPO}`);
    const workflow = await github(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}`
    );

    res.json({
      ok: true,
      repository: REPO,
      branch: BRANCH,
      workflow: workflow.name,
      workflow_state: workflow.state,
      workflow_file: workflow.path,
      message: "Repository and workflow access verified."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.post("/api/build", async (req, res) => {
  try {
    const config = req.body.config || {};

    if (!config.name || !config.url) {
      return res.status(400).json({
        error: "App name and website URL are required."
      });
    }

    const id = `apk-${Date.now()}`;

    await github(
      `/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: BRANCH,
          inputs: {
            id,
            config: JSON.stringify(config)
          }
        })
      }
    );

    res.json({
      ok: true,
      id,
      status: "queued",
      message: "Build request sent."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

app.get("/api/status/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const release = await github(
      `/repos/${REPO}/releases/tags/build-${encodeURIComponent(id)}`
    );

    const apk = release.assets.find(
      asset => asset.name.toLowerCase().endsWith(".apk")
    );

    if (apk) {
      return res.json({
        ok: true,
        status: "done",
        downloadUrl: apk.browser_download_url
      });
    }

    res.json({
      ok: true,
      status: "processing"
    });
  } catch (error) {
    res.json({
      ok: true,
      status: "processing"
    });
  }
});

app.listen(PORT, () => {
  console.log(`APK Forge API running on port ${PORT}`);
});
