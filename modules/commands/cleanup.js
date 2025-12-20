/**
 * Cleanup Command
 * Manually clean up dead threads from database
 * Deletes threads where bot is not a member or response is empty
 */

module.exports = {
    config: {
        name: 'cleanup',
        aliases: ['cleandb', 'dbclean'],
        description: 'Clean up dead threads from database where bot is not a member',
        usage: '{prefix}cleanup',
        credit: '𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭',
        hasPrefix: true,
        permission: 'OWNER',
        cooldown: 60,
        category: 'ADMIN'
    },

    run: async function ({ api, message }) {
        const { threadID, messageID, senderID } = message;

        // Only owner can run this
        if (senderID !== global.config.ownerID) {
            return api.sendMessage('❌ Only bot owner can use this command.', threadID, messageID);
        }

        // Get thread count first
        const threadCount = await global.Thread.countDocuments();

        if (threadCount === 0) {
            return api.sendMessage('✅ No threads in database to scan.', threadID, messageID);
        }

        api.sendMessage(`🔍 Starting cleanup scan...\n📊 Total threads: ${threadCount}`, threadID, async () => {
            const scanResults = await runCleanupScan(api, threadID);

            if (!scanResults) return;

            const toDelete = [...scanResults.notMember, ...scanResults.emptyResponse];

            // Build report
            let report = `📋 **Cleanup Scan Complete**\n\n`;
            report += `✅ Valid threads: ${scanResults.valid.length}\n`;
            report += `❌ Not member: ${scanResults.notMember.length}\n`;
            report += `⚠️ Empty response: ${scanResults.emptyResponse.length}\n`;
            report += `🔴 Errors (skipped): ${scanResults.errors.length}\n\n`;

            if (toDelete.length > 0) {
                report += `🗑️ Threads to delete:\n`;
                toDelete.slice(0, 10).forEach(t => {
                    const name = t.threadName?.substring(0, 20) || 'Unknown';
                    report += `• ${t.threadID} (${name}...)\n`;
                });
                if (toDelete.length > 10) {
                    report += `... and ${toDelete.length - 10} more\n`;
                }
                report += `\n💡 **Reply "confirm" to this message to delete these ${toDelete.length} threads.**`;
            } else {
                report += `\n✅ No dead threads found!`;
            }

            api.sendMessage(report, threadID, (err, info) => {
                if (err || toDelete.length === 0) return;

                // Set up reply handler
                const replies = global.client.replies.get(threadID) || [];
                replies.push({
                    command: 'cleanup',
                    messageID: info.messageID,
                    expectedSender: senderID,
                    data: { toDelete }
                });
                global.client.replies.set(threadID, replies);
            }, messageID);
        }, messageID);
    },

    handleReply: async function ({ api, message }) {
        const { threadID, messageID, senderID, body, messageReply } = message;

        // Get stored reply data
        const replies = global.client.replies.get(threadID) || [];
        const reply = replies.find(r => r.messageID === messageReply?.messageID && r.expectedSender === senderID);

        if (!reply || !reply.data?.toDelete) return;

        // Remove reply handler
        const updated = replies.filter(r => r.messageID !== messageReply.messageID);
        global.client.replies.set(threadID, updated);

        // Check if user confirmed
        if (body.trim().toLowerCase() !== 'confirm') {
            return api.sendMessage('❌ Cleanup cancelled. Reply "confirm" to delete.', threadID, messageID);
        }

        const toDelete = reply.data.toDelete;

        api.setMessageReaction('⏳', messageID, () => { }, true);

        let deletedCount = 0;
        for (const thread of toDelete) {
            try {
                await global.Thread.deleteOne({ threadID: thread.threadID });
                deletedCount++;
                console.log(`🗑️ Deleted: ${thread.threadID} (${thread.threadName})`);
            } catch (err) {
                console.log(`❌ Failed to delete ${thread.threadID}: ${err.message}`);
            }
        }

        api.setMessageReaction('✅', messageID, () => { }, true);
        api.sendMessage(`🎉 **Cleanup Complete!**\n\nDeleted ${deletedCount} dead threads from database.`, threadID, messageID);
    }
};

async function runCleanupScan(api, threadID) {
    try {
        const botID = api.getCurrentUserID();
        const allThreads = await global.Thread.find({}, 'threadID threadName');

        if (allThreads.length === 0) {
            api.sendMessage('✅ No threads in database to scan.', threadID);
            return null;
        }

        const results = {
            valid: [],
            notMember: [],
            emptyResponse: [],
            errors: []
        };

        // Process one thread at a time
        for (let i = 0; i < allThreads.length; i++) {
            const thread = allThreads[i];

            // Add delay between requests (1 second)
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log(`🔍 Checking: ${thread.threadID} (${thread.threadName || 'Unknown'})`);

            try {
                const threadInfo = await new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => reject(new Error('Timeout')), 10000);
                    api.getThreadInfo(thread.threadID, (err, info) => {
                        clearTimeout(timeoutId);
                        if (err) return reject(err);
                        resolve(info);
                    });
                });

                // Check if response is empty
                if (!threadInfo || Object.keys(threadInfo).length === 0) {
                    results.emptyResponse.push({
                        threadID: thread.threadID,
                        threadName: thread.threadName || 'Unknown'
                    });
                    continue;
                }

                // Check participants
                const participants = threadInfo.participantIDs || [];
                if (participants.length === 0) {
                    results.emptyResponse.push({
                        threadID: thread.threadID,
                        threadName: thread.threadName || 'Unknown'
                    });
                    continue;
                }

                // Check if bot is member
                const botIsMember = participants.includes(botID);
                if (!botIsMember) {
                    results.notMember.push({
                        threadID: thread.threadID,
                        threadName: thread.threadName || 'Unknown'
                    });
                    continue;
                }

                // Valid thread
                results.valid.push({
                    threadID: thread.threadID,
                    threadName: thread.threadName || 'Unknown'
                });

            } catch (error) {
                results.errors.push({
                    threadID: thread.threadID,
                    threadName: thread.threadName || 'Unknown',
                    error: error.message
                });
            }
        }

        return results;

    } catch (error) {
        console.error('[cleanup] Error:', error);
        api.sendMessage(`❌ Cleanup error: ${error.message}`, threadID);
        return null;
    }
}
