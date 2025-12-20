const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ytSearch = require("yt-search");

module.exports.config = {
    name: "video",
    aliases: ["ytvideo"],
    version: "1.0.0",
    credit: "𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭",
    hasPrefix: true,
    permission: 'PUBLIC',
    description: "Download video from YouTube",
    category: "MEDIA",
    usages: "[song name/url] [quality (optional, e.g. 360p)]",
    cooldown: 5,
};

module.exports.run = async function ({ api, message, args }) {
    const { threadID, messageID } = message;

    if (!args.length) {
        return api.sendMessage("❌ Please enter a song name or YouTube URL.", threadID, messageID);
    }

    const apiKey = global.config.apiKeys?.priyanshuApi;
    if (!apiKey) {
        return api.sendMessage("❌ API key not found in config.", threadID, messageID);
    }

    // Parse arguments for quality
    let quality = null;
    const lastArg = args[args.length - 1];
    if (/^\d{3,4}p$/.test(lastArg)) {
        quality = lastArg.replace("p", "");
        args.pop(); // Remove quality from args
    }

    const input = args.join(" ");
    if (!input) {
        return api.sendMessage("❌ Please provide a search query or URL.", threadID, messageID);
    }

    let videoUrl = input;
    let videoTitle = "";
    let videoDetails = {};
    let processingMsg = null;

    try {
        // Check if input is a YouTube URL (supports shorts, mobile, youtu.be, etc.)
        const isUrl = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)(\/|$)/.test(input);

        if (!isUrl) {
            processingMsg = await api.sendMessage(`🔍 Searching for: ${input}...`, threadID, messageID);
            const searchResult = await ytSearch(input);
            if (!searchResult || !searchResult.videos.length) {
                if (processingMsg) api.unsendMessage(processingMsg.messageID);
                return api.sendMessage("❌ Video not found on YouTube.", threadID, messageID);
            }
            const video = searchResult.videos[0];
            videoUrl = video.url;
            videoTitle = video.title;
            videoDetails = {
                duration: video.duration.timestamp,
                views: video.views,
                author: video.author.name,
                ago: video.ago,
            };
        } else {
            processingMsg = await api.sendMessage(`🔍 Processing URL...`, threadID, messageID);
            // Try to get details for URL
            try {
                // Extract video ID from various YouTube URL formats
                // Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/embed/ID, youtube.com/v/ID
                const videoIdMatch = input.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|v\/)|youtu\.be\/)([0-9A-Za-z_-]{11})/);
                if (videoIdMatch) {
                    const videoId = videoIdMatch[1];
                    videoUrl = `https://www.youtube.com/watch?v=${videoId}`; // Normalize URL for API
                    const searchResult = await ytSearch({ videoId: videoId });
                    if (searchResult) {
                        videoTitle = searchResult.title;
                        videoDetails = {
                            duration: searchResult.duration.timestamp,
                            views: searchResult.views,
                            author: searchResult.author.name,
                            ago: searchResult.ago,
                        };
                    }
                }
            } catch (e) {
                // Ignore
            }
        }

        // Define quality chain - Default to 360p as requested
        let qualitiesToTry = [];
        if (quality) {
            qualitiesToTry = [quality];
        } else {
            qualitiesToTry = ["360", "720", "240", "144"];
        }

        let downloadData = null;
        let successfulQuality = "";

        // Try to get a valid download link
        for (const q of qualitiesToTry) {
            try {
                const apiUrl = "https://priyanshuapi.xyz/api/runner/youtube-downloader-v2/download";
                const response = await axios.post(
                    apiUrl,
                    {
                        link: videoUrl,
                        format: "mp4",
                        videoQuality: q,
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (response.data && response.data.success && response.data.data) {
                    const data = response.data.data;

                    // Check file size
                    try {
                        const headResponse = await axios.head(data.downloadUrl);
                        const contentLength = headResponse.headers["content-length"];
                        if (contentLength && parseInt(contentLength) > 40 * 1024 * 1024) {
                            console.log(`Quality ${q} too large: ${contentLength} bytes`);
                            continue; // Try next quality
                        }
                    } catch (headError) {
                        console.error("Error checking file size:", headError);
                    }

                    downloadData = data;
                    successfulQuality = q;
                    break; // Found a valid quality
                }
            } catch (apiError) {
                console.error(`Failed to get link for quality ${q}:`, apiError.message);
            }
        }

        if (!downloadData) {
            if (processingMsg) api.unsendMessage(processingMsg.messageID);
            return api.sendMessage("❌ Failed to download video. File might be too large (>40MB) or unavailable.", threadID, messageID);
        }

        const { downloadUrl, title, filename } = downloadData;
        const finalTitle = videoTitle || title || "Unknown Title";

        // Format views
        const formattedViews = videoDetails.views ? new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(videoDetails.views) : "N/A";

        // Construct info message
        let infoMsg = `🎬 Title: ${finalTitle}\n`;
        if (videoDetails.duration) infoMsg += `⏱ Duration: ${videoDetails.duration}\n`;
        if (videoDetails.author) infoMsg += `👤 Channel: ${videoDetails.author}\n`;
        if (videoDetails.views) infoMsg += `👀 Views: ${formattedViews}\n`;
        infoMsg += `📺 Quality: ${successfulQuality}p\n`;
        infoMsg += `🔗 Source: ${videoUrl}\n`;
        infoMsg += `📥 Download Link: ${downloadUrl}\n`;

        // Update processing message to show downloading status
        if (processingMsg) {
            api.unsendMessage(processingMsg.messageID);
        }
        const downloadingMsg = await api.sendMessage(`⏳ Downloading ${finalTitle} (${successfulQuality}p)...`, threadID, messageID);

        // Download file
        const tempDir = path.join(__dirname, "temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const safeFilename = (filename || `${Date.now()}.mp4`).replace(/[^a-zA-Z0-9.-]/g, "_");
        const filePath = path.join(tempDir, safeFilename);

        const writer = fs.createWriteStream(filePath);
        const downloadResponse = await axios({
            method: "GET",
            url: downloadUrl,
            responseType: "stream",
        });

        downloadResponse.data.pipe(writer);

        writer.on("finish", async () => {
            // Verify file is not empty before sending
            fs.stat(filePath, async (statErr, stats) => {
                if (statErr || !stats || stats.size === 0) {
                    console.error("[video] Temp file is empty or unreadable, skipping send:", filePath, statErr);
                    api.unsendMessage(downloadingMsg.messageID);
                    api.sendMessage("❌ Download failed (empty video file). Please try again.", threadID, messageID);
                    return fs.unlink(filePath, () => { });
                }

                // Send the file with retry logic
                try {
                    await sendVideoWithRetry(api, threadID, infoMsg, filePath, downloadingMsg.messageID);
                } catch (sendError) {
                    console.error("Final send error:", sendError);
                    api.sendMessage("❌ Failed to send video after multiple attempts.", threadID, messageID);
                    // Ensure cleanup
                    if (fs.existsSync(filePath)) fs.unlink(filePath, () => { });
                }
            });
        });

        writer.on("error", (err) => {
            console.error("Error downloading file:", err);
            api.unsendMessage(downloadingMsg.messageID);
            api.sendMessage("❌ Failed to download the file.", threadID, messageID);
            fs.unlink(filePath, () => { });
        });

    } catch (error) {
        console.error("Error in videov1 command:", error);
        if (processingMsg) api.unsendMessage(processingMsg.messageID);
        api.sendMessage("❌ An error occurred while processing your request.", threadID, messageID);
    }
};

async function sendVideoWithRetry(api, threadID, body, filePath, downloadingMsgID, attempt = 1) {
    const maxRetries = 3;

    try {
        console.log(`📤 Sending video (Attempt ${attempt}/${maxRetries})...`);

        await new Promise((resolve, reject) => {
            api.sendMessage(
                {
                    body: body,
                    attachment: fs.createReadStream(filePath),
                },
                threadID,
                (err, info) => {
                    if (err) reject(err);
                    else resolve(info);
                }
            );
        });

        console.log("✅ Video sent successfully.");
        if (downloadingMsgID) api.unsendMessage(downloadingMsgID);

        // Cleanup
        setTimeout(() => {
            if (fs.existsSync(filePath)) fs.unlink(filePath, () => { });
        }, 30000);

    } catch (err) {
        const errMsg = err && (err.error || err.message || JSON.stringify(err));
        console.error(`❌ Send failed (Attempt ${attempt}):`, errMsg);

        if (attempt < maxRetries) {
            console.log("🔄 Retrying in 2 seconds...");
            await new Promise(r => setTimeout(r, 2000));
            return sendVideoWithRetry(api, threadID, body, filePath, downloadingMsgID, attempt + 1);
        } else {
            // Fallback: Try sending separately
            console.log("⚠️ Combined send failed. Trying separate messages...");
            try {
                await api.sendMessage(body, threadID);
                await new Promise((resolve, reject) => {
                    api.sendMessage(
                        { attachment: fs.createReadStream(filePath) },
                        threadID,
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
                console.log("✅ Video sent separately.");
                if (downloadingMsgID) api.unsendMessage(downloadingMsgID);

                setTimeout(() => {
                    if (fs.existsSync(filePath)) fs.unlink(filePath, () => { });
                }, 30000);

            } catch (fallbackErr) {
                throw fallbackErr; // Propagate error if fallback also fails
            }
        }
    }
}
