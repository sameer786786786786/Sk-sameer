const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports.config = {
    name: "update",
    version: "2.0.0",
    permission: "OWNER",
    hasPrefix: true,
    credit: "𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭",
    description: "Updates the bot files. Use '/update' for runtime update, '/update full' for GitHub sync.",
    category: "SYSTEM",
    usages: "[full]",
    cooldown: 5,
};

// REPLACE THIS WITH YOUR RAW REPOSITORY URL
const REPO_BASE_URL = "https://gitlab.com/priyanshufsdev/priyanshu-fb-bot/-/raw/main/";

function parseSemver(version) {
    if (typeof version !== "string") return [0, 0, 0];
    return version.split(".").map(num => parseInt(num, 10) || 0);
}

function compareSemver(a, b) {
    const [aMaj, aMin, aPatch] = parseSemver(a);
    const [bMaj, bMin, bPatch] = parseSemver(b);
    if (aMaj !== bMaj) return aMaj - bMaj;
    if (aMin !== bMin) return aMin - bMin;
    return aPatch - bPatch;
}

function normalizeManifest(remoteManifest) {
    if (!remoteManifest) return [];
    if (Array.isArray(remoteManifest.versions)) {
        return remoteManifest.versions.filter(entry => entry?.version && Array.isArray(entry.files));
    }
    if (remoteManifest.version && Array.isArray(remoteManifest.files)) {
        return [remoteManifest];
    }
    return [];
}

