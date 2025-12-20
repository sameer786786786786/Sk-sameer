/**
 * Reaction Handler
 * Handles message reactions
 */

/**
 * Handle reaction execution
 * @param {Object} options - Options object
 * @param {Object} options.api - Facebook API instance
 * @param {Object} options.message - Message object containing reaction data
 */
module.exports = async function ({ api, message }) {
  try {
    // Extract reaction data
    const { threadID, messageID, reaction, senderID, userID } = message;

    // In message_reaction events, the actual user who reacted is in userID, not senderID
    // senderID is typically the bot's ID in message_reaction events
    const actualReactorID = userID || senderID;

    // Handle reaction removal (undefined reaction)
    if (!reaction) {
      return;
    }

    // Check if commands are enabled (reactions are part of command system)
    if (!global.config.commandEnabled) {
      return;
    }

    // Check if user is banned
    const user = await global.User.findOne({ userID: actualReactorID });
    if (user && user.isBanned) {
      return;
    }

    // Check if thread is banned
    const thread = await global.Thread.findOne({ threadID });
    if (thread && thread.isBanned) {
      return;
    }

    // --- UNSEND LOGIC (PRIORITIZED) ---
    // Check for unsend reaction (configurable via config.json, default: Black Heart 🖤)
    // Auto-add to config if not present
    if (!global.config.unsendReaction) {
      global.config.unsendReaction = '🖤';
      // Auto-save to config.json
      try {
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(process.cwd(), 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(global.config, null, 2));
      } catch (e) { }
    }

    const unsendEmoji = global.config.unsendReaction;

    // Allow senderID to be '0' (unknown) or the bot's ID
    if (reaction === unsendEmoji && (senderID === global.client.botID || senderID === '0' || senderID === 0)) {
      // Unsend reaction from bot means unsend message
      try {
        await new Promise((resolve, reject) => {
          api.unsendMessage(messageID, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        return; // Stop processing after unsending
      } catch (error) {
        // Silent failure for unsend
      }
    }

    // Get reaction handler from client
    const pendingReactions = global.client.reactions.get(messageID) || [];

    // Find matching reaction handler
    const reactionHandler = pendingReactions.find(handler =>
      (!handler.expectedReaction || handler.expectedReaction === reaction) &&
      (!handler.expectedSender || handler.expectedSender === actualReactorID)
    );

    // Check if this is a loan request reaction
    if (global.client.loanRequests) {
      // Convert messageID to string for consistent comparison
      const messageIDStr = String(messageID);

      // Check if the messageID exists in the Map directly
      let hasExactMatch = global.client.loanRequests.has(messageIDStr);

      // If no exact match, try to find a match by string comparison
      let matchedKey = null;
      if (!hasExactMatch) {
        for (const [key, _] of global.client.loanRequests.entries()) {
          const keyStr = String(key);
          if (keyStr === messageIDStr) {
            matchedKey = key;
            break;
          }
        }
      }

      // Process the loan request if found
      const keyToUse = hasExactMatch ? messageIDStr : matchedKey;
      if (keyToUse) {
        const loanData = global.client.loanRequests.get(keyToUse);

        // Ensure loanData has all required fields
        if (!loanData || !loanData.lenderID || !loanData.borrowerID) {
          return;
        }

        // Convert IDs to strings for consistent comparison
        const reactorIDStr = String(actualReactorID);
        const lenderIDStr = String(loanData.lenderID);

        // Handle loan request reactions - check if reaction is valid and from lender only
        // Ensure both IDs are strings and trim any whitespace
        const trimmedReactorID = reactorIDStr.trim();
        const trimmedLenderID = lenderIDStr.trim();

        if ((reaction === '👍' || reaction === '👎') && trimmedReactorID === trimmedLenderID) {
          // Only process if the reaction is from the lender
          await handleLoanReaction({ api, message: { ...message, messageID: keyToUse, userID: message.userID }, loanData });
          return;
        }
      }
    }

    if (!reactionHandler) {
      return;
    }

    // Get command for this reaction
    const command = global.client.commands.get(reactionHandler.command);
    if (!command || !command.handleReaction) {
      return;
    }

    // Execute reaction handler
    await command.handleReaction({
      api,
      message,
      reaction,
      reactionData: reactionHandler.data || {}
    });

    // Remove this reaction handler if it's not persistent
    if (!reactionHandler.persistent) {
      const updatedReactions = pendingReactions.filter(handler =>
        handler !== reactionHandler
      );

      if (updatedReactions.length > 0) {
        global.client.reactions.set(messageID, updatedReactions);
      } else {
        global.client.reactions.delete(messageID);
      }
    }

    // Update last active time and lastThreadID
    await global.User.findOneAndUpdate(
      { userID: senderID },
      {
        lastActive: new Date(),
        lastThreadID: threadID
      },
      { new: true }
    );

    await global.Thread.findOneAndUpdate(
      { threadID },
      { lastActive: new Date() },
      { new: true }
    );

  } catch (error) {
    global.logger.error('Error handling reaction:', error);
  }
};

/**
 * Create a reaction handler
 * @param {Object} options - Options object
 * @param {string} options.messageID - Message ID to listen for reactions on
 * @param {string} options.command - Command name that will handle the reaction
 * @param {string} [options.expectedReaction] - Specific reaction to listen for (optional)
 * @param {string} [options.expectedSender] - User ID expected to react (optional)
 * @param {Object} [options.data] - Additional data to pass to the reaction handler
 * @param {boolean} [options.persistent=false] - Whether this reaction handler persists after being triggered
 */
module.exports.createReaction = function ({ messageID, command, expectedReaction, expectedSender, data, persistent = false }) {
  // Get existing reactions for this message or create new array
  const pendingReactions = global.client.reactions.get(messageID) || [];

  // Add new reaction handler
  pendingReactions.push({
    command,
    expectedReaction,
    expectedSender,
    data,
    persistent,
    createdAt: Date.now()
  });

  // Update reactions map
  global.client.reactions.set(messageID, pendingReactions);

  // Set timeout to clean up old reaction handlers (30 minutes)
  setTimeout(() => {
    const currentReactions = global.client.reactions.get(messageID) || [];
    const updatedReactions = currentReactions.filter(handler =>
      handler.createdAt !== pendingReactions[pendingReactions.length - 1].createdAt
    );

    if (updatedReactions.length > 0) {
      global.client.reactions.set(messageID, updatedReactions);
    } else {
      global.client.reactions.delete(messageID);
    }
  }, 30 * 60 * 1000);
};

/**
 * Handle loan reactions (approve/decline)
 * @param {Object} options - Options object
 * @param {Object} options.api - Facebook API instance
 * @param {Object} options.message - Message object
 * @param {Object} options.loanData - Loan request data
 */
async function handleLoanReaction({ api, message, loanData }) {
  // Ensure messageID is a string for consistent comparison
  const threadID = message.threadID;
  const messageID = String(message.messageID);
  const reaction = message.reaction;
  const senderID = message.senderID;
  const userID = message.userID;

  // In message_reaction events, the actual user who reacted is in userID, not senderID
  const actualReactorID = userID || senderID;

  try {
    // Check if this is a reaction from the lender
    const reactorIDStr = String(actualReactorID);
    const lenderIDStr = String(loanData.lenderID);

    // Ensure both IDs are strings and trim any whitespace
    const trimmedReactorID = reactorIDStr.trim();
    const trimmedLenderID = lenderIDStr.trim();

    const isLenderReaction = trimmedReactorID === trimmedLenderID;

    // Check if the reaction is valid (👍 or 👎)
    const isValidReaction = reaction === '👍' || reaction === '👎';

    if (!isLenderReaction || !isValidReaction) {
      return;
    }

    // Double check that we have all required data
    if (!loanData.borrowerID || !loanData.lenderID || !loanData.amount) {
      return;
    }

    // Process the loan based on reaction
    if (reaction === '👍') {
      // Approve loan
      try {
        // Unsend the original message
        await api.unsendMessage(messageID);

        // Transfer the money from lender to borrower
        const lenderCurrency = await global.Currency.findOne({ userID: loanData.lenderID });
        const borrowerCurrency = await global.Currency.findOne({ userID: loanData.borrowerID });

        if (!lenderCurrency || !borrowerCurrency) {
          return;
        }

        // Check if lender still has enough money
        if (loanData.amount > lenderCurrency.money) {
          api.sendMessage(
            {
              body: `❌ @${loanData.lenderName} doesn't have enough money to lend ${loanData.amount} coins. They only have ${lenderCurrency.money} coins.`,
              mentions: [{ tag: `@${loanData.lenderName}`, id: loanData.lenderID }]
            },
            threadID
          );
          return;
        }

        // Update balances
        lenderCurrency.money -= loanData.amount;
        borrowerCurrency.money += loanData.amount;

        // Save updated balances
        await lenderCurrency.save();
        await borrowerCurrency.save();

        // Send confirmation message
        const confirmMessage = {
          body: `💰 𝗟𝗢𝗔𝗡 𝗔𝗣𝗣𝗥𝗢𝗩𝗘𝗗\n\n` +
            `✅ @${loanData.lenderName} has approved @${loanData.borrowerName}'s loan request for ${loanData.amount} coins.\n\n` +
            `💵 @${loanData.lenderName}'s remaining balance: ${lenderCurrency.money} coins\n` +
            `💵 @${loanData.borrowerName}'s new balance: ${borrowerCurrency.money} coins\n\n` +
            `⚠️ Remember to repay this loan!`,
          mentions: [
            { tag: `@${loanData.lenderName}`, id: loanData.lenderID },
            { tag: `@${loanData.borrowerName}`, id: loanData.borrowerID }
          ]
        };

        await api.sendMessage(confirmMessage, threadID);
      } catch (err) {
        global.logger.error(`Error processing loan approval: ${err.message}`);
      }
    } else if (reaction === '👎') {
      // Decline loan
      try {
        // Unsend the original message
        await api.unsendMessage(messageID);

        // Send decline message
        const declineMessage = {
          body: `❌ 𝗟𝗢𝗔𝗡 𝗗𝗘𝗖𝗟𝗜𝗡𝗘𝗗\n\n` +
            `@${loanData.lenderName} has declined @${loanData.borrowerName}'s loan request for ${loanData.amount} coins.`,
          mentions: [
            { tag: `@${loanData.lenderName}`, id: loanData.lenderID },
            { tag: `@${loanData.borrowerName}`, id: loanData.borrowerID }
          ]
        };

        await api.sendMessage(declineMessage, threadID);
      } catch (err) {
        global.logger.error(`Error processing loan rejection: ${err.message}`);
      }
    }

    // Remove the loan request from global
    global.client.loanRequests.delete(messageID);

  } catch (error) {
    global.logger.error('Error handling loan reaction:', error.message);
    api.sendMessage('❌ An error occurred while processing the loan request.', threadID);
  }
}