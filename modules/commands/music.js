const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ytSearch = require("yt-search");

module.exports.config = {
    name: "music",
    aliases: ["yt", "ytmusic"],
    version: "1.0.0",
    credit: "𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭",
    description: "Download music from YouTube",
    hasPrefix: true,
    permission: 'PUBLIC',
    category: "MEDIA",
    usages: "[url/song name]",
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

    const input = args.join(" ");
    let videoUrl = input;
    let videoTitle = "";
    let videoDetails = {};
    let searchingMessageInfo = null;

    try {
        // Check if input is a YouTube URL (supports shorts, mobile, youtu.be, etc.)
        const isUrl = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)(\/|$)/.test(input);

        if (!isUrl) {
            searchingMessageInfo = await api.sendMessage(`🔍 Searching for: ${input}...`, threadID, messageID);
            const searchResult = await ytSearch(input);
            if (!searchResult || !searchResult.videos.length) {
                return api.sendMessage("❌ Song not found on YouTube.", threadID, messageID);
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
            searchingMessageInfo = await api.sendMessage(`🔍 Processing URL...`, threadID, messageID);
            // Even for URL, try to get details if possible, but basic yt-search on URL might not work the same.
            // We can try to search the URL to get details or just proceed.
            // For now, if it's a URL, we might miss some details unless we fetch them.
            // Let's try to fetch details using the video ID if possible, or just skip extra details for URL input to keep it simple/fast.
            // Or we can use yt-search with the URL which usually works.
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
                // Ignore error fetching details for URL
            }
        }

        // Call the API
        const apiUrl = "https://priyanshuapi.xyz/api/runner/youtube-downloader-v2/download";
        const response = await axios.post(
            apiUrl,
            {
                link: videoUrl,
                format: "mp3",
                videoQuality: "360",
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!response.data || !response.data.success || !response.data.data) {
            if (searchingMessageInfo) api.unsendMessage(searchingMessageInfo.messageID);
            return api.sendMessage("❌ Failed to generate download link.", threadID, messageID);
        }

        const { downloadUrl, title, filename } = response.data.data;
        const finalTitle = videoTitle || title || "Unknown Title";

        // Check file size using HEAD request
        try {
            const headResponse = await axios.head(downloadUrl);
            const contentLength = headResponse.headers["content-length"];
            if (contentLength && parseInt(contentLength) > 30 * 1024 * 1024) {
                if (searchingMessageInfo) api.unsendMessage(searchingMessageInfo.messageID);
                return api.sendMessage("❌ File size exceeds 30MB limit.", threadID, messageID);
            }
        } catch (headError) {
            console.error("Error checking file size:", headError);
            // Proceeding if HEAD fails, assuming size is okay or will fail later
        }

        // Format views
        const formattedViews = videoDetails.views ? new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(videoDetails.views) : "N/A";

        // Send info message
        let infoMsg = `🎵 Title: ${finalTitle}\n`;
        if (videoDetails.duration) infoMsg += `⏱ Duration: ${videoDetails.duration}\n`;
        if (videoDetails.author) infoMsg += `👤 Artist: ${videoDetails.author}\n`;
        if (videoDetails.views) infoMsg += `👀 Views: ${formattedViews}\n`;
        if (videoDetails.ago) infoMsg += `📅 Uploaded: ${videoDetails.ago}\n`;
        infoMsg += `🔗 Source: ${videoUrl}\n`;
        infoMsg += `📥 Download Link: ${downloadUrl}\n`;
        infoMsg += `⏳ Downloading...`;

        api.sendMessage(infoMsg, threadID, () => {
            if (searchingMessageInfo) {
                api.unsendMessage(searchingMessageInfo.messageID);
            }
        });

        // Download file
        const tempDir = path.join(__dirname, "tempsr");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Sanitize filename
        const safeFilename = (filename || `${Date.now()}.mp3`).replace(/[^a-zA-Z0-9.-]/g, "_");
        const filePath = path.join(tempDir, safeFilename);

        const writer = fs.createWriteStream(filePath);
        const downloadResponse = await axios({
            method: "GET",
            url: downloadUrl,
            responseType: "stream",
        });

        downloadResponse.data.pipe(writer);

        writer.on("finish", () => {
            // Verify file is not empty before sending
            fs.stat(filePath, (statErr, stats) => {
                if (statErr || !stats || stats.size === 0) {
                    console.error("[music] Temp file is empty or unreadable, skipping send:", filePath, statErr);
                    api.sendMessage("❌ Download failed (empty file). Please try again.", threadID, messageID);
                    return fs.unlink(filePath, () => { });
                }

                // Send the file
                api.sendMessage(
                    {
                        body: `🎧 ${finalTitle}`,
                        attachment: fs.createReadStream(filePath),
                    },
                    threadID,
                    (err) => {
                        if (err) {
                            console.error("Error sending file:", err);
                            api.sendMessage("❌ Failed to send audio file.", threadID, messageID);
                        }
                        // Delete file after sending (or attempting to send)
                        fs.unlink(filePath, (unlinkErr) => {
                            if (unlinkErr) console.error("Error deleting temp file:", unlinkErr);
                        });
                    }
                );
            });
        });

        writer.on("error", (err) => {
            console.error("Error downloading file:", err);
            api.sendMessage("❌ Failed to download the file.", threadID, messageID);
            fs.unlink(filePath, () => { }); // Clean up partial file
        });

    } catch (error) {
        console.error("Error in musicv4 command:", error);
        api.sendMessage("❌ An error occurred while processing your request.", threadID, messageID);
    }
};