async function getGitHubRepoVersion() {
    try {
        const configPath = path.resolve(__dirname, '../../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const githubConfig = config.github || {};
        const { owner, repo, token, branch = 'main' } = githubConfig;

        if (!owner || !repo) return null;

        const headers = { Accept: 'application/vnd.github.v3+json' };
        if (token && token !== 'YOUR_GITHUB_TOKEN') {
            headers.Authorization = `token ${token}`;
        }

        const url = `https://api.github.com/repos/${owner}/${repo}/contents/package.json?ref=${branch}`;
        const { data } = await axios.get(url, { headers });
        if (!data?.content) return null;
        const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
        const pkg = JSON.parse(content);
        return pkg.version || null;
    } catch (error) {
        console.warn("[UPDATE] Unable to fetch GitHub repo version:", error.message);
        return null;
    }
}

function sendMessageAsync(api, body, threadID, replyTo) {
    return new Promise((resolve, reject) => {
        const callback = (err, info) => {
            if (err) return reject(err);
            resolve(info);
        };

        if (typeof replyTo === "undefined") {
            api.sendMessage(body, threadID, callback);
        } else {
            api.sendMessage(body, threadID, callback, replyTo);
        }
    });
}

async function updateStatusMessage(api, threadID, text, statusCtx, replyTo) {
    try {
        if (statusCtx.messageID) {
            if (typeof api.editMessage !== 'function') {
                throw new Error("editMessage is not supported by this API instance.");
            }
            await Promise.resolve(api.editMessage(text, statusCtx.messageID, threadID));
        } else {
            const info = await sendMessageAsync(api, text, threadID, replyTo);
            statusCtx.messageID = info.messageID;
        }
    } catch (error) {
        console.warn("[UPDATE] Status message update failed:", error.message);
        if (!statusCtx.messageID) {
            try {
                const info = await sendMessageAsync(api, text, threadID, replyTo);
                statusCtx.messageID = info.messageID;
            } catch (fallbackErr) {
                console.warn("[UPDATE] Fallback status send failed:", fallbackErr.message);
            }
        }
    }
}

const FULL_UPDATE_KEYWORDS = ["full", "all", "github", "repo"];

module.exports.run = async ({ api, message, args }) => {
    const { threadID, messageID, senderID } = message;

    if (REPO_BASE_URL === "YOUR_REPO_RAW_URL_HERE") {
        return api.sendMessage("⚠️ Please configure the REPO_BASE_URL in modules/commands/update.js first!", threadID, messageID);
    }

    try {
        const remoteManifestUrl = `${REPO_BASE_URL}update.json`;
        const { data: remoteManifest } = await axios.get(remoteManifestUrl);

        const packageJsonPath = path.resolve(__dirname, '../../package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const localVersion = packageJson.version;

        const manifestEntries = normalizeManifest(remoteManifest).sort((a, b) => compareSemver(b.version, a.version));

        if (manifestEntries.length === 0) {
            return api.sendMessage("❌ Remote manifest does not contain any valid versions.", threadID, messageID);
        }

        const requestedMode = (args[0] || "").toLowerCase();
        const isFullUpdate = FULL_UPDATE_KEYWORDS.includes(requestedMode);
        const configPath = path.resolve(__dirname, '../../config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const hasRepoConfig = Boolean(config.github?.owner && config.github?.repo);

        let baselineVersion = localVersion;
        let baselineSource = "local";
        let repoVersion = null;

        if (isFullUpdate && hasRepoConfig) {
            repoVersion = await getGitHubRepoVersion();
            if (repoVersion) {
                baselineVersion = repoVersion;
                baselineSource = "repo";
            }
        }

        const newerEntries = manifestEntries.filter(entry => compareSemver(entry.version, baselineVersion) > 0);

        if (newerEntries.length === 0) {
            const msg = baselineSource === "repo"
                ? `✅ GitHub repository is already on the latest version (${baselineVersion || "unknown"}).`
                : `✅ You are already on the latest version (${localVersion}).`;
            return api.sendMessage(msg, threadID, messageID);
        }

        const versionsToApply = [...newerEntries].sort((a, b) => compareSemver(a.version, b.version));
        const filesToUpdate = new Set();
        versionsToApply.forEach(entry => (entry.files || []).forEach(file => filesToUpdate.add(file)));
        filesToUpdate.add('package.json');

        const changelogLines = versionsToApply.map(entry => {
            const changelog = entry.changelog;
            if (Array.isArray(changelog)) {
                return `📌 v${entry.version}:\n${changelog.join('\n')}`;
            }
            return `• v${entry.version}: ${changelog || "No changelog provided."}`;
        });
        const updatePlan = {
            targetVersion: versionsToApply[versionsToApply.length - 1].version,
            files: Array.from(filesToUpdate),
            changelogLines,
            baselineVersion,
            baselineSource,
            repoVersion
        };

        const filesList = updatePlan.files.length > 0
            ? updatePlan.files.map(file => `• ${file}`).join("\n")
            : "• No files listed in manifest.";

        const comparisonDetail = baselineSource === "repo"
            ? `GitHub repo version detected: v${repoVersion || "unknown"}`
            : `Current bot version: v${localVersion}`;

        const msg = `🚀 Updates available up to v${updatePlan.targetVersion}\n(${comparisonDetail})\n\n📝 Changes since v${baselineVersion}:\n${changelogLines.join("\n") || "• No changelog entries."}\n\n📂 Files to update (${updatePlan.files.length}):\n${filesList}\n\nReply "yes" to update runtime files.${isFullUpdate ? "\n(This will also push changes to your GitHub repo)" : ""}`;

        return api.sendMessage(msg, threadID, (err, info) => {
            if (err) return console.error(err);

            const replies = global.client.replies.get(threadID) || [];
            replies.push({
                messageID: info.messageID,
                command: this.config.name,
                expectedSender: senderID,
                data: { updatePlan, isFullUpdate }
            });
            global.client.replies.set(threadID, replies);
        }, messageID);

    } catch (error) {
        console.error("Update check failed:", error);
        api.sendMessage(`❌ Check failed: ${error.message}`, threadID, messageID);
    }
};

module.exports.handleReply = async ({ api, message, replyData }) => {
    const { threadID, messageID, body } = message;
    const { updatePlan, isFullUpdate } = replyData;

    if (body.toLowerCase() !== "yes") {
        return api.sendMessage("❌ Update cancelled.", threadID, messageID);
    }

    api.unsendMessage(message.messageReply.messageID);
    const statusCtx = { messageID: null };
    await updateStatusMessage(api, threadID, `🔄 Starting ${isFullUpdate ? "FULL" : "RUNTIME"} update to v${updatePlan.targetVersion}...`, statusCtx, messageID);

    const packageJsonPath = path.resolve(__dirname, '../../package.json');

    try {
        let updatedFiles = [];
        let failedFiles = [];
        let fileContents = {};

        for (const fileRelativePath of updatePlan.files) {
            try {
                if (fileRelativePath === 'package.json') {
                    updatedFiles.push(fileRelativePath);
                    if (isFullUpdate) {
                        const pkgContent = fs.readFileSync(packageJsonPath);
                        fileContents[fileRelativePath] = pkgContent.toString('base64');
                    }
                    continue;
                }

                const fileUrl = `${REPO_BASE_URL}${fileRelativePath}`;
                const localFilePath = path.resolve(__dirname, '../../', fileRelativePath);

                const dir = path.dirname(localFilePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const response = await axios({
                    method: 'get',
                    url: fileUrl,
                    responseType: 'arraybuffer'
                });

                const content = response.data;
                fs.writeFileSync(localFilePath, content);

                updatedFiles.push(fileRelativePath);

                if (isFullUpdate) {
                    fileContents[fileRelativePath] = Buffer.from(content).toString('base64');
                }

            } catch (err) {
                console.error(`Failed to update ${fileRelativePath}:`, err);
                failedFiles.push(fileRelativePath);
            }
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageJson.version = updatePlan.targetVersion;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        if (!updatedFiles.includes('package.json')) {
            updatedFiles.push('package.json');
        }
        if (isFullUpdate) {
            const pkgContent = fs.readFileSync(packageJsonPath);
            fileContents['package.json'] = pkgContent.toString('base64');
        }

        let reportMsg = `✅ Runtime Update Complete!\n🆕 Version: ${updatePlan.targetVersion}\n📂 Updated: ${updatedFiles.length}`;
        if (failedFiles.length > 0) reportMsg += `\n⚠️ Failed: ${failedFiles.length}`;

        if (isFullUpdate && updatedFiles.length > 0) {
            await updateStatusMessage(api, threadID, "☁️ Pushing changes to GitHub...", statusCtx);
            try {
                const configPath = path.resolve(__dirname, '../../config.json');
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const { token, owner, repo } = config.github || {};

                if (!token || !owner || !repo || token === "YOUR_GITHUB_TOKEN") {
                    reportMsg += "\n\n❌ GitHub Push Failed: Missing or invalid GitHub config.";
                } else {
                    let pushedCount = 0;
                    for (const filePath of updatedFiles) {
                        const contentBase64 = fileContents[filePath];
                        await pushToGitHub(token, owner, repo, filePath, contentBase64, `Auto-update to v${updatePlan.targetVersion}`);
                        pushedCount++;
                    }
                    reportMsg += `\n\n☁️ GitHub Sync: ${pushedCount} files pushed.`;
                }
            } catch (ghErr) {
                console.error("GitHub push failed:", ghErr);
                reportMsg += `\n\n❌ GitHub Push Error: ${ghErr.message}`;
            }
        }

        await updateStatusMessage(api, threadID, reportMsg, statusCtx);

    } catch (error) {
        console.error("Update execution failed:", error);
        await updateStatusMessage(api, threadID, `❌ Update failed: ${error.message}`, statusCtx);
    }
};

async function pushToGitHub(token, owner, repo, path, contentBase64, message) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const headers = {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json"
    };

    try {
        let sha;
        try {
            const { data } = await axios.get(url, { headers });
            sha = data.sha;
        } catch (e) {
            if (e.response && e.response.status !== 404) throw e;
        }

        await axios.put(url, {
            message,
            content: contentBase64,
            sha
        }, { headers });

    } catch (error) {
        throw new Error(`Failed to push ${path}: ${error.response?.data?.message || error.message}`);
    }
}
