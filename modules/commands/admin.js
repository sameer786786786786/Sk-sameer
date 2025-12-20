/**
 * Admin Command
 * Provides administrative functions for bot management
 */

module.exports = {
  config: {
    name: 'admin',
    aliases: ['a', 'system'],
    description: 'Administrative commands for bot management',
    usage: '{prefix}admin [ban/unban/info/reload] [user/thread] [ID] [reason]',
    credit: '𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭',
    hasPrefix: true,
    permission: 'ADMIN',
    cooldown: 5,
    category: 'ADMIN'
  },

  /**
   * Command execution
   * @param {Object} options - Options object
   * @param {Object} options.api - Facebook API instance
   * @param {Object} options.message - Message object
   * @param {Array<string>} options.args - Command arguments
   */
  run: async function ({ api, message, args }) {
    const { threadID, messageID, senderID } = message;

    // Check if no arguments provided
    if (args.length === 0) {
      return global.api.sendMessage(
        `⚙️ Admin Commands:\n\n` +
        `📋 User/Thread Management:\n` +
        `- ban user [userID] [reason]: Ban a user\n` +
        `- ban thread [threadID] [reason]: Ban a thread\n` +
        `- unban user [userID]: Unban a user\n` +
        `- unban thread [threadID]: Unban a thread\n` +
        `- info user [userID]: Get user info\n` +
        `- info thread [threadID]: Get thread info\n\n` +
        `🔐 Permission Modes:\n` +
        `- owner only: Only owner can use bot globally\n` +
        `- only: Only owner and admins can use bot globally\n` +
        `- support only: Owner, admins, and supporters can use bot globally\n` +
        `- owner only group: Only owner can use bot in this group\n` +
        `- only group: Only owner and admins can use bot in this group\n` +
        `- support only group: Owner, admins, and supporters can use bot in this group\n` +
        `- public: Everyone can use bot (reset modes)\n\n` +
        `🔧 System:\n` +
        `- reload [command]: Reload a command\n` +
        `- restart: Restart the bot (owner only)`,
        threadID,
        messageID
      );
    }

    const action = args[0].toLowerCase();

    // Handle ban action
    if (action === 'ban') {
      const targetType = args[1]?.toLowerCase();
      const targetID = args[2];
      const reason = args.slice(3).join(' ') || 'No reason provided';

      if (!targetType || !targetID) {
        return global.api.sendMessage(
          '❌ Missing target type (user/thread) or ID',
          threadID,
          messageID
        );
      }

      if (targetType === 'user') {
        // Ban user
        try {
          // Check if user exists
          let user = await global.User.findOne({ userID: targetID });

          if (!user) {
            // Get user info from Facebook
            try {
              const userInfo = await new Promise((resolve, reject) => {
                api.getUserInfo(targetID, (err, info) => {
                  if (err) return reject(err);
                  resolve(info[targetID]);
                });
              });

              // Create user in database
              user = await global.User.create({
                userID: targetID,
                name: userInfo.name || 'Facebook User'
              });
            } catch (error) {
              return global.api.sendMessage(
                `❌ User with ID ${targetID} not found`,
                threadID,
                messageID
              );
            }
          }

          // Check if user is already banned
          if (user.isBanned) {
            return global.api.sendMessage(
              `❌ User ${user.name} is already banned. Reason: ${user.banReason}`,
              threadID,
              messageID
            );
          }

          // Check if trying to ban owner or admin
          if (targetID === global.config.ownerID) {
            return global.api.sendMessage(
              '❌ Cannot ban the bot owner',
              threadID,
              messageID
            );
          }

          if (global.config.adminIDs.includes(targetID) && senderID !== global.config.ownerID) {
            return global.api.sendMessage(
              '❌ Only the owner can ban an admin',
              threadID,
              messageID
            );
          }

          // Ban user
          user.isBanned = true;
          user.banReason = reason;
          await user.save();

          global.logger.system(`User ${targetID} (${user.name}) was banned by ${senderID}. Reason: ${reason}`);

          return global.api.sendMessage(
            `✅ Banned user ${user.name} (${targetID})\nReason: ${reason}`,
            threadID,
            messageID
          );

        } catch (error) {
          global.logger.error('Error in admin ban user command:', error.message);
          return global.api.sendMessage(
            '❌ An error occurred while banning the user',
            threadID,
            messageID
          );
        }
      } else if (targetType === 'thread') {
        // Ban thread
        try {
          // Check if thread exists
          let thread = await global.Thread.findOne({ threadID: targetID });

          if (!thread) {
            // Get thread info from Facebook
            try {
              const threadInfo = await new Promise((resolve, reject) => {
                api.getThreadInfo(targetID, (err, info) => {
                  if (err) return reject(err);
                  resolve(info);
                });
              });

              // Create thread in database
              thread = await global.Thread.create({
                threadID: targetID,
                threadName: threadInfo.threadName || 'Unknown Group'
              });
            } catch (error) {
              return global.api.sendMessage(
                `❌ Thread with ID ${targetID} not found`,
                threadID,
                messageID
              );
            }
          }

          // Check if thread is already banned
          if (thread.isBanned) {
            return global.api.sendMessage(
              `❌ Thread ${thread.threadName} is already banned. Reason: ${thread.banReason}`,
              threadID,
              messageID
            );
          }

          // Ban thread
          thread.isBanned = true;
          thread.banReason = reason;
          await thread.save();

          global.logger.system(`Thread ${targetID} (${thread.threadName}) was banned by ${senderID}. Reason: ${reason}`);

          // Notify the banned thread
          await global.api.sendMessage(
            `⚠️ This group has been banned from using the bot\nReason: ${reason}\n\nContact the bot owner for more information.`,
            targetID
          );

          return global.api.sendMessage(
            `✅ Banned thread ${thread.threadName} (${targetID})\nReason: ${reason}`,
            threadID,
            messageID
          );

        } catch (error) {
          global.logger.error('Error in admin ban thread command:', error.message);
          return global.api.sendMessage(
            '❌ An error occurred while banning the thread',
            threadID,
            messageID
          );
        }
      } else {
        return global.api.sendMessage(
          '❌ Invalid target type. Use "user" or "thread"',
          threadID,
          messageID
        );
      }
    }

    // Handle unban action
    else if (action === 'unban') {
      const targetType = args[1]?.toLowerCase();
      const targetID = args[2];

      if (!targetType || !targetID) {
        return global.api.sendMessage(
          '❌ Missing target type (user/thread) or ID',
          threadID,
          messageID
        );
      }

      if (targetType === 'user') {
        // Unban user
        try {
          // Check if user exists
          const user = await global.User.findOne({ userID: targetID });

          if (!user) {
            return global.api.sendMessage(
              `❌ User with ID ${targetID} not found`,
              threadID,
              messageID
            );
          }

          // Check if user is not banned
          if (!user.isBanned) {
            return global.api.sendMessage(
              `❌ User ${user.name} is not banned`,
              threadID,
              messageID
            );
          }

          // Unban user
          user.isBanned = false;
          user.banReason = null;
          await user.save();

          global.logger.system(`User ${targetID} (${user.name}) was unbanned by ${senderID}`);

          return global.api.sendMessage(
            `✅ Unbanned user ${user.name} (${targetID})`,
            threadID,
            messageID
          );

        } catch (error) {
          global.logger.error('Error in admin unban user command:', error.message);
          return global.api.sendMessage(
            '❌ An error occurred while unbanning the user',
            threadID,
            messageID
          );
        }
      } else if (targetType === 'thread') {
        // Unban thread
        try {
          // Check if thread exists
          const thread = await global.Thread.findOne({ threadID: targetID });

          if (!thread) {
            return global.api.sendMessage(
              `❌ Thread with ID ${targetID} not found`,
              threadID,
              messageID
            );
          }

          // Check if thread is not banned
          if (!thread.isBanned) {
            return global.api.sendMessage(
              `❌ Thread ${thread.threadName} is not banned`,
              threadID,
              messageID
            );
          }

          // Unban thread
          thread.isBanned = false;
          thread.banReason = null;
          await thread.save();

          global.logger.system(`Thread ${targetID} (${thread.threadName}) was unbanned by ${senderID}`);

          // Notify the unbanned thread
          await global.api.sendMessage(
            `✅ This group has been unbanned and can now use the bot again.`,
            targetID
          );

          return global.api.sendMessage(
            `✅ Unbanned thread ${thread.threadName} (${targetID})`,
            threadID,
            messageID
          );

        } catch (error) {
          global.logger.error('Error in admin unban thread command:', error.message);
          return global.api.sendMessage(
            '❌ An error occurred while unbanning the thread',
            threadID,
            messageID
          );
        }
      } else {
        return global.api.sendMessage(
          '❌ Invalid target type. Use "user" or "thread"',
          threadID,
          messageID
        );
      }
    }

    // Handle info action
    else if (action === 'info') {
      const targetType = args[1]?.toLowerCase();
      const targetID = args[2] || threadID; // Default to current thread if not specified

      if (!targetType) {
        return global.api.sendMessage(
          '❌ Missing target type (user/thread)',
          threadID,
          messageID
        );
      }

      if (targetType === 'user') {
        // Get user info
        try {
          const userID = targetID || senderID; // Default to sender if not specified

          // Get user from database
          const user = await global.User.findOne({ userID });
          const currency = await global.Currency.findOne({ userID });

          if (!user) {
            return global.api.sendMessage(
              `❌ User with ID ${userID} not found in database`,
              threadID,
              messageID
            );
          }

          // Get user info from Facebook
          const fbUserInfo = await new Promise((resolve, reject) => {
            api.getUserInfo(userID, (err, info) => {
              if (err) return reject(err);
              resolve(info[userID]);
            });
          });

          // Format user info
          let reply = `👤 User Information:\n`;
          reply += `- ID: ${userID}\n`;
          reply += `- Name: ${user.name}\n`;
          reply += `- Profile URL: https://facebook.com/${userID}\n`;
          reply += `- Status: ${user.isBanned ? '🚫 Banned' : '✅ Active'}\n`;

          if (user.isBanned) {
            reply += `- Ban Reason: ${user.banReason || 'No reason provided'}\n`;
          }

          reply += `- Created: ${user.dateCreated.toLocaleString()}\n`;
          reply += `- Last Active: ${user.lastActive.toLocaleString()}\n\n`;

          if (currency) {
            reply += `💰 Currency Information:\n`;
            reply += `- Level: ${currency.level}\n`;
            reply += `- XP: ${currency.exp}\n`;
            reply += `- Money: ${currency.money}\n`;
            reply += `- Bank: ${currency.bank}/${currency.bankCapacity}\n`;
          }

          // Check permissions
          const isOwner = userID === global.config.ownerID;
          const isAdmin = global.config.adminIDs.includes(userID);
          const isSupporter = global.config.supportIDs.includes(userID);

          reply += `\n🔒 Permissions:\n`;
          reply += `- Owner: ${isOwner ? '✅' : '❌'}\n`;
          reply += `- Admin: ${isAdmin ? '✅' : '❌'}\n`;
          reply += `- Supporter: ${isSupporter ? '✅' : '❌'}\n`;

          return global.api.sendMessage(reply, threadID, messageID);

        } catch (error) {
          global.logger.error('Error in admin info user command:', error.message);
          return global.api.sendMessage(
            '❌ An error occurred while getting user info',
            threadID,
            messageID
          );
        }
      } else if (targetType === 'thread') {
        // Get thread info
        try {
          // Get thread from database
          const thread = await global.Thread.findOne({ threadID: targetID });

          if (!thread) {
            return global.api.sendMessage(
              `❌ Thread with ID ${targetID} not found in database`,
              threadID,
              messageID
            );
          }

          // Get thread info from Facebook
          const fbThreadInfo = await new Promise((resolve, reject) => {
            api.getThreadInfo(targetID, (err, info) => {
              if (err) return reject(err);
              resolve(info);
            });
          });

          // Format thread info
          let reply = `👥 Thread Information:\n`;
          reply += `- ID: ${targetID}\n`;
          reply += `- Name: ${thread.threadName}\n`;
          reply += `- Type: ${fbThreadInfo.isGroup ? 'Group' : 'Personal Chat'}\n`;
          reply += `- Status: ${thread.isBanned ? '🚫 Banned' : '✅ Active'}\n`;

          if (thread.isBanned) {
            reply += `- Ban Reason: ${thread.banReason || 'No reason provided'}\n`;
          }

          reply += `- Created: ${thread.dateCreated.toLocaleString()}\n`;
          reply += `- Last Active: ${thread.lastActive.toLocaleString()}\n`;
          reply += `- Member Count: ${thread.users.length}\n\n`;

          // Thread settings
          reply += `⚙️ Settings:\n`;
          reply += `- Anti-Join: ${thread.settings?.antiJoin ? '✅' : '❌'}\n`;
          reply += `- Anti-Out: ${thread.settings?.antiOut ? '✅' : '❌'}\n`;
          reply += `- Welcome: ${thread.settings?.welcome ? '✅' : '❌'}\n`;
          reply += `- Goodbye: ${thread.settings?.goodbye ? '✅' : '❌'}\n`;
          reply += `- NSFW: ${thread.settings?.nsfw ? '✅' : '❌'}\n`;

          return global.api.sendMessage(reply, threadID, messageID);

        } catch (error) {
          global.logger.error('Error in admin info thread command:', error.message);
          return global.api.sendMessage(
            '❌ An error occurred while getting thread info',
            threadID,
            messageID
          );
        }
      } else {
        return global.api.sendMessage(
          '❌ Invalid target type. Use "user" or "thread"',
          threadID,
          messageID
        );
      }
    }

    // Handle reload action
    else if (action === 'reload') {
      const commandName = args[1];

      if (!commandName) {
        return global.api.sendMessage(
          '❌ Missing command name to reload',
          threadID,
          messageID
        );
      }

      try {
        const success = global.utils.loader.reloadCommand(commandName);

        if (success) {
          return global.api.sendMessage(
            `✅ Successfully reloaded command: ${commandName}`,
            threadID,
            messageID
          );
        } else {
          return global.api.sendMessage(
            `❌ Failed to reload command: ${commandName}`,
            threadID,
            messageID
          );
        }
      } catch (error) {
        global.logger.error('Error in admin reload command:', error.message);
        return global.api.sendMessage(
          `❌ Error reloading command: ${error.message}`,
          threadID,
          messageID
        );
      }
    }

    // Handle restart action (owner only)
    else if (action === 'restart') {
      // Check if user is owner
      if (senderID !== global.config.ownerID) {
        return global.api.sendMessage(
          '❌ Only the bot owner can use the restart command',
          threadID,
          messageID
        );
      }

      await global.api.sendMessage(
        '🔄 Restarting bot...',
        threadID,
        messageID
      );

      global.logger.system('Bot restart initiated by owner');

      // Exit process - process manager should restart it
      setTimeout(() => process.exit(1), 2000);
    }

    // Handle permission mode actions
    else if (action === 'owner' && args[1] === 'only') {
      // Check if user is owner
      if (senderID !== global.config.ownerID) {
        return global.api.sendMessage(
          '❌ Only the bot owner can change permission modes',
          threadID,
          messageID
        );
      }

      const isGroupSpecific = args[2] === 'group';

      if (isGroupSpecific) {
        // Set group-specific owner-only mode
        await global.Thread.findOneAndUpdate(
          { threadID },
          {
            $set: {
              'settings.adminOnlyMode': 'owner',
              'settings.updatedAt': new Date(),
              'settings.updatedBy': senderID
            }
          },
          { upsert: true, new: true }
        );

        return global.api.sendMessage(
          `🔐 This group is now in OWNER-ONLY mode.\nOnly the bot owner can use commands in this group.`,
          threadID,
          messageID
        );
      } else {
        // Set global owner-only mode
        global.config.adminOnlyMode.global = true;
        global.config.adminOnlyMode.mode = 'owner';

        // Save to config file
        const fs = require('fs');
        fs.writeFileSync('./config.json', JSON.stringify(global.config, null, 2));

        return global.api.sendMessage(
          `🔐 Bot is now in OWNER-ONLY mode globally.\nOnly the bot owner can use commands.`,
          threadID,
          messageID
        );
      }
    }

    else if (action === 'only') {
      // Check if user is admin
      const isAdmin = senderID === global.config.ownerID || global.config.adminIDs.includes(senderID);
      if (!isAdmin) {
        return global.api.sendMessage(
          '❌ Only admins can change permission modes',
          threadID,
          messageID
        );
      }

      const isGroupSpecific = args[1] === 'group';

      if (isGroupSpecific) {
        // Set group-specific admin-only mode (owner + admins)
        await global.Thread.findOneAndUpdate(
          { threadID },
          {
            $set: {
              'settings.adminOnlyMode': 'admin',
              'settings.updatedAt': new Date(),
              'settings.updatedBy': senderID
            }
          },
          { upsert: true, new: true }
        );

        return global.api.sendMessage(
          `🔐 This group is now in ADMIN-ONLY mode.\nOnly owner and admins can use commands in this group.`,
          threadID,
          messageID
        );
      } else {
        // Set global admin-only mode
        global.config.adminOnlyMode.global = true;
        global.config.adminOnlyMode.mode = 'admin';

        // Save to config file
        const fs = require('fs');
        fs.writeFileSync('./config.json', JSON.stringify(global.config, null, 2));

        return global.api.sendMessage(
          `🔐 Bot is now in ADMIN-ONLY mode globally.\nOnly owner and admins can use commands.`,
          threadID,
          messageID
        );
      }
    }

    else if (action === 'support' && args[1] === 'only') {
      // Check if user is admin
      const isAdmin = senderID === global.config.ownerID || global.config.adminIDs.includes(senderID);
      if (!isAdmin) {
        return global.api.sendMessage(
          '❌ Only admins can change permission modes',
          threadID,
          messageID
        );
      }

      const isGroupSpecific = args[2] === 'group';

      if (isGroupSpecific) {
        // Set group-specific support-only mode (owner + admins + supporters)
        await global.Thread.findOneAndUpdate(
          { threadID },
          {
            $set: {
              'settings.adminOnlyMode': 'support',
              'settings.updatedAt': new Date(),
              'settings.updatedBy': senderID
            }
          },
          { upsert: true, new: true }
        );

        return global.api.sendMessage(
          `🔐 This group is now in SUPPORT-ONLY mode.\nOnly owner, admins, and supporters can use commands in this group.`,
          threadID,
          messageID
        );
      } else {
        // Set global support-only mode
        global.config.adminOnlyMode.global = true;
        global.config.adminOnlyMode.mode = 'support';

        // Save to config file
        const fs = require('fs');
        fs.writeFileSync('./config.json', JSON.stringify(global.config, null, 2));

        return global.api.sendMessage(
          `🔐 Bot is now in SUPPORT-ONLY mode globally.\nOnly owner, admins, and supporters can use commands.`,
          threadID,
          messageID
        );
      }
    }

    else if (action === 'public') {
      // Check if user is admin
      const isAdmin = senderID === global.config.ownerID || global.config.adminIDs.includes(senderID);
      if (!isAdmin) {
        return global.api.sendMessage(
          '❌ Only admins can change permission modes',
          threadID,
          messageID
        );
      }

      const isGroupSpecific = args[1] === 'group';

      if (isGroupSpecific) {
        // Reset group-specific mode to public
        await global.Thread.findOneAndUpdate(
          { threadID },
          {
            $unset: { 'settings.adminOnlyMode': 1 },
            $set: {
              'settings.updatedAt': new Date(),
              'settings.updatedBy': senderID
            }
          },
          { new: true }
        );

        return global.api.sendMessage(
          `🔓 This group is now in PUBLIC mode.\nEveryone can use commands in this group.`,
          threadID,
          messageID
        );
      } else {
        // Reset global mode to public
        global.config.adminOnlyMode.global = false;
        global.config.adminOnlyMode.mode = 'public';

        // Also reset current group's mode for convenience
        await global.Thread.findOneAndUpdate(
          { threadID },
          {
            $unset: { 'settings.adminOnlyMode': 1 },
            $set: {
              'settings.updatedAt': new Date(),
              'settings.updatedBy': senderID
            }
          },
          { new: true }
        );

        // Save to config file
        const fs = require('fs');
        fs.writeFileSync('./config.json', JSON.stringify(global.config, null, 2));

        return global.api.sendMessage(
          `🔓 Bot is now in PUBLIC mode globally & in this group.\nEveryone can use commands.`,
          threadID,
          messageID
        );
      }
    }

    // Invalid action
    else {
      return global.api.sendMessage(
        `❌ Invalid admin action: ${action}\nUse ${global.config.prefix}admin for a list of valid actions`,
        threadID,
        messageID
      );
    }
  }
};