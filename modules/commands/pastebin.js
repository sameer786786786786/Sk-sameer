const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { PasteClient } = require('pastebin-api');
const client = new PasteClient("R02n6-lNPJqKQCd5VtL4bKPjuK6ARhHb");

module.exports = {
  config: {
    name: 'pastebin',
    aliases: ['adc', 'pb'],
    description: 'Generates a pastebin link for any file or applies code from pastebin',
    usage: '{prefix}pastebin [file_path or command_name]\n{prefix}pastebin apply [file_path] (reply to message with pastebin link)',
    credit: '𝐏𝐫𝐢𝐲𝐚𝐧𝐬𝐡 𝐑𝐚𝐣𝐩𝐮𝐭',
    hasPrefix: true,
    permission: 'ADMIN',
    cooldown: 3,
    category: 'UTILITY'
  },

  run: async function ({ api, message, args, event }) {
    const { threadID, messageID, senderID, messageReply } = message;
    const replyMessage = messageReply || (event && event.messageReply);

    try {
      if (!global.config.adminIDs.includes(senderID) && senderID !== global.config.ownerID) {
        return api.sendMessage('❌ You do not have permission to use this command.', threadID, messageID);
      }

      if (args.length === 0) {
        return api.sendMessage(
          '❌ Please provide an action or file path.\n' +
          `Usage:\n` +
          `• ${global.config.prefix}pastebin [command_name] - Generate pastebin link\n` +
          `• ${global.config.prefix}pastebin global [file_path] - Generate for any file\n` +
          `• ${global.config.prefix}pastebin apply [file_path] - Apply code from pastebin (reply to message with link)`,
          threadID,
          messageID
        );
      }

      // Handle "apply" action
      if (args[0].toLowerCase() === 'apply') {
        if (args.length < 2) {
          return api.sendMessage(
            '❌ Please provide a file path.\n' +
            `Usage: ${global.config.prefix}pastebin apply [file_path or command_name]\n` +
            `Reply to a message containing a pastebin link.`,
            threadID,
            messageID
          );
        }

        if (!replyMessage || !replyMessage.body) {
          return api.sendMessage(
            '❌ Please reply to a message containing a pastebin link.',
            threadID,
            messageID
          );
        }

        // Extract pastebin link from reply
        const pastebinRegex = /(https?:\/\/(www\.)?pastebin\.com\/(raw\/)?[a-zA-Z0-9]+)/i;
        const match = replyMessage.body.match(pastebinRegex);

        if (!match) {
          return api.sendMessage(
            '❌ No pastebin link found in the replied message.',
            threadID,
            messageID
          );
        }

        // Get raw URL
        let rawUrl = match[1];
        if (!rawUrl.includes('/raw/')) {
          rawUrl = rawUrl.replace('pastebin.com/', 'pastebin.com/raw/');
        }

        // Fetch code from pastebin
        api.sendMessage('🔄 Fetching code from Pastebin...', threadID, messageID);

        let newCode;
        try {
          const response = await axios.get(rawUrl);
          newCode = response.data;
        } catch (fetchError) {
          return api.sendMessage(
            `❌ Failed to fetch code from Pastebin: ${fetchError.message}`,
            threadID,
            messageID
          );
        }

        // Resolve file path
        let filePath = args.slice(1).join(' ');
        if (!filePath.includes('/') && !filePath.includes('\\')) {
          if (!filePath.endsWith('.js')) {
            filePath += '.js';
          }
          filePath = path.join(process.cwd(), 'modules', 'commands', filePath);
        } else if (!path.isAbsolute(filePath)) {
          filePath = path.join(process.cwd(), filePath);
        }

        const fileName = path.basename(filePath);
        const commandName = path.basename(filePath, '.js');
        const isCommandFile = filePath.includes('modules/commands') || filePath.includes('modules\\commands');
        const fileExists = fs.existsSync(filePath);

        // If it's a command file, validate before saving
        if (isCommandFile) {
          try {
            // Get the OLD file's actual config.name for exclusion (if file exists)
            let excludeConfigName = null;
            if (fileExists) {
              try {
                delete require.cache[require.resolve(filePath)];
                const oldCommand = require(filePath);
                excludeConfigName = oldCommand.config?.name || null;
                delete require.cache[require.resolve(filePath)];
              } catch (e) {
                // If old file can't be loaded, no exclusion needed
              }
            }

            // Ensure directory exists
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }

            // Write to temp file for validation
            const tempPath = filePath + '.temp';
            fs.writeFileSync(tempPath, newCode, 'utf8');

            // Validate using loader (pass old config.name to exclude)
            const validation = global.loader.validateCommand(tempPath, excludeConfigName);

            // Clear temp from cache
            try {
              delete require.cache[require.resolve(tempPath)];
            } catch (e) { }

            // Delete temp file
            fs.unlinkSync(tempPath);

            // If validation failed, return error
            if (!validation.success) {
              return api.sendMessage(
                `❌ Validation failed: ${validation.error}\n` +
                `⚠️ File was not ${fileExists ? 'modified' : 'created'}.`,
                threadID,
                messageID
              );
            }

            // Write the actual file
            fs.writeFileSync(filePath, newCode, 'utf8');

            // Wait a bit then reload
            await new Promise(r => setTimeout(r, 100));
            const reloadSuccess = global.loader.reloadCommand(commandName);

            return api.sendMessage(
              `✅ Successfully ${fileExists ? 'updated' : 'created'} file: ${fileName}\n` +
              (reloadSuccess ? `✅ Command "${validation.commandName}" loaded successfully!` : '⚠️ File saved but reload had issues.') +
              `\n📝 Source: ${rawUrl}`,
              threadID,
              messageID
            );

          } catch (error) {
            if (fs.existsSync(filePath + '.temp')) {
              fs.unlinkSync(filePath + '.temp');
            }
            return api.sendMessage(
              `❌ Error: ${error.message}\n` +
              `⚠️ File was not ${fileExists ? 'modified' : 'created'}.`,
              threadID,
              messageID
            );
          }
        } else {
          // Non-command file, just write directly
          try {
            const dirPath = path.dirname(filePath);
            if (!fs.existsSync(dirPath)) {
              fs.mkdirSync(dirPath, { recursive: true });
            }
            fs.writeFileSync(filePath, newCode, 'utf8');
            return api.sendMessage(
              `✅ Successfully ${fileExists ? 'updated' : 'created'} file: ${fileName}\n` +
              `� Source: ${rawUrl}`,
              threadID,
              messageID
            );
          } catch (error) {
            return api.sendMessage(
              `❌ Error saving file: ${error.message}`,
              threadID,
              messageID
            );
          }
        }
      }

      // Original functionality - generate pastebin link
      let filePath = args.join(' ');
      let fileExtension = '';
      const isGlobal = filePath.startsWith('global ');

      if (isGlobal) {
        filePath = filePath.replace('global ', '').trim();
        filePath = path.join(process.cwd(), filePath);
      } else if (!filePath.includes('/') && !filePath.includes('\\')) {
        if (!filePath.endsWith('.js')) {
          filePath += '.js';
        }
        filePath = path.join(process.cwd(), 'modules', 'commands', filePath);
      }

      if (!fs.existsSync(filePath)) {
        return api.sendMessage(`❌ File not found: ${filePath}`, threadID, messageID);
      }

      const fileContent = fs.readFileSync(filePath, 'utf8');
      const fileName = path.basename(filePath);
      fileExtension = path.extname(fileName).substring(1).toLowerCase();

      const formatMap = {
        'js': 'javascript',
        'html': 'html5',
        'css': 'css',
        'py': 'python',
        'php': 'php',
        'java': 'java',
        'c': 'c',
        'cpp': 'cpp',
        'cs': 'csharp',
        'json': 'json',
        'xml': 'xml',
        'sql': 'sql',
        'rb': 'ruby',
        'go': 'go',
        'ts': 'typescript',
        'sh': 'bash',
        'bat': 'batch',
        'md': 'markdown'
      };

      const format = formatMap[fileExtension] || 'text';

      const url = await client.createPaste({
        code: fileContent,
        expireDate: 'N',
        format,
        name: fileName,
        publicity: 1
      });

      const rawUrl = url.replace('pastebin.com/', 'pastebin.com/raw/');

      return api.sendMessage(
        `✅ Pastebin link generated successfully!\n\n` +
        `📄 File: ${fileName}\n` +
        `🔗 Link: ${url}\n` +
        `📝 Raw URL: ${rawUrl}\n` +
        `📋 Format: ${format}\n\n` +
        `⏱️ This link will never expire.`,
        threadID,
        messageID
      );

    } catch (error) {
      global.logger?.error('Error in pastebin command:', error.message);
      return api.sendMessage('❌ An error occurred: ' + error.message, threadID, messageID);
    }
  }
};
